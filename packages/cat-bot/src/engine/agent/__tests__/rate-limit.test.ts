import { describe, expect, it } from 'vitest';
import { aiRateLimiter } from '../lib/rate-limit.lib.js';

describe('rate-limit', () => {
  it('allows traffic under the cadence limits', () => {
    const suffix = `${Date.now()}-a`;
    expect(
      aiRateLimiter.checkCadence(`user-${suffix}`, `sess-${suffix}`),
    ).toBeNull();
  });

  it('blocks users over the per-minute limit', () => {
    const suffix = `${Date.now()}-b`;
    const user = `flood-user-${suffix}`;
    const sess = `flood-sess-${suffix}`;
    let blocked: string | null = null;
    for (let i = 0; i < aiRateLimiter.maxPerUserPerMin + 2; i++) {
      blocked = aiRateLimiter.checkCadence(user, sess);
    }
    expect(blocked).toContain('rate limit');
  });

  it('caps concurrent runs per session and releases slots', () => {
    const suffix = `${Date.now()}-c`;
    const sess = `conc-sess-${suffix}`;
    const acquired: boolean[] = [];
    for (let i = 0; i < aiRateLimiter.maxConcurrentPerSession + 1; i++) {
      acquired.push(aiRateLimiter.tryAcquire(sess));
    }
    expect(acquired.slice(0, aiRateLimiter.maxConcurrentPerSession)).toEqual(
      Array(aiRateLimiter.maxConcurrentPerSession).fill(true),
    );
    expect(acquired[aiRateLimiter.maxConcurrentPerSession]).toBe(false);
    aiRateLimiter.release(sess);
    expect(aiRateLimiter.tryAcquire(sess)).toBe(true);
    aiRateLimiter.release(sess);
    // Release remaining slots acquired above.
    for (let i = 0; i < aiRateLimiter.maxConcurrentPerSession; i++) {
      aiRateLimiter.release(sess);
    }
  });
});
