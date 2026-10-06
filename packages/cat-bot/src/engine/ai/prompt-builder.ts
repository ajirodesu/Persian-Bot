/**
 * Budgeted prompt assembly — each section declares a priority; over budget,
 * the least important sections are dropped whole (never truncated mid-rule).
 *
 * Portions derived from Reze-Bot (MIT):
 *   https://github.com/GrandpaEJx/Reze-Bot
 * See THIRD_PARTY_NOTICES.md. Adapted to Persian-Bot conventions.
 */

export interface Section {
  id: string;
  /** Lower survives longer. 0 = never drop. */
  priority: number;
  text: string;
}

export interface AssembleOptions {
  /** Character budget for the whole prompt (~4 chars per token). */
  maxChars?: number;
  separator?: string;
}

export interface Assembled {
  text: string;
  chars: number;
  /** Rough heuristic, not a tokenizer — good enough to catch runaway growth. */
  estimatedTokens: number;
  kept: string[];
  dropped: string[];
  /** True when priority-0 sections alone exceed the budget. */
  overBudget: boolean;
}

export const DEFAULT_MAX_CHARS = 12_000;

export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

export function section(
  id: string,
  priority: number,
  text: string | null | undefined,
): Section | null {
  const clean = (text ?? '').trim();
  return clean ? { id, priority, text: clean } : null;
}

export function assemble(
  sections: (Section | null | undefined)[],
  opts: AssembleOptions = {},
): Assembled {
  const maxChars = opts.maxChars ?? DEFAULT_MAX_CHARS;
  const separator = opts.separator ?? '\n\n';

  const present = sections.filter((s): s is Section => Boolean(s?.text));

  // Drop from the least important end until it fits; keep declaration order
  // for survivors so the model reads a stable document.
  const byImportance = [...present].sort((a, b) => a.priority - b.priority);
  const keep = new Set<string>();
  let used = 0;

  for (const s of byImportance) {
    const cost = s.text.length + separator.length;
    if (s.priority === 0 || used + cost <= maxChars) {
      keep.add(s.id);
      used += cost;
    }
  }

  const kept = present.filter((s) => keep.has(s.id));
  const dropped = present.filter((s) => !keep.has(s.id)).map((s) => s.id);
  const text = kept.map((s) => s.text).join(separator);

  return {
    text,
    chars: text.length,
    estimatedTokens: estimateTokens(text),
    kept: kept.map((s) => s.id),
    dropped,
    overBudget: text.length > maxChars,
  };
}
