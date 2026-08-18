/**
 * AI Agent — Auto Commit-Message Generation
 *
 * Pure, dependency-free conventional-commit message generator used by the
 * admin_commit_push tool when no explicit message is given. Deterministic:
 * the same working-tree state always produces the same message, so the result
 * is reviewable and reproducible rather than model-dependent.
 *
 *   * type   — `feat` when files were added, `fix` when only existing files
 *              changed, `chore` when only deletions remain
 *   * scope  — the changed files' common directory (≤ 2 segments, e.g.
 *              `packages/cat-bot`), omitted when paths share none
 *   * subject — names the first few changed files
 *   * body   — lists every changed path with its status
 */

import { basename } from 'node:path';
import type { GitChange } from '@/server/lib/local-git.lib.js';

const SUBJECT_FILE_BUDGET = 3;
const BODY_FILE_BUDGET = 12;

/**
 * Common directory prefix shared by every changed path (≤ 2 segments, e.g.
 * `packages/cat-bot`), or null when the paths share none. Used as the
 * conventional-commit scope.
 */
function commonScope(paths: string[]): string | null {
  if (paths.length === 0) return null;
  const split = paths.map((p) => {
    const parts = p.split('/').filter(Boolean);
    return parts.slice(0, -1); // directory components only — never the filename
  });
  const minLen = Math.min(...split.map((s) => s.length));
  let depth = 0;
  outer: for (let i = 0; i < minLen; i += 1) {
    const seg = split[0]?.[i];
    for (const s of split) {
      if (s[i] !== seg) break outer;
    }
    depth += 1;
  }
  if (depth === 0) return null;
  return split[0]!.slice(0, Math.min(depth, 2)).join('/');
}

/** Builds a conventional-commit message summarising the given changes. */
export function generateCommitMessage(changes: GitChange[]): string {
  const sorted = [...changes].sort((a, b) => a.path.localeCompare(b.path));
  if (sorted.length === 0) {
    return 'chore: update repository files';
  }
  const added = sorted.filter(
    (c) => c.status === 'added' || c.status === 'untracked',
  );
  const modified = sorted.filter(
    (c) => c.status === 'modified' || c.status === 'renamed',
  );
  const deleted = sorted.filter((c) => c.status === 'deleted');

  const type = added.length > 0 ? 'feat' : modified.length > 0 ? 'fix' : 'chore';
  const headline = added.length > 0 ? added : modified.length > 0 ? modified : deleted;
  let verb = 'update';
  if (added.length > 0) verb = 'add';
  else if (modified.length === 0 && deleted.length > 0) verb = 'remove';

  const scope = commonScope(sorted.map((c) => c.path));
  const names = headline
    .slice(0, SUBJECT_FILE_BUDGET)
    .map((c) => basename(c.path));
  const overflow =
    headline.length > SUBJECT_FILE_BUDGET
      ? ` (+${headline.length - SUBJECT_FILE_BUDGET} more)`
      : '';
  const subject =
    (scope ? `${type}(${scope})` : type) +
    `: ${verb} ${names.join(', ')}${overflow}`;

  const body = sorted
    .slice(0, BODY_FILE_BUDGET)
    .map((c) => `- ${c.status} ${c.path}`)
    .join('\n');

  return `${subject}\n\n${body}`;
}
