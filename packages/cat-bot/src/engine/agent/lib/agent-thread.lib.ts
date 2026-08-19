/**
 * AI Agent — Thread & Session Store
 *
 * Port of canis's src/components/ai/thread.ts + session.ts (Redis-backed)
 * onto Cat-Bot's shared in-memory LRU cache. Threads keep the last
 * AGENT_MAX_HISTORY messages per (session, thread, sender) so the agent can
 * continue a conversation naturally; the session flag makes any message from
 * that sender continue the active chat without a trigger word.
 *
 * All methods keep the async signature of the canis originals so callers stay
 * provider-agnostic (a future swap to a DB/Redis store is a drop-in change).
 */

import crypto from 'crypto';
import { lruCache } from '@/engine/lib/lru-cache.lib.js';

export interface ThreadMessage {
  role: 'user' | 'assistant';
  content: string;
}

/** Identity namespace — unique per bot session + chat + sender. */
export interface AgentThreadKey {
  userId: string;
  platform: string;
  sessionId: string;
  threadID: string;
  senderID: string;
}

const SESSION_TTL_MS = 10 * 60 * 1000; // 10 min idle timeout (matches canis)

// Hardcoded defaults (no env vars — users override these in the dashboard's
// AI Integration → Agent behavior section).
const DEFAULT_MAX_HISTORY = 20;
const DEFAULT_THREAD_TTL = 3600;
const DEFAULT_QUERY_CACHING = true;
const DEFAULT_QUERY_CACHING_TTL = 3600;

function ns(k: AgentThreadKey): string {
  return [k.userId, k.platform, k.sessionId, k.threadID, k.senderID].join(':');
}

function sessionKey(k: AgentThreadKey): string {
  return `agent:session:${ns(k)}`;
}

function threadKey(k: AgentThreadKey): string {
  return `agent:thread:${ns(k)}`;
}

// ── Session state ─────────────────────────────────────────────────────────────

export function isSessionActive(key: AgentThreadKey): boolean {
  return lruCache.get(sessionKey(key)) !== undefined;
}

export function activateSession(key: AgentThreadKey): void {
  lruCache.set(sessionKey(key), '1', SESSION_TTL_MS);
}

export function deactivateSession(key: AgentThreadKey): void {
  lruCache.del(sessionKey(key));
}

// ── Conversation thread ───────────────────────────────────────────────────────

export function getThread(key: AgentThreadKey): ThreadMessage[] {
  const raw = lruCache.get<ThreadMessage[]>(threadKey(key));
  if (!Array.isArray(raw)) return [];
  // Guard against malformed persisted entries.
  return raw.filter(
    (m) =>
      m &&
      (m.role === 'user' || m.role === 'assistant') &&
      typeof m.content === 'string',
  );
}

export interface ThreadLimits {
  maxHistory?: number;
  ttlSeconds?: number;
}

/**
 * Appends a user/assistant pair. Limits come from the user's web-configured
 * agent settings when provided (resolved per turn) and fall back to the env
 * defaults otherwise.
 */
export function appendThread(
  key: AgentThreadKey,
  userContent: string,
  assistantContent: string,
  limits?: ThreadLimits,
): void {
  const existing = getThread(key);
  const updated: ThreadMessage[] = [
    ...existing,
    { role: 'user', content: userContent },
    { role: 'assistant', content: assistantContent },
  ];
  const maxHistory = limits?.maxHistory ?? DEFAULT_MAX_HISTORY;
  const trimmed = updated.slice(-maxHistory);
  const ttlMs = (limits?.ttlSeconds ?? DEFAULT_THREAD_TTL) * 1000;
  lruCache.set(threadKey(key), trimmed, ttlMs);
}

export function clearThread(key: AgentThreadKey): void {
  lruCache.del(threadKey(key));
}

export function getThreadLength(key: AgentThreadKey): number {
  return getThread(key).length;
}

// ── Turn serialization ────────────────────────────────────────────────────────
// A simple per-thread lock so overlapping messages from the same sender never
// run two agent turns concurrently. Without it, a quick burst of messages can
// race on appendThread (interleaved/lost history) and produce duplicate replies
// to the same thread. The lock is held for the whole turn and released in a
// finally block; a second message arriving mid-turn is skipped (the active
// session keeps working and the sender can just send again).

function turnKey(k: AgentThreadKey): string {
  return `agent:turn:${ns(k)}`;
}

const turnLocks = new Set<string>();

export function isTurnInFlight(key: AgentThreadKey): boolean {
  return turnLocks.has(turnKey(key));
}

/** Attempts to take the turn lock; returns false when a turn is already running. */
export function acquireTurnLock(key: AgentThreadKey): boolean {
  const tk = turnKey(key);
  if (turnLocks.has(tk)) return false;
  turnLocks.add(tk);
  return true;
}

export function releaseTurnLock(key: AgentThreadKey): void {
  turnLocks.delete(turnKey(key));
}

// ── Prompt result caching (canis agentHandler) ────────────────────────────────

function cacheKey(prompt: string): string {
  const hash = crypto.createHash('sha256').update(prompt).digest('hex');
  return `ai:prompt:${hash}`;
}

/**
 * Cached-text lookup for a prompt. Returns undefined on miss (and when
 * caching is disabled). The prompt's %TODAY% placeholder is substituted here
 * so "today" never goes stale in a cached reply.
 */
export function getCachedResult(
  prompt: string,
  today: string,
): string | undefined {
  if (!DEFAULT_QUERY_CACHING) return undefined;
  const p = prompt.replace('%TODAY%', today);
  return lruCache.get<string>(cacheKey(p));
}

export function cacheResult(
  prompt: string,
  today: string,
  result: string,
): void {
  if (!DEFAULT_QUERY_CACHING) return;
  const p = prompt.replace('%TODAY%', today);
  lruCache.set(cacheKey(p), result, DEFAULT_QUERY_CACHING_TTL * 1000);
}
