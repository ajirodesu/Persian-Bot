/**
 * Random Text Facts Service — shared implementation for the random-text family
 * (/advice, /catfact, /dogfact, /funfact, /joke, /quote).
 *
 * Each provider has its own response shape, so `fetchText` is the one
 * per-config hook that normalizes it down to a plain, ready-to-send string (or
 * null on failure). Fresh /quote invocations fall back to a fixed quote instead
 * of an error; button refreshes still show a plain error.
 */

import axios from 'axios';
import { ButtonStyle } from '@/engine/constants/button-style.constants.js';
import { MessageStyle } from '@/engine/constants/message-style.constants.js';
import type { AppCtx } from '@/engine/types/controller.types.js';
import { hasNativeButtons } from '@/engine/utils/ui-capabilities.util.js';
import { createMessageDelivery } from './message-delivery.service.js';

export interface TextConfig {
  name: string;
  emoji: string;
  title: string;
  buttonLabel: string;
  /** Sent on a fresh (non-button) command when the fetch comes back empty. */
  fallbackMessage?: string;
  /** Normalizes whatever shape this provider returns down to display text. */
  fetchText: () => Promise<string | null>;
}

export function randomTextButtonId(config: TextConfig): string {
  return `${config.name}-next`;
}

/** Runs the shared random-text flow for a family config. */
export async function runRandomTextFact(
  ctx: AppCtx,
  config: TextConfig,
): Promise<void> {
  const { chat, native, event, button, session } = ctx;
  const isButtonAction = event['type'] === 'button_action';
  const delivery = createMessageDelivery(ctx);

  try {
    const text = await config.fetchText();

    if (!text) {
      // Fresh command + a configured fallback (e.g. /quote) → send the
      // fallback message instead of a bare error.
      if (!isButtonAction && config.fallbackMessage) {
        await chat.replyMessage({
          style: MessageStyle.MARKDOWN,
          message: config.fallbackMessage,
        });
        return;
      }

      await delivery.fail(
        `⚠️ **Error:** Could not retrieve ${config.title.toLowerCase()}. Please try again later.`,
      );
      return;
    }

    const resolvedButtonId = isButtonAction
      ? session.id
      : button.generateID({ id: randomTextButtonId(config), public: true });

    const message = `${config.emoji} **${config.title}**\n\n${text}`;

    await delivery.deliver({
      style: MessageStyle.MARKDOWN,
      message,
      ...(hasNativeButtons(native.platform)
        ? { button: [resolvedButtonId] }
        : {}),
    });
  } catch {
    await delivery.fail(
      `⚠️ **System Error:** Failed to fetch ${config.title.toLowerCase()}. Please try again later.`,
    );
  }
}

export interface TextButtonDefinition {
  label: string;
  style: (typeof ButtonStyle)[keyof typeof ButtonStyle];
  onClick: (ctx: AppCtx) => Promise<void>;
}

/** Builds the next-text button for a family config. */
export function createRandomTextButton(
  config: TextConfig,
): Record<string, TextButtonDefinition> {
  return {
    [randomTextButtonId(config)]: {
      label: config.buttonLabel,
      style: ButtonStyle.PRIMARY,
      onClick: async (ctx: AppCtx): Promise<void> =>
        runRandomTextFact(ctx, config),
    },
  };
}

export const adviceConfig: TextConfig = {
  name: 'advice',
  emoji: '💡',
  title: 'Advice',
  buttonLabel: '🔁 Another',
  fetchText: async () => {
    try {
      const { data } = await axios.get('https://api.adviceslip.com/advice', {
        timeout: 5000,
        headers: { Accept: 'application/json' },
      });
      return (data?.slip?.advice as string) || null;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error('[advice] fetchText error:', msg);
      return null;
    }
  },
};

export const catFactConfig: TextConfig = {
  name: 'catfact',
  emoji: '✨',
  title: 'Cat Fact',
  buttonLabel: '🔁 Random Fact',
  fetchText: async () => {
    try {
      const { data } = await axios.get('https://catfact.ninja/fact', {
        headers: { Accept: 'application/json' },
        timeout: 10000,
      });
      return (data?.fact as string) || null;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error('[catfact] fetchText error:', msg);
      return null;
    }
  },
};

export const dogFactConfig: TextConfig = {
  name: 'dogfact',
  emoji: '🐶',
  title: 'Dog Fact',
  buttonLabel: '🐾 Another Fact',
  fetchText: async () => {
    try {
      const { data: json } = await axios.get(
        'https://dogapi.dog/api/v2/facts?limit=1',
      );
      const fact = json?.data?.[0];
      return (fact?.attributes?.body as string) || null;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error('[dogfact] fetchText error:', msg);
      return null;
    }
  },
};

export const funFactConfig: TextConfig = {
  name: 'funfact',
  emoji: '💡',
  title: 'Did you know?',
  buttonLabel: '🔁 Next Fact',
  fetchText: async () => {
    try {
      const { data } = await axios.get(
        'https://uselessfacts.jsph.pl/random.json?language=en',
        { timeout: 8000 },
      );
      return (data?.text as string) || null;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error('[funfact] fetchText error:', msg);
      return null;
    }
  },
};

export const jokeConfig: TextConfig = {
  name: 'joke',
  emoji: '🤣',
  title: 'Random Joke',
  buttonLabel: '🔄 Next Joke',
  fetchText: async () => {
    try {
      const { data } = await axios.get(
        'https://official-joke-api.appspot.com/random_joke',
        { timeout: 10000 },
      );
      if (!data?.setup || !data?.punchline) {
        throw new Error('Invalid data structure received from API');
      }
      return `**${data.setup as string}**\n\n_${data.punchline as string}_`;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error('[joke] fetchText error:', msg);
      return null;
    }
  },
};

export const quoteConfig: TextConfig = {
  name: 'quote',
  emoji: '📜',
  title: 'Quote of the Moment',
  buttonLabel: '🔁 Inspire Me',
  fallbackMessage:
    `📜 **Quote of the Moment**\n\n` +
    `_"Life is what happens when you're busy making other plans."_\n\n` +
    `— **John Lennon**`,
  fetchText: async () => {
    try {
      const { data } = await axios.get('https://dummyjson.com/quotes/random', {
        headers: { Accept: 'application/json' },
        timeout: 8000,
      });
      if (!data?.quote) return null;
      const author = (data.author as string) || 'Unknown';
      return `_"${data.quote as string}"_\n\n— **${author}**`;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error('[quote] fetchText error:', msg);
      return null;
    }
  },
};
