/**
 * Random Animal Photos — multi-command family (single file, config-driven)
 *
 * Merges the previously-standalone cat.ts / fox.ts / duck.ts modules into one
 * file. Same architecture as periodic-table.ts / popcat-media.ts: one
 * ANIMAL_CONFIGS table declares each provider's shape (endpoint, how to pull
 * the image URL out of its response, emoji, button label), and one shared
 * runEffect() dispatches on that config. Adding a new animal-photo API later
 * means appending one config object — no new onCommand function required.
 *
 * Each provider has its own response shape, so `extractUrl` is the one
 * per-config hook that normalizes it down to a plain image URL string:
 *   - The Cat API   → `[{ url }]`            (array)
 *   - RandomFox     → `{ image }`
 *   - random-d.uk   → `{ url }`
 *
 * Commands:
 *   /cat   — random cat image  (aliases: catpic, catimage, meow)
 *   /fox   — random fox image  (aliases: foxpic, foximage, floof)
 *   /duck  — random duck image (aliases: duckpic, duckimage, quack)
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

interface AnimalConfig {
  name: string;
  aliases: string[];
  label: string;
  emoji: string;
  buttonLabel: string;
  apiUrl: string;
  apiParams?: Record<string, string>;
  /** Normalizes whatever shape this provider returns down to an image URL. */
  extractUrl: (data: unknown) => string | null;
}

const ANIMAL_CONFIGS: AnimalConfig[] = [
  {
    name: 'cat',
    aliases: ['catpic', 'catimage', 'meow'],
    label: 'Random Cat Image',
    emoji: '🐱',
    buttonLabel: '🔁 Another Cat',
    apiUrl: 'https://api.thecatapi.com/v1/images/search',
    apiParams: { mime_types: 'jpg,png,gif' },
    extractUrl: (data) =>
      (data as Array<{ url?: string }> | undefined)?.[0]?.url || null,
  },
  {
    name: 'fox',
    aliases: ['foxpic', 'foximage', 'floof'],
    label: 'Random Fox Image',
    emoji: '🦊',
    buttonLabel: '🔁 Floof Again',
    apiUrl: 'https://randomfox.ca/floof/',
    extractUrl: (data) => (data as { image?: string } | undefined)?.image || null,
  },
  {
    name: 'duck',
    aliases: ['duckpic', 'duckimage', 'quack'],
    label: 'Random Duck Image',
    emoji: '🦆',
    buttonLabel: '🔁 Another Duck',
    apiUrl: 'https://random-d.uk/api/random',
    extractUrl: (data) => (data as { url?: string } | undefined)?.url || null,
  },
];

// ── Shared fetcher ────────────────────────────────────────────────────────────

async function fetchAnimalImage(config: AnimalConfig): Promise<string | null> {
  try {
    const { data } = await axios.get(config.apiUrl, {
      params: config.apiParams,
      headers: { Accept: 'application/json' },
      timeout: 10000,
    });
    return config.extractUrl(data);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[${config.name}] fetchAnimalImage error:`, msg);
    return null;
  }
}

// ── Shared handler ────────────────────────────────────────────────────────────

function buttonId(config: AnimalConfig): string {
  return `${config.name}-next`;
}

async function runEffect(ctx: AppCtx, config: AnimalConfig): Promise<void> {
  const { chat, native, event, button, session } = ctx;

  try {
    const imageUrl = await fetchAnimalImage(config);

    if (!imageUrl) {
      const errPayload = {
        style: MessageStyle.MARKDOWN,
        message: `⚠️ **Error:** Could not retrieve a ${config.name} image.`,
      };
      if (event['type'] === 'button_action') {
        await chat.editMessage({
          ...errPayload,
          message_id_to_edit: event['messageID'] as string,
        });
      } else {
        await chat.replyMessage(errPayload);
      }
      return;
    }

    // Derive the file extension so MIME detection works correctly on all
    // platforms — these providers occasionally serve gifs alongside photos.
    const extMatch = imageUrl.match(/\.(jpg|jpeg|png|gif|webp)(\?|$)/i);
    const ext = extMatch ? extMatch[1] : 'jpg';

    const resolvedButtonId =
      event['type'] === 'button_action'
        ? session.id
        : button.generateID({ id: buttonId(config), public: true });

    const payload = {
      style: MessageStyle.MARKDOWN,
      message: `${config.emoji} **${config.label}**`,
      attachment_url: [{ name: `${config.name}.${ext}`, url: imageUrl }],
      ...(hasNativeButtons(native.platform) ? { button: [resolvedButtonId] } : {}),
    };

    if (event['type'] === 'button_action') {
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
      message: `⚠️ **System Error:** Failed to fetch a ${config.name} image. Please try again later.`,
    };
    if (event['type'] === 'button_action') {
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

export const commands: CommandEntry[] = ANIMAL_CONFIGS.map((config) => ({
  meta: {
    name: config.name,
    aliases: config.aliases,
    version: '1.0.0',
    role: Role.ANYONE,
    author: 'AjiroDesu',
    description: `Send a random ${config.name} image.`,
    category: 'random',
    usage: '',
    cooldown: 5,
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