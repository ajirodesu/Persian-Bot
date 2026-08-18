import { describe, expect, it } from 'vitest';
import { generateCommitMessage } from './commit-message.lib.js';
import type { GitChange } from '@/server/lib/local-git.lib.js';

function change(path: string, status: GitChange['status']): GitChange {
  return { path, status, staged: false, hasUnstagedMods: false };
}

describe('generateCommitMessage', () => {
  it('uses feat/add + scope for new files in a shared directory', () => {
    const msg = generateCommitMessage([
      change('packages/cat-bot/src/app/commands/ping.ts', 'untracked'),
      change('packages/cat-bot/src/app/commands/weather.ts', 'added'),
    ]);
    expect(msg.startsWith('feat(packages/cat-bot): add ping.ts, weather.ts')).toBe(true);
    expect(msg).toContain('- untracked packages/cat-bot/src/app/commands/ping.ts');
    expect(msg).toContain('- added packages/cat-bot/src/app/commands/weather.ts');
  });

  it('uses fix/update for modified-only changes', () => {
    const msg = generateCommitMessage([
      change('src/index.ts', 'modified'),
    ]);
    expect(msg.startsWith('fix(src): update index.ts')).toBe(true);
  });

  it('uses chore/remove for deletions only', () => {
    const msg = generateCommitMessage([
      change('legacy/deprecated.ts', 'deleted'),
    ]);
    expect(msg.startsWith('chore(legacy): remove deprecated.ts')).toBe(true);
  });

  it('omits scope when paths share no common directory', () => {
    const msg = generateCommitMessage([
      change('README.md', 'modified'),
      change('src/app.ts', 'modified'),
    ]);
    expect(msg.startsWith('fix: update README.md, app.ts')).toBe(true);
    expect(msg).not.toContain('(');
  });

  it('truncates the subject list but keeps the body', () => {
    const changes: GitChange[] = Array.from({ length: 8 }, (_, i) =>
      change(`src/module-${i}.ts`, 'added'),
    );
    const msg = generateCommitMessage(changes);
    expect(msg.startsWith('feat(src): add module-0.ts, module-1.ts, module-2.ts (+5 more)')).toBe(true);
    expect(msg).toContain('- added src/module-7.ts');
  });

  it('falls back for an empty change set', () => {
    expect(generateCommitMessage([])).toBe('chore: update repository files');
  });

  it('sorts paths deterministically', () => {
    const msg = generateCommitMessage([
      change('z.ts', 'added'),
      change('a.ts', 'added'),
    ]);
    expect(msg.startsWith('feat: add a.ts, z.ts')).toBe(true);
  });
});
