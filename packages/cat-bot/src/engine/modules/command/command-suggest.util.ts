/**
 * Command Suggestion Utility — "Did You Mean?" Bigram Matcher (Dice's Coefficient)
 *
 * Runs only on the unknown/disabled-command path, but that path used to rebuild
 * bigram maps for every registered command on every typo and then sort all
 * ratings. The command map is immutable after startup, so the canonical name
 * list and each name's bigram profile are now computed once per CommandMap and
 * reused. Scoring is a single pass with a running maximum instead of
 * allocate-all-then-sort.
 *
 * Behaviour is unchanged: aliases are not suggested, disabled names are
 * skipped, 0.3 remains the minimum score, and the first name wins ties (same
 * as the previous stable descending sort).
 *
 * Dependency direction: modules/command → types/controller.types.ts
 * Zero observable state — the WeakMap cache is keyed by the live CommandMap.
 */

import type { CommandMap, CommandModule } from '@/engine/types/controller.types.js';

const MIN_THRESHOLD = 0.3;

interface NameProfile {
  name: string;
  length: number;
  bigrams: Map<string, number>;
}

interface SuggestionIndex {
  profiles: NameProfile[];
}

// A CommandMap is built once at boot and never re-keyed, so a WeakMap keeps
// the index alive exactly as long as the map and lets it be collected with it.
const indexCache = new WeakMap<CommandMap, SuggestionIndex>();

function bigramProfile(value: string): Map<string, number> {
  const counts = new Map<string, number>();
  for (let i = 0; i < value.length - 1; i += 1) {
    const bigram = value.substring(i, i + 2);
    counts.set(bigram, (counts.get(bigram) ?? 0) + 1);
  }
  return counts;
}

function buildIndex(commands: CommandMap): SuggestionIndex {
  const seen = new Set<string>();
  const profiles: NameProfile[] = [];

  for (const mod of commands.values()) {
    const cfg = (mod as CommandModule)['meta'] as
      | { name?: string }
      | undefined;
    const name = cfg?.name?.toLowerCase();
    if (!name || seen.has(name)) continue;
    seen.add(name);
    profiles.push({
      name,
      length: name.length,
      bigrams: bigramProfile(name),
    });
  }

  return { profiles };
}

function indexFor(commands: CommandMap): SuggestionIndex {
  const cached = indexCache.get(commands);
  if (cached) return cached;
  const built = buildIndex(commands);
  indexCache.set(commands, built);
  return built;
}

/**
 * Returns the canonical command name most similar to `unknown`, or null when
 * no candidate meets the 0.3 threshold.
 */
export function findSimilarCommand(
  unknown: string,
  commands: CommandMap,
  skipNames?: Set<string>,
): string | null {
  if (!unknown || commands.size === 0) return null;

  const index = indexFor(commands);
  if (index.profiles.length === 0) return null;

  // Whitespace is meaningless in a command token; normalise once, not per name.
  const query = unknown.replace(/\s+/g, '');
  if (query.length < 2) return null;
  const queryLength = query.length;
  const queryBigrams = bigramProfile(query);

  let bestName: string | null = null;
  let bestScore = 0;

  for (const profile of index.profiles) {
    if (skipNames?.has(profile.name)) continue;

    if (profile.name === query) return profile.name;

    // Dice's coefficient: 2 × |intersection| / (|A| + |B|).
    let intersection = 0;
    for (const [bigram, count] of profile.bigrams) {
      const queryCount = queryBigrams.get(bigram);
      if (queryCount === undefined) continue;
      intersection += Math.min(count, queryCount);
    }
    const score = (2 * intersection) / (queryLength + profile.length - 2);

    // Strict `>` keeps the first registration on ties, matching the previous
    // stable descending sort.
    if (score > bestScore) {
      bestScore = score;
      bestName = profile.name;
    }
  }

  return bestScore >= MIN_THRESHOLD ? bestName : null;
}
