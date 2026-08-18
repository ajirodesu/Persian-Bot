import { describe, expect, it } from 'vitest';
import {
  classifyTreeChange,
  isProtectedPath,
  type TreeMap,
} from './fork-update.lib.js';

/** Builds a TreeMap from a plain path → SHA object. */
function tree(entries: Record<string, string>): TreeMap {
  return new Map(
    Object.entries(entries).map(([path, sha]) => [path, { sha }]),
  );
}

function plan(entries: {
  base?: Record<string, string>;
  fork?: Record<string, string>;
  up?: Record<string, string>;
}) {
  return classifyTreeChange(
    tree(entries.base ?? {}),
    tree(entries.fork ?? {}),
    tree(entries.up ?? {}),
  );
}

function pathsOf(items: Array<{ path: string }>): string[] {
  return items.map((i) => i.path);
}

describe('isProtectedPath', () => {
  it('protects .env and .env.* but not .env.example', () => {
    expect(isProtectedPath('.env')).toBe(true);
    expect(isProtectedPath('packages/cat-bot/.env')).toBe(true);
    expect(isProtectedPath('packages/cat-bot/.env.production')).toBe(true);
    expect(isProtectedPath('.env.example')).toBe(false);
    expect(isProtectedPath('packages/cat-bot/.env.example')).toBe(false);
  });

  it('protects private-key style files', () => {
    expect(isProtectedPath('config/id_rsa.pem')).toBe(true);
    expect(isProtectedPath('secrets/server.key')).toBe(true);
    expect(isProtectedPath('src/app/commands/ping.ts')).toBe(false);
  });
});

describe('classifyTreeChange', () => {
  it('updates a file changed only upstream, carrying the upstream blob SHA', () => {
    const result = plan({
      base: { 'src/a.ts': 'base1' },
      fork: { 'src/a.ts': 'base1' },
      up: { 'src/a.ts': 'up1' },
    });
    expect(pathsOf(result.changes)).toEqual(['src/a.ts']);
    expect(result.changes[0]?.action).toBe('update');
    expect(result.changes[0]?.sha).toBe('up1');
    expect(result.preserved).toHaveLength(0);
    expect(result.conflicts).toHaveLength(0);
  });

  it('adds a brand-new upstream file', () => {
    const result = plan({
      base: {},
      fork: {},
      up: { 'src/new.ts': 'up1' },
    });
    expect(result.changes[0]?.action).toBe('add');
    expect(result.changes[0]?.sha).toBe('up1');
  });

  it('preserves a user-created file', () => {
    const result = plan({
      base: {},
      fork: { 'src/user.ts': 'fork1' },
      up: {},
    });
    expect(pathsOf(result.changes)).toEqual([]);
    expect(pathsOf(result.preserved)).toEqual(['src/user.ts']);
  });

  it('preserves a user-modified file when upstream is unchanged', () => {
    const result = plan({
      base: { 'src/a.ts': 'base1' },
      fork: { 'src/a.ts': 'fork1' },
      up: { 'src/a.ts': 'base1' },
    });
    expect(pathsOf(result.changes)).toEqual([]);
    expect(pathsOf(result.preserved)).toEqual(['src/a.ts']);
  });

  it('flags a conflict when both sides modified the same file and keeps the user version', () => {
    const result = plan({
      base: { 'src/a.ts': 'base1' },
      fork: { 'src/a.ts': 'fork1' },
      up: { 'src/a.ts': 'up1' },
    });
    expect(pathsOf(result.changes)).toEqual([]);
    expect(pathsOf(result.conflicts)).toEqual(['src/a.ts']);
    expect(result.preserved).toHaveLength(0);
  });

  it('deletes a file upstream removed when the fork copy is unchanged', () => {
    const result = plan({
      base: { 'src/a.ts': 'base1' },
      fork: { 'src/a.ts': 'base1' },
      up: {},
    });
    expect(result.changes[0]?.action).toBe('delete');
    expect(pathsOf(result.preserved)).toEqual([]);
  });

  it('preserves a user deletion when upstream is unchanged', () => {
    const result = plan({
      base: { 'src/a.ts': 'base1' },
      fork: {},
      up: { 'src/a.ts': 'base1' },
    });
    expect(pathsOf(result.changes)).toEqual([]);
    expect(pathsOf(result.preserved)).toEqual(['src/a.ts']);
  });

  it('flags a conflict when upstream modified a file the user deleted', () => {
    const result = plan({
      base: { 'src/a.ts': 'base1' },
      fork: {},
      up: { 'src/a.ts': 'up1' },
    });
    expect(pathsOf(result.conflicts)).toEqual(['src/a.ts']);
  });

  it('flags a conflict when both sides added the same path differently', () => {
    const result = plan({
      base: {},
      fork: { 'src/new.ts': 'fork1' },
      up: { 'src/new.ts': 'up1' },
    });
    expect(pathsOf(result.conflicts)).toEqual(['src/new.ts']);
  });

  it('ignores identical files', () => {
    const result = plan({
      base: { 'src/a.ts': 'same' },
      fork: { 'src/a.ts': 'same' },
      up: { 'src/a.ts': 'same' },
    });
    expect(result.changes).toHaveLength(0);
    expect(result.preserved).toHaveLength(0);
    expect(result.conflicts).toHaveLength(0);
  });

  it('never overwrites a protected config file even when upstream changed it', () => {
    const result = plan({
      base: { '.env': 'base1' },
      fork: { '.env': 'base1' },
      up: { '.env': 'up1' },
    });
    expect(pathsOf(result.changes)).toEqual([]);
    expect(pathsOf(result.preserved)).toEqual(['.env']);
  });

  it('add/update items carry an upstream blob SHA; preserve/conflict items do not', () => {
    const result = plan({
      base: {
        'src/a.ts': 'base1',
        'src/b.ts': 'base1',
      },
      fork: {
        'src/a.ts': 'fork1',
        'src/b.ts': 'base1',
        'src/user.ts': 'fork1',
      },
      up: {
        'src/a.ts': 'up1',
        'src/b.ts': 'up1',
      },
    });
    const conflict = result.conflicts.find((i) => i.path === 'src/a.ts');
    const update = result.changes.find((i) => i.path === 'src/b.ts');
    const preserved = result.preserved.find((i) => i.path === 'src/user.ts');
    expect(conflict?.sha).toBeUndefined();
    expect(update?.sha).toBe('up1');
    expect(preserved?.sha).toBeUndefined();
  });
});
