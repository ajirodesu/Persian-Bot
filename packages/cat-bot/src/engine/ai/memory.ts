/**
 * Conversation memory — per-user/per-thread history with bounded recent
 * turns, AI summarisation of older turns, structured profiles and durable
 * facts. Backed by in-memory caches plus Persian-Bot's database collections
 * (db.users / db.threads) when a persistence handle is supplied, so state
 * survives restarts.
 *
 * Shape: recent turns + compressed historical summary + durable user facts.
 *
 * Portions derived from Reze-Bot (MIT):
 *   https://github.com/GrandpaEJx/Reze-Bot
 * See THIRD_PARTY_NOTICES.md. Adapted to Persian-Bot conventions.
 */

import { askAgentText } from './runner.js';
import { logger } from '@/engine/modules/logger/logger.lib.js';
import type { ChatMessage } from './provider/types.js';

export interface UserProfile {
  userId: string;
  displayName?: string | null;
  username?: string | null;
  preferredName?: string | null;
  firstName?: string | null;
  language?: string | null;
  firstSeen: number;
  lastSeen: number;
  messageCount: number;
  facts: string[];
  summary?: string | null;
}

export interface ConversationState {
  messages: ChatMessage[];
  summary: string | null;
}

/** Minimal persistence surface over db.users-style collections. */
export interface MemoryStore {
  loadProfile(userId: string): Promise<UserProfile | null>;
  saveProfile(profile: UserProfile): Promise<void>;
  loadConversation(key: string): Promise<ConversationState | null>;
  saveConversation(key: string, state: ConversationState): Promise<void>;
}

const DEFAULT_MAX_TURNS = 20;
const DEFAULT_KEEP_RECENT = 10;
const SECRET_PATTERN = /(password|passwd|api[-_ ]?key|secret|token|bearer|auth|credential|private[-_ ]?key|seed[-_ ]?phrase)/i;
const FORGET_PATTERN = /\b(forget|delete|remove|erase|do not remember|don't remember|never mind about)\b/i;

const profiles = new Map<string, UserProfile>();
const conversations = new Map<string, ConversationState>();

/** Test seam — clear in-memory state. */
export function clearMemory(): void {
  profiles.clear();
  conversations.clear();
}

export function memoryKey(parts: { userId: string; sessionId: string; threadId: string }): string {
  return `${parts.userId}:${parts.sessionId}:${parts.threadId}`;
}

export function upsertProfile(userId: string, patch: Partial<UserProfile> = {}): UserProfile {
  const now = Date.now();
  const existing = profiles.get(userId);
  const profile: UserProfile = existing ?? {
    userId,
    displayName: null,
    username: null,
    preferredName: null,
    firstName: null,
    language: null,
    firstSeen: now,
    lastSeen: now,
    messageCount: 0,
    facts: [],
    summary: null,
  };
  Object.assign(profile, patch, { userId, lastSeen: now });
  if (!existing) profile.firstSeen = now;
  profiles.set(userId, profile);
  return profile;
}

export function getProfile(userId: string): UserProfile | undefined {
  return profiles.get(userId);
}

export function recordMessage(userId: string): UserProfile {
  const profile = upsertProfile(userId);
  profile.messageCount += 1;
  return profile;
}

/** Detect "call me X" / "my name is X" style preferred-name statements. */
export function detectPreferredName(text: string): string | null {
  const patterns = [
    /(?:call me|my name is|i am|i'm|this is)\s+([A-Za-z][A-Za-z'_-]{1,30})/i,
    /(?:naam\s+)?([A-Za-z][A-Za-z'_-]{1,30})\s+bolte\s+paro/i,
  ];
  for (const re of patterns) {
    const m = text.match(re);
    if (m?.[1]) return m[1].trim();
  }
  return null;
}

const FACT_PATTERNS: { key: string; re: RegExp }[] = [
  { key: 'Age', re: /\bi am (\d{1,3}) years old\b/i },
  { key: 'Age', re: /\bage\s*(?:is|:)?\s*(\d{1,3})\b/i },
  { key: 'Lives in', re: /\bi live in ([A-Za-z][\w\s,.-]{1,60})/i },
  { key: 'From', re: /\bi(?:'m| am) from ([A-Za-z][\w\s,.-]{1,60})/i },
  { key: 'Works as', re: /\bi work as (?:a |an )?([\w\s,.-]{1,60})/i },
  { key: 'Studies', re: /\bi study ([\w\s,.-]{1,60})/i },
  { key: 'Likes', re: /\bi like ([\w\s,.-]{1,60})/i },
  { key: 'Likes', re: /\bi love ([\w\s,.-]{1,60})/i },
];

/** Extract durable facts from a user message (explicit self-statements only). */
export function extractFacts(text: string): string[] {
  if (!text || SECRET_PATTERN.test(text) || FORGET_PATTERN.test(text)) return [];
  const facts: string[] = [];
  for (const { key, re } of FACT_PATTERNS) {
    const m = text.match(re);
    if (m?.[1]) {
      const value = m[1].trim().replace(/\s+/g, ' ').slice(0, 80);
      if (value) facts.push(`${key}: ${value}`);
    }
  }
  return facts;
}

/**
 * Merge facts into a profile (max 12, same-label replacement). Refuses
 * secrets, credentials, and anything the user asked to forget.
 */
export function mergeFacts(profile: UserProfile, facts: string[]): void {
  for (const raw of facts) {
    const fact = String(raw).trim().slice(0, 120);
    if (!fact) continue;
    if (SECRET_PATTERN.test(fact)) continue;
    if (FORGET_PATTERN.test(fact)) continue;

    const label = fact.split(':')[0]?.trim().toLowerCase() ?? fact.toLowerCase();
    const idx = profile.facts.findIndex(
      (f) => (f.split(':')[0]?.trim().toLowerCase() ?? '') === label,
    );
    if (idx >= 0) profile.facts[idx] = fact;
    else profile.facts.push(fact);
  }
  if (profile.facts.length > 12) {
    profile.facts = profile.facts.slice(profile.facts.length - 12);
  }
}

/** Store one user-stated fact; enforces the secret/forget guards. */
export function rememberUserFact(profile: UserProfile, fact: string): boolean {
  const clean = String(fact ?? '').trim().slice(0, 120);
  if (!clean) return false;
  if (SECRET_PATTERN.test(clean)) return false;
  if (FORGET_PATTERN.test(clean)) return false;
  mergeFacts(profile, [clean]);
  return true;
}

export function getConversation(key: string): ConversationState {
  let state = conversations.get(key);
  if (!state) {
    state = { messages: [], summary: null };
    conversations.set(key, state);
  }
  return state;
}

/** Append a turn, keeping history bounded; compresses when over the limit. */
export async function appendTurn(
  key: string,
  turn: ChatMessage[],
  opts: { maxTurns?: number; keepRecent?: number; summarize?: boolean } = {},
): Promise<ConversationState> {
  const maxTurns = opts.maxTurns ?? DEFAULT_MAX_TURNS;
  const keepRecent = opts.keepRecent ?? DEFAULT_KEEP_RECENT;
  const state = getConversation(key);
  state.messages.push(...turn);
  if (state.messages.length > maxTurns) {
    await maybeCompressHistory(key, { keepRecent, summarize: opts.summarize ?? true });
  }
  return state;
}

/**
 * Summarise older history into `summary`, keeping only recent turns.
 * Falls back to a raw digest slice when the summariser is unavailable, so a
 * failed compression never loses the conversation.
 */
export async function maybeCompressHistory(
  key: string,
  opts: { keepRecent?: number; summarize?: boolean } = {},
): Promise<ConversationState> {
  const keepRecent = opts.keepRecent ?? DEFAULT_KEEP_RECENT;
  const state = getConversation(key);
  if (state.messages.length <= keepRecent) return state;

  const older = state.messages.slice(0, state.messages.length - keepRecent);
  const recent = state.messages.slice(state.messages.length - keepRecent);

  let summary: string | null = null;
  if (opts.summarize !== false) {
    summary = await summarizeTurns(older);
  }
  if (!summary) {
    // Fallback digest — never lose the conversation to a provider failure.
    summary = older
      .map((m) => `${m.role}: ${(m.content ?? '').slice(0, 200)}`)
      .join('\n')
      .slice(0, 800);
  }

  state.summary = [state.summary, summary].filter(Boolean).join('\n').slice(0, 2000);
  state.messages = recent;
  return state;
}

async function summarizeTurns(older: ChatMessage[]): Promise<string | null> {
  const transcript = older
    .map((m) => `${m.role}: ${m.content ?? ''}`)
    .join('\n')
    .slice(0, 4000);
  if (!transcript.trim()) return null;
  try {
    const res = await askAgentText('default', {
      system:
        'Summarise the conversation below into 3-6 short lines: who the user is, what they asked, any decisions or facts worth remembering. No preamble.',
      user: transcript,
      overrides: { maxTokens: 256, temperature: 0 },
    });
    return res.data.slice(0, 1200);
  } catch (err) {
    logger.warn(`[memory] summarisation failed — using digest fallback (${(err as Error)?.message?.slice(0, 100)})`);
    return null;
  }
}

/** Recent turns + summary + facts in prompt-ready form. */
export function buildMemoryContext(key: string, profile?: UserProfile | null): string | null {
  const state = conversations.get(key);
  const parts: string[] = [];
  if (state?.summary) parts.push(`Earlier summary:\n${state.summary}`);
  if (profile?.facts?.length) parts.push(`Known facts: ${profile.facts.join('; ')}`);
  if (parts.length === 0) return null;
  return parts.join('\n');
}

/**
 * Build a persistence adapter over Persian-Bot db collections. The caller
 * supplies collection handles scoped to the current session; memory keeps
 * working fully in-memory when persistence throws.
 */
export function createDbMemoryStore(handles: {
  loadUser: (userId: string) => Promise<Record<string, unknown> | null>;
  saveUser: (userId: string, data: Record<string, unknown>) => Promise<void>;
  loadThread: (threadId: string) => Promise<Record<string, unknown> | null>;
  saveThread: (threadId: string, data: Record<string, unknown>) => Promise<void>;
}): MemoryStore {
  return {
    async loadProfile(userId: string): Promise<UserProfile | null> {
      try {
        const data = await handles.loadUser(userId);
        const stored = data?.ai_profile as Partial<UserProfile> | undefined;
        if (!stored || typeof stored !== 'object') return null;
        const profile = upsertProfile(userId, {
          displayName: typeof stored.displayName === 'string' ? stored.displayName : null,
          username: typeof stored.username === 'string' ? stored.username : null,
          preferredName: typeof stored.preferredName === 'string' ? stored.preferredName : null,
          firstName: typeof stored.firstName === 'string' ? stored.firstName : null,
          language: typeof stored.language === 'string' ? stored.language : null,
          firstSeen: typeof stored.firstSeen === 'number' ? stored.firstSeen : Date.now(),
          lastSeen: typeof stored.lastSeen === 'number' ? stored.lastSeen : Date.now(),
          messageCount: typeof stored.messageCount === 'number' ? stored.messageCount : 0,
          facts: Array.isArray(stored.facts) ? stored.facts.filter((f): f is string => typeof f === 'string') : [],
          summary: typeof stored.summary === 'string' ? stored.summary : null,
        });
        return profile;
      } catch {
        return profiles.get(userId) ?? null;
      }
    },
    async saveProfile(profile: UserProfile): Promise<void> {
      try {
        await handles.saveUser(profile.userId, { ai_profile: { ...profile } });
      } catch (err) {
        logger.warn(`[memory] profile persist failed (${(err as Error)?.message?.slice(0, 100)})`);
      }
    },
    async loadConversation(key: string): Promise<ConversationState | null> {
      try {
        const data = await handles.loadThread(key);
        const stored = data?.ai_conversation as ConversationState | undefined;
        if (!stored || !Array.isArray(stored.messages)) return null;
        const state = getConversation(key);
        state.messages = stored.messages.slice(-DEFAULT_MAX_TURNS);
        state.summary = typeof stored.summary === 'string' ? stored.summary : null;
        return state;
      } catch {
        return conversations.get(key) ?? null;
      }
    },
    async saveConversation(key: string, state: ConversationState): Promise<void> {
      try {
        await handles.saveThread(key, {
          ai_conversation: { messages: state.messages.slice(-DEFAULT_MAX_TURNS), summary: state.summary },
        });
      } catch (err) {
        logger.warn(`[memory] conversation persist failed (${(err as Error)?.message?.slice(0, 100)})`);
      }
    },
  };
}
