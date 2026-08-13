import { describe, it, expect, vi } from 'vitest';

vi.mock('@/engine/modules/session/bot-session-commands.repo.js', () => ({
  findSessionCommands: vi.fn().mockResolvedValue([]),
}));

vi.mock('@/engine/repos/credentials.repo.js', () => ({
  isBotAdmin: vi.fn().mockResolvedValue(false),
  isBotPremium: vi.fn().mockResolvedValue(false),
}));

vi.mock('@/engine/repos/threads.repo.js', () => ({
  isThreadAdmin: vi.fn().mockResolvedValue(false),
}));

import { run } from '@/engine/agent/tools/help.js';
import type { AppCtx, CommandMap } from '@/engine/types/controller.types.js';

function makeCmd(meta: Record<string, unknown>): Record<string, unknown> {
  return { meta };
}

function makeCtx(): AppCtx {
  const commands = new Map<string, Record<string, unknown>>([
    [
      'ping',
      makeCmd({
        name: 'ping',
        description: 'Ping the bot',
        usage: '[text]',
        role: 0,
      }),
    ],
    [
      'multi',
      makeCmd({
        name: 'multi',
        description: 'Command with multiple usage patterns',
        usage: ['one', 'two'],
        role: 0,
      }),
    ],
  ]) as CommandMap;

  return {
    event: { senderID: 'u1', threadID: 't1', messageID: 'm1' },
    native: { userId: 'owner', sessionId: 's1', platform: 'telegram' },
    commands,
    prefix: '+',
  } as unknown as AppCtx;
}

describe('agent help tool: meta.usage support', () => {
  it('renders a single-string usage in the detail view', async () => {
    const out = await run({ query: 'ping' }, makeCtx());
    expect(out).toContain('Usage    : +ping [text]');
  });

  it('renders string[] usage as one line per pattern in the detail view', async () => {
    const out = await run({ query: 'multi' }, makeCtx());
    expect(out).toContain('Usage    : +multi one');
    // Continuation lines align with the first usage line.
    expect(out).toContain('           +multi two');
  });

  it('renders usage inline next to name and description in the list view', async () => {
    const out = await run({ query: '' }, makeCtx());
    expect(out).toContain('`+ping` — Ping the bot | `+ping [text]`');
    expect(out).toContain('`+multi` — Command with multiple usage patterns | `+multi one`');
  });

  it('keeps the usage line absent when meta.usage is not declared', async () => {
    const ctx = makeCtx();
    ctx.commands.set('bare', makeCmd({ name: 'bare', description: 'No usage', role: 0 }));
    const out = await run({ query: 'bare' }, ctx);
    expect(out).toContain('Usage    : +bare');
  });
});
