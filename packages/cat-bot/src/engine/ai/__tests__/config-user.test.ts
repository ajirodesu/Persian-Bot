import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  resolveAgentConfig,
  buildCandidates,
  describeRouting,
  setSnapshotForTests,
  clearSnapshotsForTests,
  resetProviderCache,
} from '../config.js';

beforeEach(() => {
  vi.stubEnv('GROQ_API_KEY', 'env-key');
  vi.stubEnv('GROQ_MODELS', 'env-model');
  clearSnapshotsForTests();
  resetProviderCache();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  clearSnapshotsForTests();
  resetProviderCache();
});

describe('per-user snapshots', () => {
  it('prefers the user DB snapshot over env vars', () => {
    setSnapshotForTests('u1', {
      providers: { groq: { apiKey: 'db-key', models: ['db-model'] } },
    });
    const userCfg = resolveAgentConfig('default', {}, 'u1');
    expect(buildCandidates(userCfg, 'u1').map((c) => c.model)).toEqual(['db-model']);

    const globalCfg = resolveAgentConfig('default');
    expect(buildCandidates(globalCfg).map((c) => c.model)).toEqual(['env-model']);
  });

  it('falls back to env when the user has no snapshot', () => {
    const cfg = resolveAgentConfig('default', {}, 'unknown-user');
    expect(buildCandidates(cfg, 'unknown-user').map((c) => c.model)).toEqual(['env-model']);
  });

  it('resolves per-agent overrides on top of the user snapshot', () => {
    setSnapshotForTests('u1', {
      providers: { groq: { apiKey: 'db-key', models: ['db-model'] } },
      agents: { editor: { temperature: 0.9 } },
    });
    const cfg = resolveAgentConfig('editor', {}, 'u1');
    expect(cfg.temperature).toBe(0.9);
    expect(describeRouting('u1').editor?.candidates).toEqual(['groq/db-model']);
  });
});
