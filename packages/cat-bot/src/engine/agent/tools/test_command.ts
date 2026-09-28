import type { AppCtx } from '@/engine/types/controller.types.js';
import type { Readable } from 'node:stream';
import { resolveAgentContext } from '../agent.util.js';
import { inspectCommandConstraints } from '../agent-command-guard.lib.js';
import { dispatchCommand } from '@/engine/controllers/dispatchers/command.dispatcher.js';
import { OptionsMap } from '@/engine/modules/options/options-map.lib.js';
import type { OnCommandCtx } from '@/engine/types/middleware.types.js';
import { isCommandEnabled } from '@/engine/modules/session/bot-session-commands.repo.js';
import {
  commandResultStore,
  normalizeToJson,
} from '../lib/command-result-store.lib.js';
import type {
  InterceptedCall,
  BinaryAttachment,
} from '../lib/command-result-store.lib.js';

/**
 * test_command tool — silent command execution with full output capture.
 *
 * Runs each requested bot command through the REAL command dispatcher
 * (same lifecycle, validation, and success/error behavior as a legitimate
 * invocation) but against a mock API proxy that intercepts every platform
 * side-effect (replyMessage, sendMessage, editMessage, …). Captured calls
 * are normalized and stored under an opaque key; the model receives the key
 * plus an LLM-readable summary and must redeem it via send_result.
 *
 * Preflight per command: AI command guard (platform, toggle, bans, role,
 * cooldown — cooldown NOT consumed so previews never exhaust limits).
 * Responses (text, attachments, binary attachments, buttons, edits, errors)
 * are normalized before returning — internal SDK objects never leak.
 */

const EXECUTION_TIMEOUT_MS = 10 * 60 * 1000;

export const config = {
  name: 'test_command',
  description:
    'Execute commands silently to intercept and preview their output. Always use the ' +
    '`commands` array. Returns a `key` and a `calls` array. When the combined output ' +
    'across all commands contains more than one attachment, `button_key` is automatically ' +
    'null because platforms cannot deliver multiple file attachments alongside ' +
    'interactive button components.',
  parameters: {
    type: 'object',
    properties: {
      commands: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            command: {
              type: 'string',
              description: 'Command name without prefix',
            },
            args: {
              type: 'array',
              items: { type: 'string' },
              description: 'Arguments',
            },
          },
          required: ['command', 'args'],
        },
        description: 'List of commands to test in sequence.',
      },
    },
    required: ['commands'],
  },
};

function formatCallForLLM(
  call: InterceptedCall,
  senderID: string,
  messageID: string,
): Record<string, unknown> {
  const base: Record<string, unknown> = {
    type: call.type,
    senderID,
    messageID,
  };
  if (call.sourceCommand) base['sourceCommand'] = call.sourceCommand;

  switch (call.type) {
    case 'replyMessage': {
      const [threadID, opts] = call.args as [string, Record<string, unknown>];
      return {
        ...base,
        threadID,
        message: opts?.['message'] ?? null,
        attachment: opts?.['attachment'] ?? null,
        attachment_url: opts?.['attachment_url'] ?? [],
        button: opts?.['button'] ?? [],
        reply_to_message_id: opts?.['reply_to_message_id'] ?? null,
        mentions: opts?.['mentions'] ?? [],
        style: opts?.['style'] ?? null,
      };
    }
    case 'sendMessage': {
      const [msg, threadID] = call.args as [unknown, string];
      if (typeof msg === 'string') {
        return { ...base, threadID, message: msg };
      }
      const payload = (msg ?? {}) as Record<string, unknown>;
      return {
        ...base,
        threadID,
        message: payload['message'] ?? payload['body'] ?? null,
        attachment: payload['attachment'] ?? null,
        attachment_url: payload['attachment_url'] ?? [],
        mentions: payload['mentions'] ?? [],
      };
    }
    case 'editMessage': {
      const [editMsgID, opts] = call.args as [string, unknown];
      if (typeof opts === 'string') {
        return { ...base, messageIDToEdit: editMsgID, message: opts };
      }
      const o = (opts ?? {}) as Record<string, unknown>;
      return {
        ...base,
        messageIDToEdit: editMsgID,
        message: o['message'] ?? null,
        button: o['button'] ?? [],
        style: o['style'] ?? null,
        attachment: o['attachment'] ?? null,
        attachment_url: o['attachment_url'] ?? [],
      };
    }
    case 'reactToMessage': {
      const [threadID, reactMsgID, emoji] = call.args as [string, string, string];
      return { ...base, threadID, reactToMessageID: reactMsgID, emoji };
    }
    case 'unsendMessage': {
      const [unsendMsgID] = call.args as [string];
      return { ...base, unsendMessageID: unsendMsgID };
    }
    case 'setNickname': {
      const [threadID, userID, nickname] = call.args as [string, string, string];
      return { ...base, threadID, userID, nickname };
    }
    case 'setGroupName': {
      const [threadID, name] = call.args as [string, string];
      return { ...base, threadID, name };
    }
    case 'setGroupImage': {
      const [threadID, imageSource] = call.args as [string, unknown];
      return { ...base, threadID, imageSource };
    }
    case 'removeGroupImage': {
      const [threadID] = call.args as [string];
      return { ...base, threadID };
    }
    case 'addUserToGroup': {
      const [threadID, userID] = call.args as [string, string];
      return { ...base, threadID, userID };
    }
    case 'removeUserFromGroup': {
      const [threadID, userID] = call.args as [string, string];
      return { ...base, threadID, userID };
    }
    case 'setGroupReaction': {
      const [threadID, emoji] = call.args as [string, string];
      return { ...base, threadID, emoji };
    }
    default:
      return { ...base, args: call.args };
  }
}

/**
 * Extracts Buffer-based attachment payloads from raw (pre-normalization)
 * call args. MUST run before normalizeToJson — afterwards only sentinels
 * remain and the raw bytes are unrecoverable.
 */
function extractBinaryAttachments(
  method: string,
  args: unknown[],
): BinaryAttachment[] {
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
    if (a !== null && typeof a === 'object') {
      const entry = a as Record<string, unknown>;
      const stream = entry['stream'];
      const isReadable =
        stream !== null &&
        typeof stream === 'object' &&
        typeof (stream as Record<string, unknown>)['pipe'] === 'function';
      if (Buffer.isBuffer(stream)) {
        result.push({ name: String(entry['name'] ?? 'attachment'), stream });
      } else if (isReadable) {
        result.push({
          name: String(entry['name'] ?? 'attachment'),
          stream: stream as Readable,
        });
      }
    }
  }
  return result;
}

export const run = async (
  payload: Record<string, unknown>,
  ctx: AppCtx,
): Promise<string> => {
  const { senderID, threadID, sessionUserId, sessionId, platform } =
    resolveAgentContext(ctx);

  const rawCommands = payload['commands'];
  const cmdsToRun: Array<{ command: string; args: string[] }> = Array.isArray(
    rawCommands,
  )
    ? rawCommands.flatMap((c) => {
        if (!c || typeof c !== 'object') return [];
        const entry = c as Record<string, unknown>;
        if (typeof entry['command'] !== 'string') return [];
        const args = Array.isArray(entry['args'])
          ? (entry['args'] as unknown[]).map((a) => String(a))
          : [];
        return [{ command: entry['command'], args }];
      })
    : [];
  if (cmdsToRun.length === 0) {
    return 'Error: You must provide a non-empty `commands` array.';
  }

  const execution = (async (): Promise<string> => {
    try {
      const sideEffects = new Set([
        'replyMessage',
        'sendMessage',
        'editMessage',
        'reactToMessage',
        'unsendMessage',
        'setNickname',
        'setGroupName',
        'setGroupImage',
        'removeGroupImage',
        'addUserToGroup',
        'removeUserFromGroup',
        'setGroupReaction',
      ]);

      const rawIntercepted: Array<{
        method: string;
        args: unknown[];
        sourceCommand: string;
      }> = [];
      let currentRunningCommand = '';
      const rawBinaryAttachments: BinaryAttachment[] = [];

      const mockApi = new Proxy(ctx.api, {
        get(target, prop, receiver) {
          if (typeof prop === 'string' && sideEffects.has(prop)) {
            return async (...mArgs: unknown[]) => {
              for (const b of extractBinaryAttachments(prop, mArgs)) {
                rawBinaryAttachments.push(b);
              }
              rawIntercepted.push({
                method: prop,
                args: mArgs.map(normalizeToJson),
                sourceCommand: currentRunningCommand,
              });
              return 'mock-msg-id';
            };
          }
          const value = Reflect.get(target, prop, receiver);
          return typeof value === 'function' ? value.bind(target) : value;
        },
      });

      const errors: string[] = [];

      for (const cmdObj of cmdsToRun) {
        const command = cmdObj.command.toLowerCase();
        const args = cmdObj.args || [];
        currentRunningCommand = command;

        const mod = ctx.commands.get(command);
        if (!mod || typeof mod['onCommand'] !== 'function') {
          errors.push(`Command '${command}' not found.`);
          continue;
        }

        const simulatedMessage =
          `${ctx.prefix || '/'}${command} ${(args || []).join(' ')}`.trim();
        const simulatedEvent = {
          ...ctx.event,
          message: simulatedMessage,
          body: simulatedMessage,
        };

        const meta = mod['meta'] as Record<string, unknown> | undefined;
        const canonicalName = (
          (meta?.['name'] as string | undefined) ?? command
        ).toLowerCase();
        let enabled = true;
        if (sessionUserId && sessionId) {
          try {
            enabled = await isCommandEnabled(
              sessionUserId,
              platform,
              sessionId,
              canonicalName,
            );
          } catch {
            enabled = true; // fail-open on DB error
          }
        }

        const guard = await inspectCommandConstraints(
          mod,
          command,
          senderID,
          threadID,
          sessionUserId,
          platform,
          sessionId,
          false,
          enabled,
        );
        if (!guard.allowed) {
          errors.push(`Command '${command}' blocked: ${guard.reason}`);
          continue;
        }

        const commandCtx: OnCommandCtx = {
          ...ctx,
          api: mockApi,
          event: simulatedEvent,
          parsed: { name: command, args },
          prefix: ctx.prefix || '/',
          mod,
          options: OptionsMap.empty(),
        };

        // Final execution STILL goes through the existing dispatcher, so
        // middleware, argument validation, lifecycle, and success/error
        // behavior are identical to legitimate invocations.
        const parsed = commandCtx.parsed;
        if (parsed) {
          await dispatchCommand(
            parsed,
            commandCtx,
            mockApi,
            threadID,
            commandCtx.prefix,
          );
        }
      }

      if (rawIntercepted.length === 0) {
        if (errors.length > 0) return `Execution errors: ${errors.join(' ')}`;
        return `Commands executed silently but produced no API calls.`;
      }

      const storableCalls: InterceptedCall[] = rawIntercepted.map((entry) => ({
        type: entry.method,
        args: entry.args,
        sourceCommand: entry.sourceCommand,
      }));

      const eventMessageID = (ctx.event['messageID'] as string) || '';
      const commandNames = cmdsToRun.map((c) => c.command).join(',');
      const key = commandResultStore.generateKey(
        sessionUserId,
        platform,
        sessionId,
        threadID,
        eventMessageID,
        commandNames,
      );
      commandResultStore.set(key, storableCalls);

      const collectedAttachments: Array<{ name: string; url: string }> = [];
      const collectedButtonGrids: Array<unknown> = [];
      let streamAttachmentCount = 0;

      for (const call of storableCalls) {
        const isReply = call.type === 'replyMessage';
        const isEdit = call.type === 'editMessage';
        const isSend = call.type === 'sendMessage';
        const opts: Record<string, unknown> | null =
          isReply || isEdit
            ? ((call.args[1] ?? {}) as Record<string, unknown>)
            : isSend &&
                typeof call.args[0] === 'object' &&
                call.args[0] !== null
              ? (call.args[0] as Record<string, unknown>)
              : null;
        if (!opts) continue;
        if (Array.isArray(opts['attachment_url'])) {
          for (const u of opts['attachment_url'] as Array<{
            name: string;
            url: string;
          }>) {
            if (u && typeof u.url === 'string') collectedAttachments.push(u);
          }
        }
        if (Array.isArray(opts['attachment'])) {
          streamAttachmentCount += (opts['attachment'] as unknown[]).length;
        }
        if (
          (isReply || isEdit) &&
          Array.isArray(opts['button']) &&
          (opts['button'] as unknown[]).length > 0
        ) {
          collectedButtonGrids.push(opts['button']);
        }
      }

      // Strip buttons when total attachments exceed one — platforms reject
      // multiple file attachments alongside interactive buttons.
      const totalAttachments =
        collectedAttachments.length + streamAttachmentCount;
      const attachmentKey = collectedAttachments.length > 0 ? `${key}:a` : null;
      const buttonKey =
        collectedButtonGrids.length > 0 && totalAttachments <= 1
          ? `${key}:b`
          : null;
      if (attachmentKey) {
        commandResultStore.setAttachments(attachmentKey, collectedAttachments);
      }
      if (buttonKey) {
        commandResultStore.setButtons(buttonKey, collectedButtonGrids);
      }
      const binaryKey = rawBinaryAttachments.length > 0 ? `${key}:bin` : null;
      if (binaryKey) {
        commandResultStore.setBinaryAttachments(binaryKey, rawBinaryAttachments);
      }

      const llmCalls = storableCalls.map((call) =>
        formatCallForLLM(call, senderID, eventMessageID),
      );

      return JSON.stringify(
        {
          key,
          attachment_key: attachmentKey,
          binary_attachment_key: binaryKey,
          button_key: buttonKey,
          callCount: storableCalls.length,
          calls: llmCalls,
          note:
            'Read the `calls` text to synthesize your reply message. Then call ' +
            '`send_result` once with your synthesized `message` text. Pass ' +
            '`attachment_key` (if non-null) in the `attachment_url` array, ' +
            '`binary_attachment_key` (if non-null) in the `attachment` array, ' +
            'and `button_key` (if non-null) in the `button` array. Run all ' +
            'needed test_command calls first, then combine into one send_result call.',
        },
        null,
        2,
      );
    } catch (err) {
      return `Error testing command: ${err instanceof Error ? err.message : String(err)}`;
    }
  })();

  const timeout = new Promise<string>((resolve) => {
    const t = setTimeout(
      () =>
        resolve(
          'Error: test_command timed out after 10 minutes. ' +
            'The command may have stalled on network I/O.',
        ),
      EXECUTION_TIMEOUT_MS,
    );
    (t as NodeJS.Timeout).unref();
  });

  return Promise.race([execution, timeout]);
};
