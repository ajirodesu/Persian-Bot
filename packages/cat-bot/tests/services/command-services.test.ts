import { describe, expect, it } from 'vitest';
import {
  animalButtonId,
  createAnimalButton,
  type AnimalConfig,
} from '@/engine/services/commands/animal-photos.service.js';
import { MEME_BUTTON_ID } from '@/engine/services/commands/meme.service.js';
import { PERIODIC_TABLE_REROLL_BUTTON_ID } from '@/engine/services/commands/periodic-table.service.js';
import {
  createPromptButton,
  factPromptConfig,
  promptButtonId,
} from '@/engine/services/commands/popcat-random-text.service.js';
import {
  createRandomTextButton,
  randomTextButtonId,
  adviceConfig,
} from '@/engine/services/commands/random-text-facts.service.js';
import {
  SIMPLE_PHOTO_BUTTON_ID,
  WALLPAPER_DEFAULT_HEIGHT,
  WALLPAPER_DEFAULT_WIDTH,
  createWallpaperButtons,
  parseWallpaperArgs,
} from '@/engine/services/commands/random-photos.service.js';

const animalConfig: AnimalConfig = {
  name: 'cat',
  label: 'Random Cat Image',
  emoji: '🐱',
  buttonLabel: '🔁 Another Cat',
  apiUrl: 'https://example.test/cat',
  extractUrl: () => null,
};

describe('shared command service helpers', () => {
  it('uses the original button ids', () => {
    expect(MEME_BUTTON_ID).toBe('refresh');
    expect(PERIODIC_TABLE_REROLL_BUTTON_ID).toBe('periodic-table-reroll');
    expect(SIMPLE_PHOTO_BUTTON_ID).toBe('repeat');
    expect(animalButtonId(animalConfig)).toBe('cat-next');
    expect(promptButtonId(factPromptConfig)).toBe('fact-again');
    expect(randomTextButtonId(adviceConfig)).toBe('advice-next');
  });

  it('builds family buttons bound to their own config', () => {
    expect(Object.keys(createAnimalButton(animalConfig))).toEqual(['cat-next']);
    expect(Object.keys(createPromptButton(factPromptConfig))).toEqual([
      'fact-again',
    ]);
    expect(Object.keys(createRandomTextButton(adviceConfig))).toEqual([
      'advice-next',
    ]);
    expect(Object.keys(createWallpaperButtons())).toEqual([
      'random',
      'nature',
      'space',
      'city',
      'sunset',
      'anime',
    ]);
  });

  it('parses wallpaper topic and size arguments', () => {
    expect(parseWallpaperArgs([])).toEqual({
      query: '',
      width: WALLPAPER_DEFAULT_WIDTH,
      height: WALLPAPER_DEFAULT_HEIGHT,
    });
    expect(parseWallpaperArgs(['nature'])).toEqual({
      query: 'nature',
      width: 1920,
      height: 1080,
    });
    expect(parseWallpaperArgs(['neon', 'city', '800x600'])).toEqual({
      query: 'neon city',
      width: 800,
      height: 600,
    });
  });

  it('caps wallpaper dimensions and leaves invalid sizes in the query', () => {
    expect(parseWallpaperArgs(['5000x5000'])).toEqual({
      query: '',
      width: 3840,
      height: 2160,
    });
    expect(parseWallpaperArgs(['space', 'wide'])).toEqual({
      query: 'space wide',
      width: WALLPAPER_DEFAULT_WIDTH,
      height: WALLPAPER_DEFAULT_HEIGHT,
    });
  });
});
