import { describe, it, expect, vi } from 'vitest';

vi.mock('@/engine/config/env.config.js', () => ({
  env: { AGENT_SANDBOX: undefined },
}));

vi.mock('@/engine/repos/credentials.repo.js', () => ({
  isBotAdmin: vi.fn().mockResolvedValue(false),
}));

vi.mock('@/engine/repos/system-admin.repo.js', () => ({
  isSystemAdmin: vi.fn().mockResolvedValue(false),
}));

import { run, collectOutput, stripAnsi } from '@/engine/agent/tools/shell.js';
import { isSystemAdmin } from '@/engine/repos/system-admin.repo.js';
import type { AppCtx } from '@/engine/types/controller.types.js';

function makeCtx(): AppCtx {
  return {
    event: { senderID: 'u1', threadID: 't1', messageID: 'm1' },
    native: { userId: 'owner', sessionId: 's1', platform: 'telegram' },
    commands: new Map(),
    prefix: '+',
  } as unknown as AppCtx;
}

describe('shell tool: output helpers', () => {
  it('collects stdout and labels stderr', () => {
    expect(collectOutput('hello\n', 'warn line\n')).toBe(
      'hello\nSTDERR: warn line',
    );
  });

  it('returns (no output) when both streams are empty', () => {
    expect(collectOutput('', '')).toBe('(no output)');
  });

  it('strips ANSI color escapes', () => {
    expect(stripAnsi('\u001B[31mred\u001B[0m')).toBe('red');
  });

  it('caps combined output at 2000 chars', () => {
    const long = 'x'.repeat(5_000);
    const out = collectOutput(long, '');
    expect(out.length).toBeLessThanOrEqual(2_000);
  });
});

describe('shell tool: authorization', () => {
  it('denies non-admin users with an explicit message', async () => {
    const out = await run({ command: 'echo hi' }, makeCtx());
    expect(out).toContain('Access denied');
  });

  it('denies when no sender id is present', async () => {
    const ctx = makeCtx();
    ctx.event = { threadID: 't1' };
    const out = await run({ command: 'echo hi' }, ctx);
    expect(out).toContain('Access denied');
  });

  it('grants system admins access', async () => {
    vi.mocked(isSystemAdmin).mockResolvedValueOnce(true);
    const out = await run({}, makeCtx());
    expect(out).toBe('No command provided.');
  });
});

describe('shell tool: execution', () => {
  it('executes a real command and returns its output', async () => {
    vi.mocked(isSystemAdmin).mockResolvedValueOnce(true);
    const out = await run({ command: 'echo shell-tool-ok' }, makeCtx());
    expect(out).toContain('shell-tool-ok');
  });

  it('surfaces command failure output without throwing', async () => {
    vi.mocked(isSystemAdmin).mockResolvedValueOnce(true);
    const out = await run(
      { command: 'node -e "process.exit(3)"' },
      makeCtx(),
    );
    // The tool returns a descriptive error string instead of throwing.
    expect(out).toContain('Command failed');
  });
});
