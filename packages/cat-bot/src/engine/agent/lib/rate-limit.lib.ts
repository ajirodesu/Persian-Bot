/**
 * AI Rate Limiter — bounds AI execution so one actor cannot turn the agent
 * into an unlimited command-execution mechanism.
 *
 * Limits (per rolling 60s window, in-memory):
 *   - requests per user            (default 10/min)
 *   - requests per session         (default 30/min)
 *   - concurrent agent runs        (default 3 per session, 10 global)
 *   - command executions per turn  (default 10 test_command calls)
 *
 * All limits are fail-closed (over-limit → reject with a user-facing reason)
 * and never block the normal non-AI command pipeline.
 */

const WINDOW_MS = 60 * 1000;

interface WindowCounter {
  count: number;
  windowStart: number;
}

function envInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const n = parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

class AiRateLimiter {
  readonly maxPerUserPerMin = envInt('NEEDLE_RATELIMIT_PER_USER', 10);
  readonly maxPerSessionPerMin = envInt('NEEDLE_RATELIMIT_PER_SESSION', 30);
  readonly maxConcurrentPerSession = envInt('NEEDLE_MAX_CONCURRENT_PER_SESSION', 3);
  readonly maxConcurrentGlobal = envInt('NEEDLE_MAX_CONCURRENT_GLOBAL', 10);
  readonly maxCommandsPerTurn = envInt('NEEDLE_MAX_COMMANDS_PER_TURN', 10);

  readonly #userHits = new Map<string, WindowCounter>();
  readonly #sessionHits = new Map<string, WindowCounter>();
  readonly #concurrentPerSession = new Map<string, number>();
  #concurrentGlobal = 0;

  /** Checks per-user + per-session cadence limits. Returns a reason or null. */
  checkCadence(userKey: string, sessionKey: string): string | null {
    const now = Date.now();
    const user = this.#hit(this.#userHits, userKey, now);
    if (user > this.maxPerUserPerMin) {
      return 'AI rate limit reached. Please wait a minute before trying again.';
    }
    const sess = this.#hit(this.#sessionHits, sessionKey, now);
    if (sess > this.maxPerSessionPerMin) {
      return 'This bot session is handling too many AI requests right now. Please try again shortly.';
    }
    return null;
  }

  /** Attempts to acquire a concurrency slot. False = saturated. */
  tryAcquire(sessionKey: string): boolean {
    const perSession = this.#concurrentPerSession.get(sessionKey) ?? 0;
    if (
      perSession >= this.maxConcurrentPerSession ||
      this.#concurrentGlobal >= this.maxConcurrentGlobal
    ) {
      return false;
    }
    this.#concurrentPerSession.set(sessionKey, perSession + 1);
    this.#concurrentGlobal += 1;
    return true;
  }

  /** Releases a previously acquired concurrency slot. */
  release(sessionKey: string): void {
    const perSession = this.#concurrentPerSession.get(sessionKey) ?? 0;
    if (perSession > 0) {
      if (perSession === 1) this.#concurrentPerSession.delete(sessionKey);
      else this.#concurrentPerSession.set(sessionKey, perSession - 1);
    }
    if (this.#concurrentGlobal > 0) this.#concurrentGlobal -= 1;
  }

  #hit(map: Map<string, WindowCounter>, key: string, now: number): number {
    const entry = map.get(key);
    if (!entry || now - entry.windowStart >= WINDOW_MS) {
      map.set(key, { count: 1, windowStart: now });
      if (map.size > 5000) this.#prune(map, now);
      return 1;
    }
    entry.count += 1;
    return entry.count;
  }

  #prune(map: Map<string, WindowCounter>, now: number): void {
    for (const [k, v] of map) {
      if (now - v.windowStart >= WINDOW_MS) map.delete(k);
    }
  }
}

/** Singleton shared by the agent loop entry point. */
export const aiRateLimiter = new AiRateLimiter();
