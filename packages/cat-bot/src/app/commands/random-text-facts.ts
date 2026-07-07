/**
 * Random Text Facts — multi-command family (single file, config-driven)
 *
 * Merges the previously-standalone advice.ts / catfact.ts / dogfact.ts /
 * funfact.ts / joke.ts / quote.ts modules into one file. Same architecture
 * as animal-photos.ts / periodic-table.ts / popcat-media.ts: one
 * TEXT_CONFIGS table declares each provider's shape (endpoint, how to pull
 * the display text out of its response, emoji, title, button label), and one
 * shared runEffect() dispatches on that config. Adding a new "random text"
 * API later means appending one config object — no new onCommand function
 * required.
 *
 * Each provider has its own response shape, so `fetchText` is the one
 * per-config hook that normalizes it down to a plain, ready-to-send string
 * (or `null` on failure):
 *   - Advice Slip     → `{ slip: { advice } }`
 *   - catfact.ninja   → `{ fact }`
 *   - Dog API v2      → `{ data: [{ attributes: { body } }] }`
 *   - uselessfacts    → `{ text }`
 *   - Official Joke   → `{ setup, punchline }`               (pre-formatted)
 *   - dummyjson       → `{ quote, author }`                    (pre-formatted)
 *
 * Commands:
 *   /advice   — random life advice        (aliases: tips)
 *   /catfact  — random cat fact           (aliases: catfacts, meowfact)
 *   /dogfact  — random dog fact           (aliases: df, dogfacts)
 *   /funfact  — random useless/fun fact
 *   /joke     — random setup/punchline joke (aliases: telljoke, haha, funny)
 *   /quote    — random inspirational quote  (aliases: inspire, motivation)
 *
 * The loader (`engine/app.ts` loadCommands) natively supports a file
 * exporting `commands: Array<{ meta, onCommand, button? }>` and registers
 * each entry exactly like a standalone command module.
 */

import axios from 'axios';
import type { AppCtx } from '@/engine/types/controller.types.js';
import { Role } from '@/engine/constants/role.constants.js';
import { MessageStyle } from '@/engine/constants/message-style.constants.js';
import { ButtonStyle } from '@/engine/constants/button-style.constants.js';
import { hasNativeButtons } from '@/engine/utils/ui-capabilities.util.js';
import type { CommandMeta } from '@/engine/types/module-config.types.js';

// ── Config ────────────────────────────────────────────────────────────────────

interface TextConfig {
  name: string;
  aliases: string[];
  version: string;
  author: string;
  description: string;
  cooldown: number;
  emoji: string;
  title: string;
  buttonLabel: string;
  /** Sent on a fresh (non-button) command when the fetch comes back empty. */
  fallbackMessage?: string;
  /** Normalizes whatever shape this provider returns down to display text. */
  fetchText: () => Promise<string | null>;
}

const TEXT_CONFIGS: TextConfig[] = [
  {
    name: 'advice',
    aliases: ['tips'],
    version: '1.1.0',
    author: 'AjiroDesu (ported to Cat-Bot)',
    description: 'Get random life advice.',
    cooldown: 5,
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
  },
  {
    name: 'catfact',
    aliases: ['catfacts', 'meowfact'],
    version: '1.1.0',
    author: 'AjiroDesu (ported to Cat-Bot)',
    description: 'Get a random interesting fact about cats.',
    cooldown: 5,
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
  },
  {
    name: 'dogfact',
    aliases: ['df', 'dogfacts'],
    version: '1.0.0',
    author: 'AjiroDesu',
    description: 'Get a random fun fact about dogs.',
    cooldown: 5,
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
  },
  {
    name: 'funfact',
    aliases: [],
    version: '1.1.0',
    author: 'FunFactBotDev (ported to Cat-Bot)',
    description: 'Get a random fun fact to brighten your day.',
    cooldown: 5,
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
  },
  {
    name: 'joke',
    aliases: ['telljoke', 'haha', 'funny'],
    version: '1.2.0',
    author: 'JokeBotDev (ported to Cat-Bot)',
    description: 'Get a random joke to lighten the mood.',
    cooldown: 3,
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
  },
  {
    name: 'quote',
    aliases: ['inspire', 'motivation'],
    version: '1.1.0',
    author: 'AjiroDesu (ported to Cat-Bot)',
    description: 'Get a random inspirational quote.',
    cooldown: 5,
    emoji: '📜',
    title: 'Quote of the Moment',
    buttonLabel: '🔁 Inspire Me',
    // Fresh /quote invocations fall back to a fixed quote instead of an error
    // when the API is unreachable; button refreshes still show a plain error.
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
  },
];

// ── Shared handler ────────────────────────────────────────────────────────────

function buttonId(config: TextConfig): string {
  return `${config.name}-next`;
}

async function runEffect(ctx: AppCtx, config: TextConfig): Promise<void> {
  const { chat, native, event, button, session } = ctx;
  const isButtonAction = event['type'] === 'button_action';

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

      const errPayload = {
        style: MessageStyle.MARKDOWN,
        message: `⚠️ **Error:** Could not retrieve ${config.title.toLowerCase()}. Please try again later.`,
      };
      if (isButtonAction) {
        await chat.editMessage({
          ...errPayload,
          message_id_to_edit: event['messageID'] as string,
        });
      } else {
        await chat.replyMessage(errPayload);
      }
      return;
    }

    const resolvedButtonId = isButtonAction
      ? session.id
      : button.generateID({ id: buttonId(config), public: true });

    const message = `${config.emoji} **${config.title}**\n\n${text}`;

    const payload = {
      style: MessageStyle.MARKDOWN,
      message,
      ...(hasNativeButtons(native.platform) ? { button: [resolvedButtonId] } : {}),
    };

    if (isButtonAction) {
      await chat.editMessage({
        ...payload,
        message_id_to_edit: event['messageID'] as string,
      });
    } else {
      await chat.replyMessage(payload);
    }
  } catch {
    const errPayload = {
      style: MessageStyle.MARKDOWN,
      message: `⚠️ **System Error:** Failed to fetch ${config.title.toLowerCase()}. Please try again later.`,
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

// ── Command entry generation ──────────────────────────────────────────────────

interface CommandEntry {
  meta: CommandMeta;
  onCommand: (ctx: AppCtx) => Promise<void>;
  button: Record<
    string,
    { label: string; style: (typeof ButtonStyle)[keyof typeof ButtonStyle]; onClick: (ctx: AppCtx) => Promise<void> }
  >;
}

export const commands: CommandEntry[] = TEXT_CONFIGS.map((config) => ({
  meta: {
    name: config.name,
    aliases: config.aliases,
    version: config.version,
    role: Role.ANYONE,
    author: config.author,
    description: config.description,
    category: 'random',
    usage: '',
    cooldown: config.cooldown,
    hasPrefix: true,
  },
  onCommand: async (ctx: AppCtx) => runEffect(ctx, config),
  button: {
    [buttonId(config)]: {
      label: config.buttonLabel,
      style: ButtonStyle.PRIMARY,
      onClick: async (ctx: AppCtx) => runEffect(ctx, config),
    },
  },
}));
