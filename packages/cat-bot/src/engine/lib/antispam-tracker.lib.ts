/**
 * antispam-tracker.lib.ts — Sliding-Window Message-Rate Tracker
 *
 * Backing store for antispam.ts's onChat spam detector. Tracks, per
 * (threadID, senderID) pair, the timestamps of recent messages and reports
 * whether the count within the active window has reached a caller-supplied
 * threshold.
 *
 * ── Why a sliding window, not a fixed counter ───────────────────────────────
 * A naive "increment forever" counter would eventually kick any long-time
 * active member. Spam is a *rate* phenomenon — N messages within a short
 * span — so old timestamps outside WINDOW_MS are pruned on every check
 * before counting, keeping the measurement anchored to "right now" rather
 * than all-time activity.
 *
 * ── Memory safety ────────────────────────────────────────────────────────────
 * Backed by TTLMap in sliding mode: entries expire WINDOW_MS after the last
 * message from that user, so idle members are evicted automatically without
 * a background sweep timer.
 */

import { TTLMap } from '@/engine/lib/ttl-map.lib.js';

/** The span, in ms, within which messages are counted toward the spam threshold. */
export const ANTISPAM_WINDOW_MS = 10_000;

const store = new TTLMap<number[]>({
  ttlMs: ANTISPAM_WINDOW_MS,
  sliding: true,
  pruneThreshold: 1000,
});

function keyFor(threadID: string, senderID: string): string {
  return `${threadID}:${senderID}`;
}

/**
 * Records a message timestamp for (threadID, senderID) and returns true if
 * the number of messages within the trailing ANTISPAM_WINDOW_MS window has
 * reached `threshold`.
 */
export function recordMessageAndCheckSpam(
  threadID: string,
  senderID: string,
  threshold: number,
): boolean {
  const key = keyFor(threadID, senderID);
  const now = Date.now();

  const existing = store.get(key) ?? [];
  const withinWindow = existing.filter((t) => now - t < ANTISPAM_WINDOW_MS);
  withinWindow.push(now);

  store.set(key, withinWindow);

  return withinWindow.length >= threshold;
}

/**
 * Clears tracked timestamps for (threadID, senderID). Called after a kick
 * attempt (success or failure) so the user gets a fresh window rather than
 * re-triggering a kick attempt on their very next message.
 */
export function resetSpamTracking(threadID: string, senderID: string): void {
  store.delete(keyFor(threadID, senderID));
}
