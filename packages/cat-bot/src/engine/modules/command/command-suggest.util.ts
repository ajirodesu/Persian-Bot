/**
 * Command Suggestion Utility — "Did You Mean?" Bigram Matcher (Dice's Coefficient)
 *
 * Provides a suggestion when a user types an unrecognised command.
 * Algorithm: Dice's Coefficient (bigram overlap) — scores similarity from 0.0 to 1.0.
 *
 * Why Dice's Coefficient?
 *   - Handles transpositions better than prefix-overlap (e.g. "hle" -> "help").
 *   - Evaluates the whole string rather than bailing out on the first mismatch.
 *   - We evaluate all commands, sort by score highest-to-lowest, and return the
 *     top match, provided it meets a minimum threshold to avoid nonsensical suggestions.
 *
 * Dependency direction: utils/command-suggest.util.ts → types/controller.types.ts
 * Zero runtime state — pure functions, safe to import from any layer.
 */

import type { CommandMap } from '@/engine/types/controller.types.js';

/**
 * Returns the canonical command name (meta.name) most similar to `unknown`,
 * or null when no candidate shares even a single leading character.
 *
 * Aliases are deduplicated — only the canonical meta.name is considered so the
 * suggestion text matches the name the user would actually see in /help output.
 *
 * @param unknown  - The lowercased unrecognised command name (prefix already stripped)
 * @param commands - The live CommandMap loaded by app.ts
 */
export function findSimilarCommand(
  unknown: string,
  commands: CommandMap,
  skipNames?: Set<string>,
): string | null {
  const seen = new Set<string>();
  const ratings: { target: string; rating: number }[] = [];

  for (const mod of commands.values()) {
    const cfg = mod['meta'] as { name?: string } | undefined;
    const canonical = cfg?.name?.toLowerCase();
    if (!canonical || seen.has(canonical)) continue;
    // Disabled commands are non-existent from the user's perspective — never surface them as suggestions
    if (skipNames?.has(canonical)) continue;
    seen.add(canonical);

    const score = compareTwoStrings(unknown, canonical);
    ratings.push({ target: canonical, rating: score });
  }

  // Sort highest to lowest to find the best match
  ratings.sort((a, b) => b.rating - a.rating);

  // A minimum threshold prevents completely unrelated strings from being suggested
  // e.g. "x" should not suggest "help". 0.3 is a standard baseline for bigram matching.
  const MIN_THRESHOLD = 0.3;

  if (ratings.length > 0 && ratings[0]!.rating >= MIN_THRESHOLD) {
    return ratings[0]!.target;
  }

  return null;
}

/**
 * Compares two strings using Dice's Coefficient (bigram overlap).
 * Returns a similarity score between 0.0 (no match) and 1.0 (identical).
 */
function compareTwoStrings(first: string, second: string): number {
  const f = first.replace(/\s+/g, '');
  const s = second.replace(/\s+/g, '');

  if (f === s) return 1;
  if (f.length < 2 || s.length < 2) return 0;

  const firstBigrams = new Map<string, number>();
  for (let i = 0; i < f.length - 1; i++) {
    const bigram = f.substring(i, i + 2);
    firstBigrams.set(bigram, (firstBigrams.get(bigram) ?? 0) + 1);
  }

  let intersectionSize = 0;
  for (let i = 0; i < s.length - 1; i++) {
    const bigram = s.substring(i, i + 2);
    const count = firstBigrams.get(bigram) ?? 0;

    if (count > 0) {
      firstBigrams.set(bigram, count - 1);
      intersectionSize++;
    }
  }

  return (2.0 * intersectionSize) / (f.length + s.length - 2);
}
