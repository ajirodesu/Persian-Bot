/**
 * generate_image Tool — AI Image Generation via the Bot's AI Image Commands
 *
 * Runs when the user asks the agent to generate or transform an image. Picks
 * the most fitting command from the bot's `AI Image` command category
 * (text2image, flux, pollinations, ideogram, magicstudio, nanobanana) — the
 * list is discovered live from ctx.commands, so any command whose
 * meta.category is 'AI Image' is picked up automatically, no hardcoded list.
 *
 * Command selection:
 *   - `command` param → that exact AI Image command (validated against the
 *     discovered category)
 *   - an image is available (explicit `image_url`, or an image attached to the
 *     triggering message / replied-to message) → nanobanana (image-to-image)
 *   - otherwise keyword hints on the prompt (logo/text → ideogram,
 *     photorealistic → flux, anime/cartoon → pollinations, digital art →
 *     magicstudio), defaulting to text2image (which also accepts `ratio`)
 *
 * Execution uses the same silent capture machinery as test_command: the
 * command runs under a mock API proxy, the generated image bytes are pulled
 * out of the intercepted replyMessage call BEFORE normalization, and stored
 * under `${key}:bin`. The agent then delivers via send_result by passing the
 * `binary_attachment_key` in its `attachment` array alongside a synthesized
 * caption. Never throws — every failure returns a descriptive string.
 */

import type { AppCtx } from '@/engine/types/controller.types.js';
import type { Readable } from 'node:stream';
import {
  resolveAgentContext,
  extractEventImageUrls,
  getPendingMedia,
} from '../agent.util.js';
import { inspectCommandConstraints } from '@/engine/agent/agent-command-guard.lib.js';
import { dispatchCommand } from '@/engine/controllers/dispatchers/command.dispatcher.js';
import { OptionsMap } from '@/engine/modules/options/options-map.lib.js';
import type { OnCommandCtx } from '@/engine/types/middleware.types.js';
import {
  commandResultStore,
  normalizeToJson,
} from '../lib/command-result-store.lib.js';
import type {
  BinaryAttachment,
  InterceptedCall,
} from '../lib/command-result-store.lib.js';

// ============================================================================
// TOOL DEFINITION
// ============================================================================

export const config = {
  name: 'generate_image',
  description:
    'CREATE / GENERATE / DRAW an image: trigger words are "create", "generate", ' +
    '"draw", "make an image/picture/photo", "design", "art". Use ONLY when the ' +
    'user wants VISUAL/image output — a new image from a text prompt, or ' +
    'transforming/editing/restyling an existing image (attached or via ' +
    '`image_url`). Do NOT use this tool for "create/generate" requests about ' +
    'text, code, lists, summaries, reminders, music, or anything non-image — ' +
    'answer those directly or with other tools. Pass the image description in ' +
    '`prompt` (e.g. "a cyberpunk cat riding a motorcycle"). Optionally pass ' +
    '`command` to force a specific generator (text2image, flux, pollinations, ' +
    'ideogram, magicstudio) or `image_url` to transform an uploaded image ' +
    '(uses nanobanana). If the user attached an image to their message (or ' +
    'replied to one), it is detected automatically — omit `image_url`. For ' +
    'text2image you can pass a `ratio` like "16:9". Returns a ' +
    '`binary_attachment_key` for delivery via send_result.',
  parameters: {
    type: 'object',
    properties: {
      prompt: {
        type: ['string', 'null'],
        description:
          "The image description or transformation instruction, e.g. 'anime girl with short blue hair'.",
      },
      command: {
        type: ['string', 'null'],
        description:
          "Optional explicit generator: 'text2image' | 'flux' | 'pollinations' | 'ideogram' | 'magicstudio' | 'nanobanana'. Auto-selected when omitted.",
      },
      ratio: {
        type: ['string', 'null'],
        description:
          "Optional 'W:H' aspect ratio for text2image only, e.g. '16:9', '4:3' (defaults to '1:1').",
      },
      image_url: {
        type: ['string', 'null'],
        description:
          'Optional URL of an existing image to transform (image-to-image, uses nanobanana). When omitted, an image attached to the user\u2019s message (or replied-to message) is detected automatically.',
      },
    },
    required: ['prompt'],
  },
};

// ============================================================================
// AI IMAGE COMMAND DISCOVERY
// ============================================================================

interface AiImageCommand {
  name: string;
  aliases: string[];
}

/**
 * Scans the loaded command map for every module whose meta.category is
 * 'AI Image'. Live discovery keeps this tool in sync with the command set —
 * adding a new AI Image command requires zero changes here.
 */
function discoverAiImageCommands(ctx: AppCtx): AiImageCommand[] {
  const found: AiImageCommand[] = [];
  for (const mod of ctx.commands.values()) {
    const cfg = mod['meta'] as Record<string, unknown> | undefined;
    if (!cfg || cfg['category'] !== 'AI Image') continue;
    const name = typeof cfg['name'] === 'string' ? cfg['name'].toLowerCase() : '';
    if (!name) continue;
    const aliases = Array.isArray(cfg['aliases'])
      ? cfg['aliases'].map((a) => String(a).toLowerCase())
      : [];
    found.push({ name, aliases });
  }
  return found;
}

/**
 * Keyword hints mapping a prompt to the most fitting generator. Ordered —
 * first match wins. Each generator is only used when it actually exists in
 * the discovered category.
 */
const KEYWORD_HINTS: Array<{ pattern: RegExp; command: string }> = [
  {
    pattern:
      /(logo|typography|text\s+effect|wordmark|handwriting|calligraphy|poster\s+with\s+text)/i,
    command: 'ideogram',
  },
  {
    pattern: /(photoreal|photorealistic|realistic\s+(photo|photograph)|photography|cinematic)/i,
    command: 'flux',
  },
  {
    pattern: /(anime|manga|cartoon|chibi|pixel\s+art)/i,
    command: 'pollinations',
  },
  {
    pattern: /(digital\s+art|illustration|artistic|painting|concept\s+art|fantasy)/i,
    command: 'magicstudio',
  },
];

/** Builds the command-line args for a generator from the raw tool inputs. */
function buildArgs(
  command: string,
  prompt: string,
  ratio: string,
): string[] {
  return command === 'text2image' && ratio ? [ratio, prompt] : [prompt];
}

/**
 * Resolves which AI Image command to run. Returns the command name + args,
 * or an `error` string describing why the request cannot be satisfied.
 */
function resolveAiImageCommand(
  opts: { prompt: string; explicit: string; ratio: string; imageUrl: string },
  available: AiImageCommand[],
): { command?: string; argsList?: string[]; error?: string } {
  const { prompt, explicit, ratio, imageUrl } = opts;

  const has = (name: string): boolean =>
    available.some((c) => c.name === name || c.aliases.includes(name));

  // 1. Explicit command choice.
  if (explicit) {
    const match = available.find(
      (c) => c.name === explicit || c.aliases.includes(explicit),
    );
    if (!match) {
      const names = available.map((c) => c.name).join(', ');
      return {
        error: `Unknown AI Image command '${explicit}'. Available: ${names}.`,
      };
    }
    if (match.name === 'nanobanana' && !imageUrl) {
      return {
        error:
          'nanobanana transforms an existing image — attach an image to the message or pass `image_url` for the image to transform.',
      };
    }
    return { command: match.name, argsList: buildArgs(match.name, prompt, ratio) };
  }

  // 2. Image-to-image: a source image was provided.
  if (imageUrl) {
    if (!has('nanobanana')) {
      return { error: 'No image-to-image command (nanobanana) is available.' };
    }
    return { command: 'nanobanana', argsList: [prompt] };
  }

  // 3. Keyword hints on the prompt.
  for (const hint of KEYWORD_HINTS) {
    if (hint.pattern.test(prompt) && has(hint.command)) {
      return {
        command: hint.command,
        argsList: buildArgs(hint.command, prompt, ratio),
      };
    }
  }

  // 4. Default: text2image when present (supports the ratio), else the first
  //    discovered AI Image command.
  const fallback = has('text2image') ? 'text2image' : available[0]!.name;
  return { command: fallback, argsList: buildArgs(fallback, prompt, ratio) };
}

// ============================================================================
// SILENT CAPTURE (mirrors test_command's interception machinery)
// ============================================================================

/** UnifiedApi methods the mock proxy intercepts so the command runs silently. */
const SIDE_EFFECT_METHODS = new Set([
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

/**
 * Extracts Buffer-based attachment payloads from raw (pre-normalization)
 * UnifiedApi call args. MUST run before normalizeToJson — once normalized,
 * every Buffer/stream is replaced with a sentinel and the bytes are gone.
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
    if (p !== null && typeof p === 'object' && !Array.isArray(p))
      opts = p as Record<string, unknown>;
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

/**
 * Builds a compact, LLM-readable summary of the captured calls — the model
 * mainly needs to know whether an image was produced and what caption/error
 * text the command emitted.
 */
function summarizeCalls(
  calls: Array<{ method: string; args: unknown[]; sourceCommand: string }>,
): Array<Record<string, unknown>> {
  return calls.map((c) => {
    let message: unknown = null;
    let hasAttachment = false;

    if (c.method === 'replyMessage' || c.method === 'editMessage') {
      const opts = (c.args[1] ?? {}) as Record<string, unknown>;
      const raw = opts['message'];
      message =
        raw !== null && typeof raw === 'object'
          ? ((raw as Record<string, unknown>)['message'] ?? null)
          : (raw ?? null);
      hasAttachment =
        Array.isArray(opts['attachment']) &&
        (opts['attachment'] as unknown[]).length > 0;
    } else if (c.method === 'sendMessage') {
      const p = c.args[0];
      if (typeof p === 'string') message = p;
      else if (p !== null && typeof p === 'object') {
        const o = p as Record<string, unknown>;
        message = o['message'] ?? o['body'] ?? null;
        hasAttachment =
          Array.isArray(o['attachment']) &&
          (o['attachment'] as unknown[]).length > 0;
      }
    }

    return {
      type: c.method,
      sourceCommand: c.sourceCommand,
      message,
      hasAttachment,
    };
  });
}

// ============================================================================
// TOOL RUN
// ============================================================================

export const run = async (
  args: {
    prompt?: unknown;
    command?: unknown;
    ratio?: unknown;
    image_url?: unknown;
  },
  ctx: AppCtx,
): Promise<string> => {
  const { senderID, threadID, sessionUserId, sessionId, platform } =
    resolveAgentContext(ctx);

  const prompt = typeof args.prompt === 'string' ? args.prompt.trim() : '';
  if (!prompt) {
    return (
      'Error: generate_image requires a non-empty `prompt` describing the ' +
      'image to generate (or how to transform the provided image).'
    );
  }
  const explicit =
    typeof args.command === 'string' ? args.command.trim().toLowerCase() : '';
  const ratio = typeof args.ratio === 'string' ? args.ratio.trim() : '';
  // Explicit URL first; otherwise fall back to an image attached to the
  // triggering message (or the replied-to message) so image-to-image requests
  // "just work" without the model ever seeing the CDN URL.
  const imageUrl =
    (typeof args.image_url === 'string' ? args.image_url.trim() : '') ||
    (extractEventImageUrls(ctx.event)[0]?.url ?? '');

  // Discover the live AI Image command set — new category members are picked up automatically.
  const aiImageCommands = discoverAiImageCommands(ctx);
  if (aiImageCommands.length === 0) {
    return 'Error: No AI Image commands are currently available on this bot.';
  }

  // Resolve which command to run and its arguments.
  const resolved = resolveAiImageCommand(
    { prompt, explicit, ratio, imageUrl },
    aiImageCommands,
  );
  if (resolved.error) return resolved.error;
  const command = resolved.command!;
  const argsList = resolved.argsList!;

  const mod = ctx.commands.get(command);
  if (!mod || typeof mod['onCommand'] !== 'function') {
    return `Error: Command '${command}' is not available on this bot right now.`;
  }

  // ── Per-message command budget (same rule as test_command) ────────────────
  type CommandBudget = { used: number; limit: number };
  const budget = (ctx as unknown as Record<string, unknown>)[
    '_agentCommandBudget'
  ] as CommandBudget | undefined;
  if (budget !== undefined) {
    const remaining = budget.limit - budget.used;
    if (remaining <= 0) {
      return (
        `⚠️ Command limit reached. You may only request up to ${budget.limit} ` +
        `commands per message. No further commands will be executed.`
      );
    }
    budget.used += 1;
  }

  // ── Constraint guard (role / ban / cooldown) — mirrors test_command ────────
  const guard = await inspectCommandConstraints(
    mod,
    command,
    senderID,
    threadID,
    sessionUserId,
    platform,
    sessionId,
    false,
  );
  if (!guard.allowed) {
    return `Command '${command}' blocked: ${guard.reason}`;
  }

  // ── Execute the command under a capturing proxy ───────────────────────────
  try {
    const simulatedMessage =
      `${ctx.prefix || '/'}${command} ${argsList.join(' ')}`.trim();
    const simulatedEvent: Record<string, unknown> = {
      ...ctx.event,
      message: simulatedMessage,
      body: simulatedMessage,
    };
    // Image-to-image commands (nanobanana) read the source image from event
    // attachments — inject the user-provided URL so the command finds it.
    if (imageUrl) {
      simulatedEvent['attachments'] = [
        { type: 'photo', url: imageUrl, filename: 'image.png', name: 'image.png' },
      ];
    }

    const rawIntercepted: Array<{
      method: string;
      args: unknown[];
      sourceCommand: string;
    }> = [];
    const rawBinaryAttachments: BinaryAttachment[] = [];
    let currentRunningCommand = '';

    const mockApi = new Proxy(ctx.api, {
      get(target, prop, receiver) {
        if (typeof prop === 'string' && SIDE_EFFECT_METHODS.has(prop)) {
          return async (...mArgs: unknown[]) => {
            // Extract Buffer payloads BEFORE normalization — unrecoverable after
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

    currentRunningCommand = command;
    const commandCtx: OnCommandCtx = {
      ...ctx,
      api: mockApi,
      event: simulatedEvent,
      parsed: { name: command, args: argsList },
      prefix: ctx.prefix || '/',
      mod,
      options: OptionsMap.empty(),
    };

    await dispatchCommand(
      commandCtx.parsed!,
      commandCtx,
      mockApi,
      threadID,
      commandCtx.prefix,
    );

    if (rawIntercepted.length === 0) {
      return `Command '${command}' executed but produced no output.`;
    }

    const storableCalls: InterceptedCall[] = rawIntercepted.map((entry) => ({
      type: entry.method,
      args: entry.args,
      sourceCommand: entry.sourceCommand,
    }));

    const eventMessageID = (ctx.event['messageID'] as string) || '';
    const key = commandResultStore.generateKey(
      sessionUserId,
      platform,
      sessionId,
      threadID,
      eventMessageID,
      command,
    );
    commandResultStore.set(key, storableCalls);

    // Binary image bytes stored under `${key}:bin` for send_result delivery.
    const binaryKey =
      rawBinaryAttachments.length > 0 ? `${key}:bin` : null;
    if (binaryKey) {
      commandResultStore.setBinaryAttachments(binaryKey, rawBinaryAttachments);
    }

    // Accumulate the captured image on the per-turn store so send_result
    // auto-delivers it even if the model omits the binary key.
    const pending = getPendingMedia(ctx);
    pending.binaries.push(...rawBinaryAttachments);

    return JSON.stringify(
      {
        key,
        binary_attachment_key: binaryKey,
        command,
        prompt,
        generated: binaryKey !== null,
        calls: summarizeCalls(rawIntercepted),
        note:
          'The image was captured. Call `send_result` once with your synthesized ' +
          'caption as `message` and pass `binary_attachment_key` (if non-null) in ' +
          'the `attachment` array to deliver the image. ' +
          (binaryKey === null
            ? 'No image bytes were produced — relay the failure text from `calls` to the user.'
            : ''),
      },
      null,
      2,
    );
  } catch (err) {
    return `Image generation error: ${
      err instanceof Error ? err.message : String(err)
    }`;
  }
};
