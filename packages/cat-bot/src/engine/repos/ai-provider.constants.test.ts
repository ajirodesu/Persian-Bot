import { describe, expect, it } from 'vitest';
import {
  getFreeModelOf,
  isFreeOrAutoModel,
} from './ai-provider.constants.js';

describe('getFreeModelOf', () => {
  it('returns a free/auto model for providers with a free tier', () => {
    expect(getFreeModelOf('openrouter')).toBe('openai/gpt-4o:free');
    expect(getFreeModelOf('groq')).toBe('llama-3.1-8b-instant');
    expect(getFreeModelOf('gemini')).toBe('gemini-2.0-flash-001');
    expect(getFreeModelOf('zen')).toBe('deepseek-v4-flash-free');
    expect(getFreeModelOf('orcarouter')).toBe('orcarouter/auto');
  });

  it('returns undefined for providers without a free/auto tier', () => {
    expect(getFreeModelOf('openai')).toBeUndefined();
    expect(getFreeModelOf('nvidia')).toBeUndefined();
    expect(getFreeModelOf('fastrouter')).toBeUndefined();
  });
});

describe('isFreeOrAutoModel', () => {
  it('matches the provider free/auto model id itself', () => {
    expect(isFreeOrAutoModel('orcarouter', 'orcarouter/auto')).toBe(true);
    expect(isFreeOrAutoModel('zen', 'deepseek-v4-flash-free')).toBe(true);
  });

  it('matches `:free` and `-free` variant ids', () => {
    expect(isFreeOrAutoModel('openrouter', 'openai/gpt-4o:free')).toBe(true);
    expect(isFreeOrAutoModel('zen', 'big-pickle')).toBe(true);
    expect(isFreeOrAutoModel('openrouter', 'openai/gpt-4o')).toBe(false);
  });
});