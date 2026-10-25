import { describe, expect, it } from 'vitest';
import { parseBetAmount } from '@/engine/utils/bet.util.js';

describe('parseBetAmount', () => {
  it('accepts plain, comma-separated, and suffixed amounts', () => {
    expect(parseBetAmount('100', 1_000)).toBe(100);
    expect(parseBetAmount('1,000', 5_000)).toBe(1_000);
    expect(parseBetAmount('1.5k', 5_000)).toBe(1_500);
    expect(parseBetAmount('2m', 5_000_000)).toBe(2_000_000);
    expect(parseBetAmount('3b', 5_000_000_000)).toBe(3_000_000_000);
    expect(parseBetAmount(' 250 ', 1_000)).toBe(250);
  });

  it('resolves balance-relative shorthands', () => {
    expect(parseBetAmount('all', 1_234)).toBe(1_234);
    expect(parseBetAmount('max', 1_234)).toBe(1_234);
    expect(parseBetAmount('half', 1_235)).toBe(617);
  });

  it('floors fractional results', () => {
    expect(parseBetAmount('1.9', 1_000)).toBe(1);
    expect(parseBetAmount('0.5k', 1_000)).toBe(500);
  });

  it('returns NaN for invalid input so callers can show their own error', () => {
    expect(parseBetAmount('', 1_000)).toBeNaN();
    expect(parseBetAmount('abc', 1_000)).toBeNaN();
    expect(parseBetAmount('10x', 1_000)).toBeNaN();
    expect(parseBetAmount('-5', 1_000)).toBeNaN();
  });

  it('treats zero as a valid parsed amount', () => {
    expect(parseBetAmount('0', 1_000)).toBe(0);
  });
});
