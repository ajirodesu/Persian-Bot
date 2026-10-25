/**
 * Level Progression Maths — shared by /rank, /rankup, and /profile.
 *
 * DELTA_NEXT controls how quickly users level up (higher = slower).
 * Both formulas are kept together so profile cards, rank cards, and level-up
 * notifications can never drift apart.
 */

/** Controls how quickly users level up — higher = slower progression. */
export const DELTA_NEXT = 5;

/** Converts raw EXP to a level number. */
export function expToLevel(exp: number): number {
  if (exp <= 0) return 0;
  return Math.floor((1 + Math.sqrt(1 + (8 * exp) / DELTA_NEXT)) / 2);
}

/** Minimum EXP required to reach a specific level. */
export function levelToExp(level: number): number {
  if (level <= 0) return 0;
  return Math.floor(((level * level - level) * DELTA_NEXT) / 2);
}
