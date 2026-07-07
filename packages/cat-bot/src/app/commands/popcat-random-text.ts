/**
 * Popcat Random Text — multi-command family (single file, config-driven)
 *
 * Every entry hits a JSON api.popcat.xyz/v2/<endpoint> route and pulls a
 * short piece of text out of the identically-shaped envelope
 * `{ error: boolean, message: {...} }`. One PROMPT_CONFIGS table declares
 * each provider's shape (endpoint, optional input param, how to format the
 * `message` object into display text), and one shared runPrompt() handler
 * dispatches on that config — adding another api.popcat.xyz/v2/* text
 * endpoint later means appending one config object, no new onCommand
 * function required.
 *
 * Commands:
 *   /8ball — Magic 8-ball answer to a yes/no question  (aliases: eightball, ball)
 *            requires a question, e.g. "/8ball Will it rain today?"
 *   /fact  — random fact                                (aliases: randomfact)
 *   /wyr   — random "Would You Rather" question pair     (aliases: wouldyourather)
 *
 * The loader (`engine/app.ts` loadCommands) natively supports a file
 * exporting `commands: Array<{ meta, onCommand, button? }>` and registers
 * each entry exactly like a standalone command module.
 */

import axios from 'axios';
import type { AppCtx } from '@/engine/types/controller.types.js';
import { Role } from '@/engine/constants/role.constants.js';
import { OptionType } from '@/engine/modules/command/command-option.constants.js';
import { MessageStyle } from '@/engine/constants/message-style.constants.js';
import { ButtonStyle } from '@/engine/constants/button-style.constants.js';
import { hasNativeButtons } from '@/engine/utils/ui-capabilities.util.js';
import type { CommandMeta } from '@/engine/types/module-config.types.js';
import { createUrl } from '@/engine/lib/apis.lib.js';
import { logger } from '@/engine/modules/logger/logger.lib.js';

// ── Shared response envelope ──────────────────────────────────────────────────
//
// Every api.popcat.xyz/v2/* text endpoint responds with the same shape:
//   { error: boolean, message: <endpoint-specific object> }

interface PopcatEnvelope<T> {
  error: boolean;
  message?: T;
}

// ── Config ────────────────────────────────────────────────────────────────────

interface PromptConfig<T = Record<string, unknown>> {
  name: string;
  aliases: string[];
  version: string;
  description: string;
  cooldown: number;
  emoji: string;
  title: string;
  buttonLabel: string;
  path: string;
  /** When set, the command requires free-text input, sent under this query param. */
  inputParam?: string;
  /** Usage string shown when `inputParam` is required but missing. */
  usage: string;
  /** Formats the endpoint-specific `message` object down to display text. */
  formatMessage: (message: T) => string;
}

const PROMPT_CONFIGS: PromptConfig<any>[] = [
  {
    name: '8ball',
    aliases: ['eightball', 'ball'],
    version: '1.0.0',
    description: 'Ask the magic 8-ball a yes/no question.',
    cooldown: 5,
    emoji: '🎱',
    title: 'Magic 8-Ball',
    buttonLabel: '🔁 Ask Again',
    path: '/v2/8ball',
    inputParam: 'question',
    usage: '<question>',
    formatMessage: (message: { answer?: string }) => message.answer ?? '',
  },
  {
    name: 'fact',
    aliases: ['randomfact'],
    version: '1.0.0',
    description: 'Get a random fact.',
    cooldown: 5,
    emoji: '💡',
    title: 'Random Fact',
    buttonLabel: '🔁 Another Fact',
    path: '/v2/fact',
    usage: '',
    formatMessage: (message: { fact?: string }) => message.fact ?? '',
  },
  {
    name: 'wyr',
    aliases: ['wouldyourather'],
    version: '1.0.0',
    description: 'Get a random "Would You Rather" question.',
    cooldown: 5,
    emoji: '🤔',
    title: 'Would You Rather',
    buttonLabel: '🔁 Another One',
    path: '/v2/wyr',
    usage: '',
    formatMessage: (message: { ops1?: string; ops2?: string }) =>
      `Would you rather...\n\n**A)** ${message.ops1 ?? '?'}\n**B)** ${message.ops2 ?? '?'}`,
  },
];

// ── Shared fetcher ────────────────────────────────────────────────────────────

async function fetchPrompt(config: PromptConfig, input?: string): Promise<string> {
  const requestUrl = createUrl(
    'popcat',
    config.path,
    config.inputParam && input ? { [config.inputParam]: input } : {},
  );

  const { data } = await axios.get<PopcatEnvelope<Record<string, unknown>>>(requestUrl, {
    timeout: 10_000,
    headers: { Accept: 'application/json' },
  });

  if (data?.error || !data?.message) {
    throw new Error(`${config.title} API returned no data`);
  }

  const text = config.formatMessage(data.message);
  if (!text) throw new Error(`${config.title} API returned an empty response`);

  return text;
}

// ── Shared handler ────────────────────────────────────────────────────────────

function buttonId(config: PromptConfig): string {
  return `${config.name}-again`;
}

async function runPrompt(ctx: AppCtx, config: PromptConfig): Promise<void> {
  const { chat, native, event, args, button, session, usage } = ctx;
  const isButtonAction = event['type'] === 'button_action';

  // Input-driven commands (currently only /8ball) require an argument on a
  // fresh invocation. On a button refresh, the original question is recovered
  // from the button's persisted context rather than from args (button clicks
  // carry no args of their own) — mirrors the pattern used by bible.ts's
  // switch-translation button.
  let input: string | undefined;
  if (config.inputParam) {
    if (isButtonAction) {
      input = (session.context as { question?: string }).question ?? '';
    } else {
      input = args.join(' ').trim();
      if (!input) {
        await usage();
        return;
      }
    }
  }

  try {
    const text = await fetchPrompt(config, input);

    const resolvedButtonId = isButtonAction
      ? session.id
      : button.generateID({ id: buttonId(config), public: true });

    // Persist (or refresh the TTL on) the original question so the next
    // "Ask Again" click can re-derive it from session.context.
    if (config.inputParam) {
      button.createContext({ id: resolvedButtonId, context: { question: input } });
    }

    const questionLine = config.inputParam && input ? `❓ **${input}**\n\n` : '';
    const message = `${config.emoji} **${config.title}**\n\n${questionLine}${text}`;

    const payload = {
      style: MessageStyle.MARKDOWN,
      message,
      ...(hasNativeButtons(native.platform) ? { button: [resolvedButtonId] } : {}),
    };

    if (isButtonAction) {
      await chat.editMessage({ ...payload, message_id_to_edit: event['messageID'] as string });
    } else {
      await chat.replyMessage(payload);
    }
  } catch (err) {
    const errMessage = err instanceof Error ? err.message : String(err);
    logger.warn(`[popcat-random-text] ${config.name} failed: ${errMessage}`);

    const errPayload = {
      style: MessageStyle.MARKDOWN,
      message: `⚠️ **Error:** Failed to fetch ${config.title.toLowerCase()}. Please try again later.`,
    };
    if (isButtonAction) {
      await chat.editMessage({ ...errPayload, message_id_to_edit: event['messageID'] as string });
    } else {
      await chat.replyMessage(errPayload);
    }
  }
}

// ── Command entry generation ──────────────────────────────────────────────────

interface CommandEntry {
  meta: CommandMeta;
  onCommand: (ctx: AppCtx) => Promise<void>;
  button: Record<
    string,
    { label: string; style: (typeof ButtonStyle)[keyof typeof ButtonStyle]; onClick: (ctx: AppCtx) => Promise<void> }
  >;
}

export const commands: CommandEntry[] = PROMPT_CONFIGS.map((config) => ({
  meta: {
    name: config.name,
    aliases: config.aliases,
    version: config.version,
    role: Role.ANYONE,
    author: 'AjiroDesu',
    description: config.description,
    category: 'random',
    usage: config.usage,
    cooldown: config.cooldown,
    hasPrefix: true,
    ...(config.inputParam
      ? {
          options: [
            {
              type: OptionType.string,
              name: config.inputParam,
              description: `Input for ${config.title}`,
              required: true,
            },
          ],
        }
      : {}),
  },
  onCommand: async (ctx: AppCtx) => runPrompt(ctx, config),
  button: {
    [buttonId(config)]: {
      label: config.buttonLabel,
      style: ButtonStyle.PRIMARY,
      onClick: async (ctx: AppCtx) => runPrompt(ctx, config),
    },
  },
}));
