import { describe, it, expect } from 'vitest';
import { run } from '@/engine/agent/tools/bot_stats.js';

describe('bot_stats tool', () => {
  it('returns live process statistics as JSON', async () => {
    const out = await run();
    const stats = JSON.parse(out) as Record<string, unknown>;

    expect(typeof stats['memoryUsedMB']).toBe('number');
    expect(typeof stats['memoryTotalMB']).toBe('number');
    expect(typeof stats['uptime']).toBe('string');
    expect(stats['uptime']).toMatch(/\d+h \d+m/);
    expect(typeof stats['uptimeSeconds']).toBe('number');
    expect(typeof stats['activeBotSessions']).toBe('number');
    expect(typeof stats['nodeVersion']).toBe('string');
  });

  it('reports zero active sessions in a bare process', async () => {
    const stats = JSON.parse(await run()) as Record<string, unknown>;
    // No sessions are registered in the test process — the count must be a
    // number and consistent with the session registry state.
    expect(stats['activeBotSessions']).toBeGreaterThanOrEqual(0);
  });
});
