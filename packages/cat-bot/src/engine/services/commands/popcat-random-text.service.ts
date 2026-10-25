/**
 * Popcat Random Text Service — shared implementation for /8ball, /fact, /wyr,
 * and /pickupline.
 *
 * Every endpoint responds with `{ error: boolean, message: {...} }`. Each config
 * owns its response formatter and optional input parameter. Input-driven
 * commands persist their original input in button context so a refresh can
 * recover it (button clicks carry no args).
 */

import axios from 'axios';
import { ButtonStyle } from '@/engine/constants/button-style.constants.js';
import { MessageStyle } from '@/engine/constants/message-style.constants.js';
import { createUrl } from '@/engine/lib/apis.lib.js';
import { logger } from '@/engine/modules/logger/logger.lib.js';
import type { AppCtx } from '@/engine/types/controller.types.js';
import { hasNativeButtons } from '@/engine/utils/ui-capabilities.util.js';

interface PopcatEnvelope<T> {
  error: boolean;
  message?: T;
}

export interface PromptConfig<T> {
  name: string;
  emoji: string;
  title: string;
  buttonLabel: string;
  path: string;
  /** When set, the command accepts optional free-text input, sent under this query param. */
  inputParam?: string;
  /** Formats the endpoint-specific `message` object down to display text. */
  formatMessage: (message: T) => string;
}

async function fetchPrompt<T>(
  config: PromptConfig<T>,
  input?: string,
): Promise<string> {
  const requestUrl = createUrl(
    'popcat',
    config.path,
    config.inputParam && input ? { [config.inputParam]: input } : {},
  );

  const { data } = await axios.get<PopcatEnvelope<T>>(requestUrl, {
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

export function promptButtonId<T>(config: PromptConfig<T>): string {
  return `${config.name}-again`;
}

/** Runs the shared random-text flow for a family config. */
export async function runPrompt<T>(
  ctx: AppCtx,
  config: PromptConfig<T>,
): Promise<void> {
  const { chat, native, event, args, button, session } = ctx;
  const isButtonAction = event['type'] === 'button_action';

  // Input-driven commands (currently only /8ball) accept an optional argument
  // on a fresh invocation — no question at all is a valid "blind roll". On a
  // button refresh, the original question (if any) is recovered from the
  // button's persisted context rather than from args.
  let input: string | undefined;
  if (config.inputParam) {
    input = isButtonAction
      ? ((session.context as { question?: string }).question ?? '')
      : args.join(' ').trim();
  }

  try {
    const text = await fetchPrompt(config, input);

    const resolvedButtonId = isButtonAction
      ? session.id
      : button.generateID({ id: promptButtonId(config), public: true });

    // Persist (or refresh the TTL on) the original question so the next
    // "Ask Again" click can re-derive it from session.context.
    if (config.inputParam) {
      button.createContext({
        id: resolvedButtonId,
        context: { question: input },
      });
    }

    const questionLine =
      config.inputParam && input ? `❓ **${input}**\n\n` : '';
    const message = `${config.emoji} **${config.title}**\n\n${questionLine}${text}`;

    const payload = {
      style: MessageStyle.MARKDOWN,
      message,
      ...(hasNativeButtons(native.platform)
        ? { button: [resolvedButtonId] }
        : {}),
    };

    if (isButtonAction) {
      await chat.editMessage({
        ...payload,
        message_id_to_edit: event['messageID'] as string,
      });
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
      await chat.editMessage({
        ...errPayload,
        message_id_to_edit: event['messageID'] as string,
      });
    } else {
      await chat.replyMessage(errPayload);
    }
  }
}

export interface PromptButtonDefinition {
  label: string;
  style: (typeof ButtonStyle)[keyof typeof ButtonStyle];
  onClick: (ctx: AppCtx) => Promise<void>;
}

/** Builds the refresh button for a family config. */
export function createPromptButton<T>(
  config: PromptConfig<T>,
): Record<string, PromptButtonDefinition> {
  return {
    [promptButtonId(config)]: {
      label: config.buttonLabel,
      style: ButtonStyle.PRIMARY,
      onClick: async (ctx: AppCtx): Promise<void> => runPrompt(ctx, config),
    },
  };
}

export const eightBallConfig: PromptConfig<{ answer?: string }> = {
  name: '8ball',
  emoji: '🎱',
  title: 'Magic 8-Ball',
  buttonLabel: '🔁 Ask Again',
  path: '/v2/8ball',
  inputParam: 'question',
  formatMessage: (message) => message.answer ?? '',
};

export const factPromptConfig: PromptConfig<{ fact?: string }> = {
  name: 'fact',
  emoji: '💡',
  title: 'Random Fact',
  buttonLabel: '🔁 Another Fact',
  path: '/v2/fact',
  formatMessage: (message) => message.fact ?? '',
};

export const wyrConfig: PromptConfig<{ ops1?: string; ops2?: string }> = {
  name: 'wyr',
  emoji: '🤔',
  title: 'Would You Rather',
  buttonLabel: '🔁 Another One',
  path: '/v2/wyr',
  formatMessage: (message) =>
    `Would you rather...\n\n**A)** ${message.ops1 ?? '?'}\n**B)** ${message.ops2 ?? '?'}`,
};

export const pickupLineConfig: PromptConfig<{
  pickupline?: string;
  contributor?: string;
}> = {
  name: 'pickupline',
  emoji: '💘',
  title: 'Pickup Line',
  buttonLabel: '🔁 Another One',
  path: '/v2/pickuplines',
  formatMessage: (message) =>
    `${message.pickupline ?? ''}${
      message.contributor ? `\n\n_— contributed by ${message.contributor}_` : ''
    }`,
};
