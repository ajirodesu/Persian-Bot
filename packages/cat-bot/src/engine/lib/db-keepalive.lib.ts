/**
 * DB Keep-Alive — periodic no-op query to prevent database cold-starts.
 *
 * There are two independent, DB-layer causes of the "first command after being idle
 * is slow" symptom — neither is fixed by application-level caching, because both
 * happen below the cache:
 *
 *   1. Neon's serverless Postgres auto-suspends its compute endpoint after ~5 minutes
 *      of inactivity (scale-to-zero). The next query after suspension pays a
 *      several-hundred-millisecond "wake up" delay on Neon's side before it even
 *      starts executing — this happens regardless of whether our pg Pool object
 *      still holds what it thinks is a live client.
 *   2. Both pg's Pool and the MongoDB driver's socket pool close idle client sockets
 *      after a timeout, forcing a fresh TCP/TLS handshake on the next query issued
 *      after a quiet period — same symptom, different mechanism, and it recurs for
 *      as long as the process runs, not just once at boot.
 *
 * A lightweight heartbeat query on an interval comfortably shorter than Neon's
 * auto-suspend window keeps both the compute endpoint and the pooled connection
 * warm, so real user commands never pay either cost — this is what actually keeps
 * ping/uptime (and every other DB-backed command) fast and consistent after periods
 * with no traffic, rather than just shifting the cold-start cost onto whichever
 * command a user happens to run first.
 */
import { pool, mongoClient, getMongoDb } from 'database';
import { logger } from '@/engine/modules/logger/logger.lib.js';

// Comfortably inside Neon's default 5-minute auto-suspend window, with margin for
// timer jitter under load. Cheap enough (SELECT 1 / ping) to run this often.
const KEEPALIVE_INTERVAL_MS = 4 * 60 * 1000;

async function heartbeat(): Promise<void> {
  if (pool) {
    await pool.query('SELECT 1');
  } else if (mongoClient) {
    await getMongoDb().command({ ping: 1 });
  }
}

/**
 * Starts the recurring heartbeat. Call once at boot, after the initial DB
 * connection/warm-up has completed and before platform listeners start.
 */
export function startDbKeepAlive(): void {
  if (!pool && !mongoClient) return; // No active adapter (e.g. unit tests) — nothing to keep warm.

  const timer = setInterval(() => {
    void heartbeat().catch((err: unknown) => {
      // Fail silently (beyond a log line) — a missed heartbeat just means the next
      // real query pays the cold-start cost once. It must never crash the process
      // or interfere with command handling.
      logger.warn('[db-keepalive] Heartbeat query failed', { error: err });
    });
  }, KEEPALIVE_INTERVAL_MS);

  // Don't let this timer keep the Node.js process alive by itself during shutdown.
  timer.unref();
}
