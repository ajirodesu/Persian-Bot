import { describe, expect, it } from 'vitest';
import {
  DELTA_NEXT,
  expToLevel,
  levelToExp,
} from '@/engine/utils/levels.util.js';

describe('level progression maths', () => {
  it('keeps the shared curve constant stable', () => {
    expect(DELTA_NEXT).toBe(5);
  });

  it('clamps non-positive values to zero', () => {
    expect(expToLevel(0)).toBe(0);
    expect(expToLevel(-100)).toBe(0);
    expect(levelToExp(0)).toBe(0);
    expect(levelToExp(-3)).toBe(0);
  });

  it('maps the documented level boundaries', () => {
    expect(levelToExp(1)).toBe(0);
    expect(levelToExp(2)).toBe(5);
    expect(levelToExp(3)).toBe(15);
    expect(levelToExp(10)).toBe(225);
    expect(expToLevel(4)).toBe(1);
    expect(expToLevel(5)).toBe(2);
    expect(expToLevel(15)).toBe(3);
  });

  it('round-trips level thresholds for level 2 and above', () => {
    for (let level = 2; level <= 50; level++) {
      expect(expToLevel(levelToExp(level))).toBe(level);
    }
  });

  it('is monotonic in both directions', () => {
    for (let exp = 0; exp < 1_000; exp += 37) {
      expect(expToLevel(exp + 1)).toBeGreaterThanOrEqual(expToLevel(exp));
    }
    for (let level = 0; level < 50; level++) {
      expect(levelToExp(level + 1)).toBeGreaterThanOrEqual(levelToExp(level));
    }
  });
});
