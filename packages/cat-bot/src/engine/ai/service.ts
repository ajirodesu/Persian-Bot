/**
 * AI service — the Persian-Bot integration point for the Reze-style agent engine.
 *
 * Owns the end-to-end conversational flow for a live chat turn:
 *   cheap deterministic checks → prefetch → prompt → bounded tool loop →
 *   memory persist → reply text
 *
 * plus moderation helpers (rule engine → agent → confidence gate) and
 * structured, secret-free logging. All command execution flows through the
 * existing middleware + dispatcher pipeline, so AI-initiated commands inherit
 * exactly the same bans, permissions, cooldowns, admin-only gates and
 * maintenance-mode behaviour as human invocations. Recursion is blocked with
 * an `aiInitiated` event marker.
 *
 * Portions derived from Reze-Bot (MIT):
 *   https://github.com/GrandpaEJx/Reze-Bot
 * See THIRD_PARTY_NOTICES.md.
 */

import { runLoop, LOOP_DEFAULTS } from './loop.js';
import { listTools } from './tools.js';
import type { Tool, ToolContext } from './tools.js';
import { ensureBuiltins } from './builtin-tools.js';
import { prefetch, renderPrefetch } from './prefetch.js';
import { buildAgentPrompt } from './prompt-agent.js';
import {
  upsertProfile,
  recordMessage,
  detectPreferredName,
  extractFacts,
  mergeFacts,
  getConversation,
  appendTurn,
  memoryKey,
} from './memory.js';
import { isAiEnabled, getPersistedAiConfig, ensureUserAiSnapshot } from './config.js';
import { getPolicy, recordModeration } from './policy-store.js';
import type { PolicyStoreHandles, ModAuditEntry } from './policy-store.js';
import { getIntegrationTools } from './mcp/integrations.js';
import { judgeWithConsensus } from './consensus.js';
import { coerceVerdict } from './agent-types.js';
import type { ChatPolicy } from './agent-types.js';
import { getBotNickname } from '@/engine/repos/session.repo.js';
import { cooldownStore } from '@/engine/lib/cooldown.lib.js';
import { isSystemAdmin } from '@/engine/repos/system-admin.repo.js';
import { listBotAdmins, listBotPremiums } from '@/engine/repos/credentials.repo.js';
import { getMaintenanceModeEnabled } from '@/engine/repos/maintenance-mode.repo.js';
import { Role } from '@/engine/constants/role.constants.js';
import { logger } from '@/engine/modules/logger/logger.lib.js';
import type { AppCtx } from '@/engine/types/controller.types.js';
import type { ChatMessage } from './provider/types.js';

ensureBuiltins();

const AI_MARKER = 'aiInitiated';

/** True when this event was itself produced by an AI command execution. */
export function isAiInitiatedEvent(event: Record<string, unknown>): boolean {
  return event[AI_MARKER] === true;
}

/**
 * Best-effort role resolution for the sender. Fail-open to ANYONE (the most
 * restrictive level for tool gating — safe direction).
 */
export async function resolveSenderRole(
  ctx: Pick<AppCtx, 'native' | 'event'>,
  senderId: string,
): Promise<number> {
  try {
    if (await isSystemAdmin(senderId)) return Role.SYSTEM_ADMIN;
  } catch {
    /* fail-open */
  }
  const { userId, platform, sessionId } = ctx.native;
  if (userId && sessionId) {
    try {
      const admins = await listBotAdmins(userId, platform, sessionId);
      if (admins.includes(senderId)) return Role.BOT_ADMIN;
    } catch {
      /* fail-open */
    }
    try {
      const premiums = await listBotPremiums(userId, platform, sessionId);
      if (premiums.includes(senderId)) return Role.PREMIUM;
    } catch {
      /* fail-open */
    }
  }
  return Role.ANYONE;
}

export function buildToolContext(ctx: AppCtx, opts: { role: number }): ToolContext {
  const event = ctx.event;
  const toolCtx: ToolContext = {
    threadId: String(event['threadID'] ?? event['thread_id'] ?? 'dm'),
    senderId: String(event['senderID'] ?? event['userID'] ?? 'unknown'),
    role: opts.role,
    isGroup: Boolean(event['isGroup'] ?? event['is_group'] ?? false),
    platform: ctx.native.platform,
    chatTitle: (event['threadName'] as string | undefined) ?? null,
    userName: (event['senderName'] as string | undefined) ?? null,
    aiInitiated: isAiInitiatedEvent(event),
    appCtx: ctx,
  };
  if (ctx.native.userId) toolCtx.userId = ctx.native.userId;
  if (ctx.native.sessionId) toolCtx.sessionId = ctx.native.sessionId;
  return toolCtx;
}

export interface ChatAgentOptions {
  agent?: string;
  maxSteps?: number;
  timeoutMs?: number;
  signal?: AbortSignal;
}

export interface ChatAgentResult {
  text: string;
  stopReason: string;
  steps: number;
  toolCalls: { name: string; ok: boolean; ms: number }[];
  /** File references collected from tool results — the caller delivers them. */
  attachments: { name: string; url: string }[];
  /** True when a tool already delivered the reply (send_result). */
  delivered: boolean;
  model?: string;
}

/**
 * Run one conversational AI turn for a live chat message. Returns reply text
 * (possibly empty when the engine is disabled/unavailable — callers fall back
 * to their existing behaviour).
 */
export async function runChatAgent(
  ctx: AppCtx,
  prefix: string,
  userText: string,
  opts: ChatAgentOptions = {},
): Promise<ChatAgentResult> {
  const started = Date.now();
  const empty: ChatAgentResult = {
    text: '',
    stopReason: 'error',
    steps: 0,
    toolCalls: [],
    attachments: [],
    delivered: false,
  };

  const ownerId = ctx.native.userId;
  if (ownerId) {
    try {
      await ensureUserAiSnapshot(ownerId);
    } catch {
      /* fail-open to env-only snapshot */
    }
  }
  if (!isAiEnabled(ownerId)) return { ...empty, stopReason: 'disabled' };
  if (isAiInitiatedEvent(ctx.event)) return { ...empty, stopReason: 'disabled' };
  const text = userText.trim();
  if (!text) return empty;

  const event = ctx.event;
  const senderId = String(event['senderID'] ?? event['userID'] ?? 'unknown');
  const threadId = String(event['threadID'] ?? event['thread_id'] ?? 'dm');
  const isGroup = Boolean(event['isGroup'] ?? event['is_group'] ?? false);

  const role = await resolveSenderRole(ctx, senderId);
  const toolCtx = buildToolContext(ctx, { role });

  // ── Memory: profile + facts (best-effort persistence) ──
  const profile = recordMessage(senderId);
  const preferred = detectPreferredName(text);
  if (preferred) profile.preferredName = preferred;
  const facts = extractFacts(text);
  if (facts.length > 0) mergeFacts(profile, facts);
  persistProfileBestEffort(ctx, senderId, profile).catch(() => undefined);

  // ── Conversation history (bounded) ──
  const key = memoryKey({
    userId: ctx.native.userId ?? 'global',
    sessionId: ctx.native.sessionId ?? 'global',
    threadId: senderId,
  });
  const convo = getConversation(key);
  const recentUserTexts = convo.messages
    .filter((m) => m.role === 'user')
    .map((m) => String(m.content ?? ''))
    .slice(-4);

  // ── Deterministic prefetch for unmistakable requests ──
  let prefetched: string;
  try {
    const results = await prefetch(text, toolCtx, [...recentUserTexts, text]);
    prefetched = renderPrefetch(results);
  } catch {
    prefetched = '';
  }

  // ── Prompt ──
  let botName: string | null = null;
  try {
    if (ctx.native.userId && ctx.native.sessionId) {
      botName = await getBotNickname(ctx.native.userId, ctx.native.platform, ctx.native.sessionId);
    }
  } catch {
    botName = null;
  }

  // ── User MCP/Skills (best-effort, role-gated, budgeted) ──
  let integrationTools: Tool[];
  let skillPrompt: string | null;
  try {
    const bundle = await getIntegrationTools(ownerId, role);
    integrationTools = bundle.tools;
    skillPrompt = bundle.skillPrompt;
  } catch {
    integrationTools = [];
    skillPrompt = null;
  }
  const prompt = buildAgentPrompt({
    botName,
    commandPrefix: prefix,
    soulText: null,
    profile: {
      preferredName: profile.preferredName,
      firstName: profile.firstName,
      username: profile.username,
      language: profile.language,
      facts: profile.facts,
      messageCount: profile.messageCount,
    },
    isGroup,
    chatTitle: toolCtx.chatTitle,
    platform: ctx.native.platform,
    hasTools: true,
    prefetched: prefetched || null,
    summary: convo.summary,
    skillText: skillPrompt,
  });

  const history: ChatMessage[] = [...convo.messages.slice(-10), { role: 'user', content: text }];

  // ── Bounded tool loop ──
  const execCfg = getPersistedAiConfig(ownerId).execution ?? {};
  let result;
  try {
    result = await runLoop({
      agent: opts.agent ?? 'default',
      system: prompt.text,
      messages: history,
      tools: [...listTools({ role }), ...integrationTools],
      ctx: toolCtx,
      maxSteps: opts.maxSteps ?? execCfg.maxSteps ?? LOOP_DEFAULTS.maxSteps,
      timeoutMs: opts.timeoutMs ?? execCfg.timeoutMs ?? LOOP_DEFAULTS.timeoutMs,
      maxToolErrors: execCfg.maxToolErrors ?? LOOP_DEFAULTS.maxToolErrors,
      maxCallsPerStep: execCfg.maxCallsPerStep ?? LOOP_DEFAULTS.maxCallsPerStep,
    });
  } catch (err) {
    logger.warn('[ai] agent loop failed', { error: (err as Error)?.message ?? String(err) });
    return { ...empty, stopReason: 'error' };
  }

  // ── Persist turn (best-effort) ──
  try {
    await appendTurn(key, [
      { role: 'user', content: text },
      { role: 'assistant', content: result.text },
    ]);
    persistConversationBestEffort(ctx, threadId, key).catch(() => undefined);
  } catch {
    /* memory failures never break the reply */
  }

  const ms = Date.now() - started;
  logger.info('[ai] turn complete', {
    agent: opts.agent ?? 'default',
    model: result.model ?? 'unknown',
    latencyMs: ms,
    steps: result.steps,
    stopReason: result.stopReason,
    toolCalls: result.toolCalls.map((t) => `${t.name}:${t.ok ? 'ok' : 'err'}`).join(',') || 'none',
    promptTokensEst: prompt.estimatedTokens,
    droppedSections: prompt.dropped.join(',') || 'none',
  });

  return {
    text: result.text,
    stopReason: result.stopReason,
    steps: result.steps,
    toolCalls: result.toolCalls.map((t) => ({ name: t.name, ok: t.ok, ms: t.ms })),
    attachments: result.attachments,
    delivered: result.delivered,
    ...(result.model ? { model: result.model } : {}),
  };
}

async function persistProfileBestEffort(
  ctx: AppCtx,
  senderId: string,
  profile: ReturnType<typeof upsertProfile>,
): Promise<void> {
  try {
    const coll = ctx.db.users.collection(senderId);
    if (!(await coll.isCollectionExist('ai_memory'))) {
      await coll.createCollection('ai_memory');
    }
    const handle = await coll.getCollection('ai_memory');
    await handle.set('ai_profile', { ...profile });
  } catch {
    /* best-effort */
  }
}

async function persistConversationBestEffort(
  ctx: AppCtx,
  threadId: string,
  key: string,
): Promise<void> {
  try {
    const convo = getConversation(key);
    const coll = ctx.db.threads.collection(threadId);
    if (!(await coll.isCollectionExist('ai_memory'))) {
      await coll.createCollection('ai_memory');
    }
    const handle = await coll.getCollection('ai_memory');
    await handle.set('ai_conversation', {
      messages: convo.messages.slice(-20),
      summary: convo.summary,
    });
  } catch {
    /* best-effort */
  }
}

/**
 * Thread-collection-backed moderation policy handles — policies persist in
 * the database (`ai_memory` collection) instead of memory only.
 */
export function threadPolicyHandles(ctx: AppCtx, threadId: string): PolicyStoreHandles {
  return {
    loadThreadPolicy: async (tid: string) => {
      try {
        const coll = ctx.db.threads.collection(tid || threadId);
        if (!(await coll.isCollectionExist('ai_memory'))) return null;
        const handle = await coll.getCollection('ai_memory');
        const stored = await handle.get('moderation_policy');
        return (
          stored && typeof stored === 'object'
            ? (stored as Partial<ChatPolicy>)
            : null
        );
      } catch {
        return null;
      }
    },
    saveThreadPolicy: async (tid: string, policy: ChatPolicy) => {
      try {
        const coll = ctx.db.threads.collection(tid || threadId);
        if (!(await coll.isCollectionExist('ai_memory'))) {
          await coll.createCollection('ai_memory');
        }
        const handle = await coll.getCollection('ai_memory');
        await handle.set('moderation_policy', { ...policy });
      } catch {
        /* best-effort */
      }
    },
  };
}

/**
 * Audit sink that appends moderation entries to the thread's `ai_memory`
 * collection (capped at 100), so the audit trail survives restarts.
 */
export function threadAuditPersister(
  ctx: AppCtx,
  threadId: string,
): (entry: ModAuditEntry) => Promise<void> {
  return async (entry: ModAuditEntry): Promise<void> => {
    try {
      const coll = ctx.db.threads.collection(threadId);
      if (!(await coll.isCollectionExist('ai_memory'))) {
        await coll.createCollection('ai_memory');
      }
      const handle = await coll.getCollection('ai_memory');
      const existing = (await handle.get('moderation_audit')) as ModAuditEntry[] | undefined;
      const list = Array.isArray(existing) ? existing : [];
      list.push(entry);
      await handle.set('moderation_audit', list.slice(-100));
    } catch {
      /* best-effort */
    }
  };
}

// ── Moderation ───────────────────────────────────────────────────────────────

const URL_RE = /https?:\/\/[^\s<>()]+|(?:www\.)[^\s<>()]+|t\.me\/[^\s]+/gi;

/** Obfuscated links — "example dot com", "t . me / x" (entity-free dodge). */
const OBFUSCATED =
  /\b[\w-]{2,}\s*(?:\[|\()?\s*(?:dot|\.)\s*(?:\]|\))?\s*(?:com|net|org|io|xyz|me|ru|link|shop|site|top|online|app|co)\b/i;
const TME = /\bt\s*[.\s]*me\s*\/\s*\S+/i;

/**
 * Turn a dodged domain back into a real one so it matches allow/deny lists:
 * "spam dot com" → "spam.com". Adapted from Reze-Bot (MIT).
 */
function deobfuscate(raw: string): string {
  return raw
    .replace(/\s*(?:\[|\()?\s*dot\s*(?:\]|\))?\s*/gi, '.')
    .replace(/\s*(?:\[|\()?\s*\.\s*(?:\]|\))?\s*/g, '.')
    .replace(/\s+/g, '')
    .toLowerCase();
}

export function extractLinks(text: string): string[] {
  if (!text) return [];
  const found = text.match(URL_RE) ?? [];
  const out = [...found];
  if (out.length === 0) {
    const tme = text.match(TME);
    if (tme?.[0]) out.push(deobfuscate(tme[0]));
    const obf = text.match(OBFUSCATED);
    if (obf?.[0]) out.push(deobfuscate(obf[0]));
  }
  return [...new Set(out.map((u) => u.trim().toLowerCase()))].filter(Boolean).slice(0, 10);
}

export interface ModerationOutcome {
  action: 'allow' | 'delete' | 'warn' | 'mute' | 'ban' | 'flag';
  category: string;
  confidence: number;
  reason: string;
  stage: 'rules' | 'agent' | 'consensus';
  trace?: string;
  model?: string;
}

/**
 * Moderate one message: cheap deterministic rules first, AI agent only when
 * necessary, confidence gate before any enforcement recommendation.
 * Side-effect free — callers enforce via their platform adapter.
 */
export async function moderateMessage(input: {
  threadId: string;
  senderId: string;
  text: string;
  senderRole: number;
  isGroup: boolean;
  /** Dashboard owner id — selects their DB-backed moderation tuning. */
  userId?: string;
  policyHandles?: Parameters<typeof getPolicy>[1];
  context?: string[];
  chatTitle?: string | null;
  /** Optional sink so audit entries reach the database, not just memory. */
  persistAudit?: (entry: ModAuditEntry) => void | Promise<void>;
}): Promise<ModerationOutcome> {
  if (input.userId) {
    try {
      await ensureUserAiSnapshot(input.userId);
    } catch {
      /* fail-open */
    }
  }
  const modCfg = getPersistedAiConfig(input.userId).moderation ?? {};
  if (modCfg.enabled === false) {
    return { action: 'allow', category: 'legit', confidence: 1, reason: 'moderation disabled', stage: 'rules' };
  }

  const policy: ChatPolicy = await getPolicy(input.threadId, input.policyHandles);
  const audit = (e: Omit<ModAuditEntry, 'id' | 'at'>): void => {
    const full = recordModeration(e);
    if (input.persistAudit) {
      try {
        void input.persistAudit(full);
      } catch {
        /* best-effort */
      }
    }
  };
  if (!policy.enabled) {
    return { action: 'allow', category: 'legit', confidence: 1, reason: 'policy disabled', stage: 'rules' };
  }

  // Privileged / whitelisted senders bypass content checks.
  if (input.senderRole >= 3 || policy.whitelist.includes(input.senderId)) {
    return { action: 'allow', category: 'legit', confidence: 1, reason: 'exempt sender', stage: 'rules' };
  }

  const links = extractLinks(input.text);
  const hasSomethingToJudge = links.length > 0;
  if (policy.links.mode === 'off' || !hasSomethingToJudge) {
    return { action: 'allow', category: 'legit', confidence: 1, reason: 'nothing to judge', stage: 'rules' };
  }

  // Deterministic rule engine: deny/allow domain lists.
  const lower = links.map((l) => l.toLowerCase());
  if (policy.links.denyDomains.some((d) => lower.some((l) => l.includes(d.toLowerCase())))) {
    const outcome: ModerationOutcome = {
      action: policy.links.enforcement.delete ? 'delete' : 'flag',
      category: 'promo',
      confidence: 1,
      reason: 'matched denyDomains list',
      stage: 'rules',
    };
    audit({ threadId: input.threadId, senderId: input.senderId, ...outcome });
    return outcome;
  }
  if (
    policy.links.allowDomains.length > 0 &&
    policy.links.mode === 'strict' &&
    !policy.links.allowDomains.some((d) => lower.some((l) => l.includes(d.toLowerCase())))
  ) {
    const outcome: ModerationOutcome = {
      action: policy.links.enforcement.delete ? 'delete' : 'flag',
      category: 'offtopic',
      confidence: 0.9,
      reason: 'strict mode: domain not allowlisted',
      stage: 'rules',
    };
    audit({ threadId: input.threadId, senderId: input.senderId, ...outcome });
    return outcome;
  }
  if (
    policy.links.allowDomains.some((d) => lower.some((l) => l.includes(d.toLowerCase()))) &&
    policy.links.mode === 'strict'
  ) {
    return { action: 'allow', category: 'legit', confidence: 1, reason: 'allowlisted domain', stage: 'rules' };
  }

  // AI escalation.
  let verdict = coerceVerdict(null);
  let stage: 'agent' | 'consensus' = 'agent';
  let trace: string | undefined;
  let model: string | undefined;
  try {
    const consensus = await judgeWithConsensus(
      {
        text: input.text,
        links,
        policy,
        context: input.context ?? [],
        chatTitle: input.chatTitle,
        ...(input.userId ? { userId: input.userId } : {}),
      },
      policy,
    );
    verdict = consensus.verdict;
    stage = consensus.stage;
    trace = consensus.trace;
    model = consensus.models.join(',');
  } catch (err) {
    logger.warn('[ai] moderation agent failed', { error: (err as Error)?.message ?? String(err) });
  }

  // Confidence gate: low confidence never enforces destructively.
  const minConf = modCfg.minConfidence ?? policy.minConfidence;
  let action = verdict.action;
  if (verdict.confidence < minConf && (action === 'delete' || action === 'ban' || action === 'mute')) {
    action = 'flag';
  }

  const outcome: ModerationOutcome = {
    action,
    category: verdict.category,
    confidence: verdict.confidence,
    reason: verdict.reason,
    stage,
    ...(trace ? { trace } : {}),
    ...(model ? { model } : {}),
  };

  if (modCfg.dryRun === true || policy.dryRun) {
    audit({ threadId: input.threadId, senderId: input.senderId, ...outcome, action: 'flag' });
    return { ...outcome, action: 'flag', reason: `${outcome.reason} (dry-run: logged only)` };
  }

  audit({ threadId: input.threadId, senderId: input.senderId, ...outcome });
  return outcome;
}

/** Maintenance-mode helper so AI features respect global bot state. */
export async function isAiAvailable(userId?: string): Promise<boolean> {
  if (!isAiEnabled(userId)) return false;
  try {
    if (await getMaintenanceModeEnabled()) return false;
  } catch {
    /* fail-open */
  }
  return true;
}

/** Max one automatic mention/DM reply per user per thread per window. */
export const MENTION_REPLY_COOLDOWN_MS = 60_000;

/**
 * Whether automatic replies are enabled for this owner + kind.
 * Defaults to true for both mentions and DMs; persisted per user.
 */
export async function isAutoReplyEnabled(
  ownerId: string | undefined,
  kind: 'mention' | 'dm',
): Promise<boolean> {
  try {
    if (ownerId) await ensureUserAiSnapshot(ownerId);
    const cfg = getPersistedAiConfig(ownerId).autoReply;
    if (kind === 'mention') return cfg?.mention ?? true;
    return cfg?.dm ?? true;
  } catch {
    return true;
  }
}

/**
 * Cooldown gate for automatic replies — at most one per user per thread per
 * window. Returns true when the reply may proceed (and records it).
 */
export function claimMentionReply(threadId: string, senderId: string): boolean {
  const key = `ai-mention:${threadId}:${senderId}`;
  const now = Date.now();
  cooldownStore.pruneIfNeeded(now);
  if (cooldownStore.check(key, now) !== null) return false;
  cooldownStore.record(key, now, MENTION_REPLY_COOLDOWN_MS);
  return true;
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * True when the text addresses one of the given bot identities: an
 * @-mention, a bare nickname word, or a platform mention map entry.
 * Pure and unit-testable — identity resolution lives in resolveBotNicknames.
 */
export function isMentioned(
  text: string,
  nicknames: string[],
  mentions?: Record<string, string>,
): boolean {
  const clean = text.trim();
  if (!clean) return false;
  const lower = clean.toLowerCase();

  const ids = new Set<string>();
  for (const raw of nicknames) {
    const nick = raw.trim().replace(/^@/, '').toLowerCase();
    if (nick) ids.add(nick);
  }
  if (ids.size === 0 && !mentions) return false;

  for (const id of ids) {
    if (lower.includes(`@${id}`)) return true;
    if (new RegExp(`(^|[^\\p{L}\\p{N}_])${escapeRegExp(id)}($|[^\\p{L}\\p{N}_])`, 'u').test(lower)) {
      return true;
    }
  }

  if (mentions) {
    for (const [mid, display] of Object.entries(mentions)) {
      const d = String(display ?? '').toLowerCase();
      for (const id of ids) {
        if (d === `@${id}` || d === id) return true;
      }
      if (ids.has(mid.toLowerCase())) return true;
    }
  }
  return false;
}

/**
 * Resolve the bot's addressable identities for mention detection: the
 * dashboard nickname, the platform username (Telegram @handle), and the
 * platform bot id for mention-map matching. Best-effort, never throws.
 */
export async function resolveBotNicknames(ctx: AppCtx): Promise<string[]> {
  const out = new Set<string>();
  const { userId, platform, sessionId } = ctx.native;
  if (userId && sessionId) {
    try {
      const nickname = await getBotNickname(userId, platform, sessionId);
      if (nickname?.trim()) out.add(nickname.trim());
    } catch {
      /* no nickname */
    }
  }
  try {
    const me = (ctx.native['ctx'] as { me?: { username?: string } } | undefined)?.me;
    if (me?.username?.trim()) out.add(me.username.trim());
  } catch {
    /* no platform identity */
  }
  try {
    const botId = await ctx.bot.getID?.();
    if (botId) out.add(String(botId));
  } catch {
    /* id lookup unavailable */
  }
  return [...out];
}
