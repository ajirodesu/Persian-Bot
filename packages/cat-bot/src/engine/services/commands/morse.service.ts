/**
 * Morse Code Service — shared implementation for /morseencode and
 * /morsedecode.
 *
 * No external API: the Morse table and both conversion directions live here.
 *
 * Spacing convention (applies to both directions):
 *   - Within a word, each letter's Morse code is separated by a single space.
 *   - Between words, a " / " separator is used.
 */

import { MessageStyle } from '@/engine/constants/message-style.constants.js';
import type { AppCtx } from '@/engine/types/controller.types.js';

const MORSE_MAP: Record<string, string> = {
  A: '.-',
  B: '-...',
  C: '-.-.',
  D: '-..',
  E: '.',
  F: '..-.',
  G: '--.',
  H: '....',
  I: '..',
  J: '.---',
  K: '-.-',
  L: '.-..',
  M: '--',
  N: '-.',
  O: '---',
  P: '.--.',
  Q: '--.-',
  R: '.-.',
  S: '...',
  T: '-',
  U: '..-',
  V: '...-',
  W: '.--',
  X: '-..-',
  Y: '-.--',
  Z: '--..',
  '0': '-----',
  '1': '.----',
  '2': '..---',
  '3': '...--',
  '4': '....-',
  '5': '.....',
  '6': '-....',
  '7': '--...',
  '8': '---..',
  '9': '----.',
  '.': '.-.-.-',
  ',': '--..--',
  '?': '..--..',
  "'": '.----.',
  '!': '-.-.--',
  '/': '-..-.',
  '(': '-.--.',
  ')': '-.--.-',
  '&': '.-...',
  ':': '---...',
  ';': '-.-.-.',
  '=': '-...-',
  '+': '.-.-.',
  '-': '-....-',
  _: '..--.-',
  '"': '.-..-.',
  $: '...-..-',
  '@': '.--.-.',
};

const TEXT_MAP: Record<string, string> = Object.fromEntries(
  Object.entries(MORSE_MAP).map(([letter, code]) => [code, letter]),
);

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

export interface MorseConfig {
  name: string;
  paramName: string;
  label: string;
  emoji: string;
  convert: (input: string) => string;
}

/** Runs the shared Morse conversion flow for a family config. */
export async function runMorse(
  ctx: AppCtx,
  config: MorseConfig,
): Promise<void> {
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

export const morseEncodeConfig: MorseConfig = {
  name: 'morseencode',
  paramName: 'text',
  label: 'Morse Encode',
  emoji: '📡',
  convert: encodeMorse,
};

export const morseDecodeConfig: MorseConfig = {
  name: 'morsedecode',
  paramName: 'morse',
  label: 'Morse Decode',
  emoji: '📶',
  convert: decodeMorse,
};
