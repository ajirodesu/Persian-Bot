/**
 * Popcat Text Converters — multi-command family (single file, config-driven)
 *
 * Every entry hits a JSON api.popcat.xyz/v2/<endpoint> route that converts a
 * required input string into a transformed output string, responding with
 * the identically-shaped envelope `{ error: boolean, message: { text: string } }`.
 * One CONVERTER_CONFIGS table declares each provider's shape (endpoint, the
 * name of its required input query param, display copy), and one shared
 * runConverter() handler dispatches on that config — adding another
 * api.popcat.xyz/v2/* converter endpoint later means appending one config
 * object, no new onCommand function required.
 *
 * Commands:
 *   /encode       — text        -> binary                (aliases: tobinary)
 *   /decode       — binary      -> text                  (aliases: frombinary)
 *   /doublestruck — text        -> 𝕕𝕠𝕦𝕓𝕝𝕖-𝕤𝕥𝕣𝕦𝕔𝕜 unicode text
 *   /emojipasta   — text        -> emoji-laden "emojipasta"
 *   /mock         — text        -> SpOnGeBoB mOcKiNg case  (aliases: mockingcase, spongebob)
 *   /lulcat       — text        -> LOLcat-speak            (aliases: lolcat)
 *
 * The loader (`engine/app.ts` loadCommands) natively supports a file
 * exporting `commands: Array<{ meta, onCommand }>` and registers each entry
 * exactly like a standalone command module.
 *
 * Flow (per command):
 *   User: /encode hello
 *   Bot:  🔐 **Encode**
 *
 *         0110100001100101011011000110110001101111
 */

import axios from 'axios';
import type { AppCtx } from '@/engine/types/controller.types.js';
import { Role } from '@/engine/constants/role.constants.js';
import { OptionType } from '@/engine/modules/command/command-option.constants.js';
import { MessageStyle } from '@/engine/constants/message-style.constants.js';
import type { CommandMeta } from '@/engine/types/module-config.types.js';
import { createUrl } from '@/engine/lib/apis.lib.js';
import { logger } from '@/engine/modules/logger/logger.lib.js';

// ── Shared response envelope ──────────────────────────────────────────────────
//
// Every api.popcat.xyz/v2/* converter endpoint responds with the same shape:
//   { error: boolean, message: { text: string } }

interface ConverterEnvelope {
  error: boolean;
  message?: { text?: string };
}

// ── Config ────────────────────────────────────────────────────────────────────

interface ConverterConfig {
  name: string;
  aliases: string[];
  path: string;
  /** Name of the query param the input string is sent under (e.g. "text", "binary"). */
  paramName: string;
  label: string;
  emoji: string;
  description: string;
  example: string;
}

const CONVERTER_CONFIGS: ConverterConfig[] = [
  {
    name: 'encode',
    aliases: ['tobinary'],
    path: '/v2/encode',
    paramName: 'text',
    label: 'Encode',
    emoji: '🔐',
    description: 'Convert text into binary code.',
    example: 'hello',
  },
  {
    name: 'decode',
    aliases: ['frombinary'],
    path: '/v2/decode',
    paramName: 'binary',
    label: 'Decode',
    emoji: '🔓',
    description: 'Convert binary code back into text.',
    example: '0110100001100101011011000110110001101111',
  },
  {
    name: 'doublestruck',
    aliases: ['blackboardbold'],
    path: '/v2/doublestruck',
    paramName: 'text',
    label: 'Double-Struck',
    emoji: '🔤',
    description: 'Convert text into double-struck (blackboard bold) unicode text.',
    example: 'query',
  },
  {
    name: 'emojipasta',
    aliases: [],
    path: '/v2/emojipasta',
    paramName: 'text',
    label: 'Emojipasta',
    emoji: '🙍',
    description: 'Turn text into an emoji-laden "emojipasta".',
    example: "I love using the Pop Cat API. It's so cool!",
  },
  {
    name: 'mock',
    aliases: ['mockingcase', 'spongebob'],
    path: '/v2/mock',
    paramName: 'text',
    label: 'Mocking Case',
    emoji: '🧽',
    description: 'Convert text into SpOnGeBoB mOcKiNg-cAsE text.',
    example: 'hello',
  },
  {
    name: 'lulcat',
    aliases: ['lolcat'],
    path: '/v2/lulcat',
    paramName: 'text',
    label: 'Lulcat',
    emoji: '🐱',
    description: 'Convert text into LOLcat-speak.',
    example: 'hello',
  },
];

// ── Shared fetcher ────────────────────────────────────────────────────────────

async function fetchConversion(config: ConverterConfig, input: string): Promise<string> {
  const requestUrl = createUrl('popcat', config.path, { [config.paramName]: input });

  const { data } = await axios.get<ConverterEnvelope>(requestUrl, {
    timeout: 10_000,
    headers: { Accept: 'application/json' },
    validateStatus: () => true,
  });

  const text = data?.message?.text;
  if (data?.error || !text) {
    throw new Error(`${config.label} API returned no result`);
  }

  return text;
}

// ── Shared handler ────────────────────────────────────────────────────────────

async function runConverter(ctx: AppCtx, config: ConverterConfig): Promise<void> {
  const { chat, args, usage } = ctx;

  const input = args.join(' ').trim();
  if (!input) {
    await usage();
    return;
  }

  try {
    const result = await fetchConversion(config, input);

    await chat.replyMessage({
      style: MessageStyle.MARKDOWN,
      message: `${config.emoji} **${config.label}**\n\n${result}`,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.warn(`[popcat-conventer] ${config.name} failed: ${message}`);

    await chat.replyMessage({
      style: MessageStyle.MARKDOWN,
      message: `⚠️ Failed to ${config.label.toLowerCase()}: \`${message}\``,
    });
  }
}

// ── Command entry generation ──────────────────────────────────────────────────

interface CommandEntry {
  meta: CommandMeta;
  onCommand: (ctx: AppCtx) => Promise<void>;
}

export const commands: CommandEntry[] = CONVERTER_CONFIGS.map((config) => ({
  meta: {
    name: config.name,
    aliases: config.aliases,
    version: '1.0.0',
    role: Role.ANYONE,
    author: 'AjiroDesu',
    description: config.description,
    category: 'converter',
    usage: `<${config.paramName}>`,
    cooldown: 5,
    hasPrefix: true,
    options: [
      {
        type: OptionType.string,
        name: config.paramName,
        description: `Input to convert (e.g. "${config.example}")`,
        required: true,
      },
    ],
  },
  onCommand: async (ctx: AppCtx) => runConverter(ctx, config),
}));