/**
 * Morse Code — dual-command family (single file, self-made — no external API)
 *
 * Unlike the popcat-* command families, this one doesn't call a third-party
 * endpoint at all: the Morse Code <-> text table and both conversion
 * directions are implemented locally below.
 *
 * Spacing convention (applies to both directions):
 *   - Within a word, each letter's Morse code is separated by a single space.
 *   - Between words, a " / " separator is used.
 *   e.g. "hello world" <-> ".... . .-.. .-.. --- / .-- --- .-. .-.. -.."
 *
 * Commands:
 *   /morseencode — text  -> Morse code   (aliases: morseincode, tomorse, encodemorse)
 *   /morsedecode — Morse -> text         (aliases: frommorse, decodemorse)
 *
 * The loader (`engine/app.ts` loadCommands) natively supports a file
 * exporting `commands: Array<{ meta, onCommand }>` and registers each entry
 * exactly like a standalone command module.
 *
 * Flow (per command):
 *   User: /morseencode hello world
 *   Bot:  📡 **Morse Encode**
 *
 *         .... . .-.. .-.. --- / .-- --- .-. .-.. -..
 */

import type { AppCtx } from '@/engine/types/controller.types.js';
import { Role } from '@/engine/constants/role.constants.js';
import { OptionType } from '@/engine/modules/command/command-option.constants.js';
import { MessageStyle } from '@/engine/constants/message-style.constants.js';
import type { CommandMeta } from '@/engine/types/module-config.types.js';

// ── Morse Code table ──────────────────────────────────────────────────────────

const MORSE_MAP: Record<string, string> = {
  A: '.-', B: '-...', C: '-.-.', D: '-..', E: '.', F: '..-.',
  G: '--.', H: '....', I: '..', J: '.---', K: '-.-', L: '.-..',
  M: '--', N: '-.', O: '---', P: '.--.', Q: '--.-', R: '.-.',
  S: '...', T: '-', U: '..-', V: '...-', W: '.--', X: '-..-',
  Y: '-.--', Z: '--..',
  '0': '-----', '1': '.----', '2': '..---', '3': '...--', '4': '....-',
  '5': '.....', '6': '-....', '7': '--...', '8': '---..', '9': '----.',
  '.': '.-.-.-', ',': '--..--', '?': '..--..', "'": '.----.',
  '!': '-.-.--', '/': '-..-.', '(': '-.--.', ')': '-.--.-',
  '&': '.-...', ':': '---...', ';': '-.-.-.', '=': '-...-',
  '+': '.-.-.', '-': '-....-', '_': '..--.-', '"': '.-..-.',
  '$': '...-..-', '@': '.--.-.',
};

/** Reverse lookup: Morse token (e.g. ".-") -> letter (e.g. "A"). */
const TEXT_MAP: Record<string, string> = Object.fromEntries(
  Object.entries(MORSE_MAP).map(([letter, code]) => [code, letter]),
);

// ── Conversion helpers ────────────────────────────────────────────────────────

/**
 * Encodes plain text to Morse code. Words (split on whitespace) are
 * separated with " / "; letters within a word are separated by a single
 * space. Characters with no Morse mapping are dropped from the output.
 */
function encodeMorse(text: string): string {
  return text
    .trim()
    .split(/\s+/)
    .map((word) =>
      word
        .toUpperCase()
        .split('')
        .map((char) => MORSE_MAP[char])
        .filter((code): code is string => Boolean(code))
        .join(' '),
    )
    .filter((word) => word.length > 0)
    .join(' / ');
}

/**
 * Decodes Morse code back to plain text. Accepts " / " (or a bare "/") as
 * the word separator and any run of whitespace as the letter separator
 * within a word, mirroring encodeMorse()'s output spacing. Unrecognised
 * Morse tokens are dropped from the output.
 */
function decodeMorse(morse: string): string {
  return morse
    .trim()
    .split(/\s*\/\s*/)
    .map((word) =>
      word
        .trim()
        .split(/\s+/)
        .map((token) => TEXT_MAP[token])
        .filter((char): char is string => Boolean(char))
        .join(''),
    )
    .filter((word) => word.length > 0)
    .join(' ');
}

// ── Config ────────────────────────────────────────────────────────────────────

interface MorseConfig {
  name: string;
  aliases: string[];
  paramName: string;
  label: string;
  emoji: string;
  description: string;
  example: string;
  convert: (input: string) => string;
}

const MORSE_CONFIGS: MorseConfig[] = [
  {
    name: 'morseencode',
    aliases: ['morseincode', 'tomorse', 'encodemorse'],
    paramName: 'text',
    label: 'Morse Encode',
    emoji: '📡',
    description: 'Convert text into Morse code.',
    example: 'hello world',
    convert: encodeMorse,
  },
  {
    name: 'morsedecode',
    aliases: ['frommorse', 'decodemorse'],
    paramName: 'morse',
    label: 'Morse Decode',
    emoji: '📶',
    description: 'Convert Morse code back into text.',
    example: '.... . .-.. .-.. --- / .-- --- .-. .-.. -..',
    convert: decodeMorse,
  },
];

// ── Shared handler ────────────────────────────────────────────────────────────

async function runMorse(ctx: AppCtx, config: MorseConfig): Promise<void> {
  const { chat, args, usage } = ctx;

  const input = args.join(' ').trim();
  if (!input) {
    await usage();
    return;
  }

  const result = config.convert(input);

  if (!result) {
    await chat.replyMessage({
      style: MessageStyle.MARKDOWN,
      message: `⚠️ Couldn't ${config.name === 'morsedecode' ? 'decode' : 'encode'} any recognisable characters from that input.`,
    });
    return;
  }

  await chat.replyMessage({
    style: MessageStyle.MARKDOWN,
    message: `${config.emoji} **${config.label}**\n\n${result}`,
  });
}

// ── Command entry generation ──────────────────────────────────────────────────

interface CommandEntry {
  meta: CommandMeta;
  onCommand: (ctx: AppCtx) => Promise<void>;
}

export const commands: CommandEntry[] = MORSE_CONFIGS.map((config) => ({
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
  onCommand: async (ctx: AppCtx) => runMorse(ctx, config),
}));