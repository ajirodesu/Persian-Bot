/**
 * Silent command preview + unified delivery (upstream Cat-Bot agent tools port).
 *
 * `previewCommands()` runs bot commands against a mock API proxy that
 * intercepts every platform side-effect and stores the normalized results —
 * the agent sees the FULL output (text, URL attachments, binary files,
 * buttons) before anything reaches the chat. `deliverPreview()` then sends
 * one synthesized message merging the stored payloads.
 *
 * This replaces blind execution (post first, explain after) with an informed
 * pipeline: preview → understand → deliver once. Cooldowns are never consumed
 * by previews; real rate limits still apply to the underlying commands when
 * the agent's message is delivered.
 *
 * Portions derived from Cat-Bot (ISC) by John Lester:
 *   https://github.com/johnlester-0369/Cat-Bot
 *   (packages/cat-bot/src/engine/agent/tools/test_command.ts,
 *    tools/send_result.ts)
 * See THIRD_PARTY_NOTICES.md. Adapted to Persian-Bot conventions
 * (CommandMeta/onCommand modules, Persian dispatchCommand signature,
 * AppCtx-scoped contexts, native button-ID grids).
 */

import type { Readable } from 'node:stream';
import { dispatchCommand } from '@/engine/controllers/dispatchers/command.dispatcher.js';
import { OptionsMap } from '@/engine/modules/options/options-map.lib.js';
import type { OnCommandCtx } from '@/engine/types/middleware.types.js';
import { MessageStyle } from '@/engine/constants/message-style.constants.js';
import { inspectPreviewConstraints } from './command-guard.js';
import {
  previewResultStore,
  normalizeToJson,
  type InterceptedCall,
  type BinaryAttachment,
  type UrlAttachment,
} from './preview-store.js';
import { logger } from '@/engine/modules/logger/logger.lib.js';
import type { AppCtx } from '@/engine/types/controller.types.js';
import type { UnifiedApi } from '@/engine/adapters/models/api.model.js';
import type { ButtonItem } from '@/engine/adapters/models/interfaces/index.js';

// Hard ceiling per preview batch — commands stalling on network I/O must not
// block the agent loop indefinitely.
const PREVIEW_TIMEOUT_MS = 3 * 60 * 1000;

const SIDE_EFFECTS = new Set([
  'replyMessage',
  'sendMessage',
  'editMessage',
  'reactToMessage',
  'unsendMessage',
]);

export interface PreviewCommand {
  command: string;
  args: string[];
}

export interface PreviewOutcome {
  ok: boolean;
  /** Lookup key for deliverPreview (main store). Null when nothing captured. */
  key: string | null;
  attachmentKey: string | null;
  binaryKey: string | null;
  buttonKey: string | null;
  callCount: number;
  /** LLM-readable captured calls. */
  calls: Record<string, unknown>[];
  errors: string[];
}

/**
 * Format one intercepted call with named fields + conversation coordinates
 * so the model can read it directly.
 */
function formatCallForLLM(
  call: InterceptedCall,
  senderID: string,
  messageID: string,
): Record<string, unknown> {
  const base: Record<string, unknown> = { type: call.type, senderID, messageID };
  if (call.sourceCommand) base.sourceCommand = call.sourceCommand;

  switch (call.type) {
    case 'replyMessage':
    case 'editMessage': {
      const opts = (call.args[1] ?? {}) as Record<string, unknown>;
      return {
        ...base,
        threadID: call.args[0] ?? null,
        message: opts['message'] ?? null,
        attachment: opts['attachment'] ?? null,
        attachment_url: opts['attachment_url'] ?? [],
        button: opts['button'] ?? [],
        reply_to_message_id: opts['reply_to_message_id'] ?? null,
        style: opts['style'] ?? null,
      };
    }
    case 'sendMessage': {
      const msg = call.args[0];
      if (typeof msg === 'string') return { ...base, message: msg };
      const payload = (msg ?? {}) as Record<string, unknown>;
      return {
        ...base,
        message: payload['message'] ?? payload['body'] ?? null,
        attachment: payload['attachment'] ?? null,
        attachment_url: payload['attachment_url'] ?? [],
      };
    }
    default:
      return { ...base, args: call.args };
  }
}

/**
 * Pull Buffer/Readable attachments out of raw call args BEFORE
 * normalization replaces them with sentinels (unrecoverable after).
 */
function extractBinaryAttachments(method: string, args: unknown[]): BinaryAttachment[] {
  let opts: Record<string, unknown> | null = null;
  if (method === 'replyMessage' || method === 'editMessage') {
    opts = (args[1] ?? {}) as Record<string, unknown>;
  } else if (method === 'sendMessage') {
    const p = args[0];
    if (p !== null && typeof p === 'object' && !Array.isArray(p)) {
      opts = p as Record<string, unknown>;
    }
  }
  if (!opts || !Array.isArray(opts['attachment'])) return [];

  const result: BinaryAttachment[] = [];
  for (const a of opts['attachment'] as unknown[]) {
    if (a === null || typeof a !== 'object') continue;
    const entry = a as Record<string, unknown>;
    const stream = entry['stream'];
    const isReadable =
      stream !== null &&
      typeof stream === 'object' &&
      typeof (stream as Record<string, unknown>)['pipe'] === 'function';
    if (Buffer.isBuffer(stream)) {
      result.push({ name: String(entry['name'] ?? 'attachment'), stream });
    } else if (isReadable) {
      result.push({ name: String(entry['name'] ?? 'attachment'), stream: stream as Readable });
    }
  }
  return result;
}

/**
 * Silently execute commands, capturing every side-effect for later delivery.
 * Nothing reaches the chat. Guard failures are reported per command.
 */
export async function previewCommands(
  ctx: AppCtx,
  cmds: PreviewCommand[],
): Promise<PreviewOutcome> {
  const empty: PreviewOutcome = {
    ok: false,
    key: null,
    attachmentKey: null,
    binaryKey: null,
    buttonKey: null,
    callCount: 0,
    calls: [],
    errors: [],
  };
  if (!cmds.length) {
    return { ...empty, errors: ['No commands given.'] };
  }

  const senderID = String(ctx.event['senderID'] ?? ctx.event['userID'] ?? '');
  const threadID = String(ctx.event['threadID'] ?? ctx.event['thread_id'] ?? '');
  const sessionUserId = ctx.native.userId ?? '';
  const sessionId = ctx.native.sessionId ?? '';
  const platform = ctx.native.platform;
  const prefix = ctx.prefix ?? '!';
  const messageID = String(ctx.event['messageID'] ?? '');

  const run = (async (): Promise<PreviewOutcome> => {
    const rawIntercepted: Array<{ method: string; args: unknown[]; sourceCommand: string }> = [];
    const rawBinary: BinaryAttachment[] = [];
    const errors: string[] = [];
    let current = '';

    const mockApi = new Proxy(ctx.api, {
      get(target, prop, receiver) {
        if (typeof prop === 'string' && SIDE_EFFECTS.has(prop)) {
          return async (...mArgs: unknown[]) => {
            for (const b of extractBinaryAttachments(prop, mArgs)) rawBinary.push(b);
            rawIntercepted.push({
              method: prop,
              args: mArgs.map(normalizeToJson),
              sourceCommand: current,
            });
            return 'mock-msg-id';
          };
        }
        const value = Reflect.get(target, prop, receiver);
        if (typeof value === 'function') {
          return (value as (...a: unknown[]) => unknown).bind(target);
        }
        if (value === undefined && typeof prop === 'string') {
          // Cosmetic or platform-absent methods (typing indicators, test
          // doubles) degrade to no-ops during previews rather than throwing.
          return async (...a: unknown[]) => {
            logger.debug(`[ai-preview] unimplemented api.${prop} no-op`, { args: a.length });
            return undefined;
          };
        }
        return value;
      },
    }) as UnifiedApi;

    for (const cmdObj of cmds) {
      const raw = String(cmdObj.command ?? '').trim().replace(/^[/!#+-]+/, '');
      const name = raw.split(/\s+/)[0]?.toLowerCase() ?? '';
      const args = Array.isArray(cmdObj.args) ? cmdObj.args.map(String) : [];
      if (!name) {
        errors.push('Empty command name.');
        continue;
      }
      current = name;

      // Resolve via canonical name or alias from the live registry.
      let mod: Record<string, unknown> | undefined;
      let canonical = name;
      for (const candidate of ctx.commands.values()) {
        const meta = (candidate as { meta?: { name?: string; aliases?: string[] } }).meta;
        if (!meta?.name) continue;
        if (
          meta.name.toLowerCase() === name ||
          (meta.aliases ?? []).some((a) => a.toLowerCase() === name)
        ) {
          mod = candidate as Record<string, unknown>;
          canonical = meta.name.toLowerCase();
          break;
        }
      }
      if (!mod || typeof mod['onCommand'] !== 'function') {
        errors.push(`Command '${name}' not found.`);
        continue;
      }

      const guard = await inspectPreviewConstraints(ctx, mod, canonical).catch((err) => ({
        allowed: false as const,
        reason: `Guard failed: ${(err as Error)?.message ?? String(err)}`,
      }));
      if (!guard.allowed) {
        errors.push(`Command '${name}' blocked: ${guard.reason ?? 'not allowed'}`);
        continue;
      }

      const simulatedMessage = `${prefix}${canonical}${args.length > 0 ? ` ${args.join(' ')}` : ''}`;
      const parsed = { name: canonical, args };
      const commandCtx: OnCommandCtx = {
        ...ctx,
        api: mockApi,
        event: {
          ...ctx.event,
          message: simulatedMessage,
          body: simulatedMessage,
          aiInitiated: true,
        },
        parsed,
        prefix,
        mod,
        options: OptionsMap.empty(),
      };

      try {
        await dispatchCommand(parsed, commandCtx, mockApi, threadID, prefix);
      } catch (err) {
        errors.push(`Command '${name}' failed: ${(err as Error)?.message ?? String(err)}`);
      }
    }

    if (rawIntercepted.length === 0) {
      return {
        ...empty,
        errors: errors.length > 0 ? errors : ['Commands produced no output.'],
      };
    }

    const storable: InterceptedCall[] = rawIntercepted.map((e) => ({
      type: e.method,
      args: e.args,
      sourceCommand: e.sourceCommand,
    }));

    const commandNames = cmds.map((c) => String(c.command)).join(',');
    const key = previewResultStore.generateKey(
      sessionUserId,
      platform,
      sessionId,
      threadID,
      messageID,
      commandNames,
    );
    previewResultStore.set(key, storable);

    // Split URL attachments / binary payloads / button grids into their own
    // single-use keys so one delivery can merge several preview runs.
    const collectedUrls: UrlAttachment[] = [];
    let streamSlots = 0;
    const collectedGrids: unknown[][] = [];
    for (const call of storable) {
      const isReply = call.type === 'replyMessage';
      const isEdit = call.type === 'editMessage';
      const isSend = call.type === 'sendMessage';
      const opts: Record<string, unknown> | null =
        isReply || isEdit
          ? ((call.args[1] ?? {}) as Record<string, unknown>)
          : isSend && typeof call.args[0] === 'object' && call.args[0] !== null
            ? (call.args[0] as Record<string, unknown>)
            : null;
      if (!opts) continue;
      if (Array.isArray(opts['attachment_url'])) {
        for (const u of opts['attachment_url'] as Array<{ name: string; url: string }>) {
          if (u && typeof u.url === 'string') collectedUrls.push(u);
        }
      }
      if (Array.isArray(opts['attachment'])) {
        streamSlots += (opts['attachment'] as unknown[]).length;
      }
      if ((isReply || isEdit) && Array.isArray(opts['button']) && (opts['button'] as unknown[]).length > 0) {
        collectedGrids.push(opts['button'] as unknown[][]);
      }
    }

    // Platforms reject multiple attachments alongside buttons — strip buttons
    // when the total attachment footprint exceeds one.
    const totalFiles = collectedUrls.length + streamSlots;
    const attachmentKey = collectedUrls.length > 0 ? `${key}:a` : null;
    const buttonKey = collectedGrids.length > 0 && totalFiles <= 1 ? `${key}:b` : null;
    if (attachmentKey) previewResultStore.setAttachments(attachmentKey, collectedUrls);
    if (buttonKey) previewResultStore.setButtons(buttonKey, collectedGrids);
    const binaryKey = rawBinary.length > 0 ? `${key}:bin` : null;
    if (binaryKey) previewResultStore.setBinaryAttachments(binaryKey, rawBinary);

    return {
      ok: true,
      key,
      attachmentKey,
      binaryKey,
      buttonKey,
      callCount: storable.length,
      calls: storable.map((call) => formatCallForLLM(call, senderID, messageID)),
      errors,
    };
  })();

  const timeout = new Promise<PreviewOutcome>((resolve) => {
    const t = setTimeout(
      () =>
        resolve({
          ...empty,
          errors: ['Preview timed out. The command may have stalled on network I/O.'],
        }),
      PREVIEW_TIMEOUT_MS,
    );
    (t as NodeJS.Timeout).unref();
  });

  return Promise.race([run, timeout]);
}

export interface DeliveryInput {
  message: string;
  attachmentKeys?: string[];
  binaryKeys?: string[];
  buttonKeys?: string[];
}

export interface DeliveryOutcome {
  ok: boolean;
  content: string;
}

/**
 * Deliver ONE synthesized message merging stored preview payloads.
 * Keys are single-use and deleted after delivery. Respects the platform
 * rule: buttons are dropped when total attachments exceed one.
 */
export async function deliverPreview(ctx: AppCtx, input: DeliveryInput): Promise<DeliveryOutcome> {
  const threadID = String(ctx.event['threadID'] ?? ctx.event['thread_id'] ?? '');
  const replyToID = String(ctx.event['messageID'] ?? '');
  if (!threadID) return { ok: false, content: 'No thread to deliver to.' };
  if (!input.message?.trim()) return { ok: false, content: 'Empty message — nothing delivered.' };

  const urls: UrlAttachment[] = [];
  for (const k of input.attachmentKeys ?? []) {
    const got = previewResultStore.getAttachments(k);
    if (got) urls.push(...got);
    previewResultStore.deleteAttachments(k);
  }
  const binaries: BinaryAttachment[] = [];
  for (const k of input.binaryKeys ?? []) {
    const got = previewResultStore.getBinaryAttachments(k);
    if (got) binaries.push(...got);
    previewResultStore.deleteBinaryAttachments(k);
  }
  const grids: unknown[][] = [];
  for (const k of input.buttonKeys ?? []) {
    const got = previewResultStore.getButtons(k);
    if (got) grids.push(...got);
    previewResultStore.deleteButtons(k);
  }

  const totalFiles = urls.length + binaries.length;
  const useButtons = grids.length > 0 && totalFiles <= 1;

  try {
    await ctx.api.replyMessage(threadID, {
      message: input.message.slice(0, 4000),
      style: MessageStyle.MARKDOWN,
      ...(replyToID ? { reply_to_message_id: replyToID } : {}),
      ...(urls.length > 0 ? { attachment_url: urls.map((u) => ({ name: u.name, url: u.url })) } : {}),
      ...(binaries.length > 0
        ? { attachment: binaries.map((b) => ({ name: b.name, stream: b.stream })) }
        : {}),
      ...(useButtons ? { button: grids as unknown as ButtonItem[][] } : {}),
    });

    const parts = ['Message delivered.'];
    if (urls.length > 0) parts.push(`${urls.length} attachment(s) included.`);
    if (binaries.length > 0) parts.push(`${binaries.length} binary attachment(s) included.`);
    if (useButtons) parts.push(`${grids.length} button row(s) included.`);
    return { ok: true, content: parts.join(' ') };
  } catch (err) {
    logger.warn('[ai-preview] delivery failed', { error: (err as Error)?.message ?? String(err) });
    return { ok: false, content: `Delivery failed: ${(err as Error)?.message ?? String(err)}` };
  }
}
