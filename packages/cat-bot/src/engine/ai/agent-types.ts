/**
 * Shared AI agent types — moderation verdicts, chat policies, agent configs.
 *
 * Portions derived from Reze-Bot (MIT):
 *   https://github.com/GrandpaEJx/Reze-Bot
 * See THIRD_PARTY_NOTICES.md. Adapted to Persian-Bot conventions.
 */

import type { ProviderName, ChatMessage } from './provider/types.js';

// ── Moderation verdict ───────────────────────────────────────────────────────

export const MOD_ACTIONS = ['allow', 'delete', 'warn', 'mute', 'ban', 'flag'] as const;
export type ModAction = (typeof MOD_ACTIONS)[number];

export const MOD_CATEGORIES = [
  'legit',
  'related',
  'promo',
  'referral',
  'scam',
  'phishing',
  'nsfw',
  'flood',
  'offtopic',
  'unknown',
] as const;
export type ModCategory = (typeof MOD_CATEGORIES)[number];

export interface Verdict {
  action: ModAction;
  category: ModCategory;
  /** 0..1 — enforcement is gated on this (see ChatPolicy.minConfidence). */
  confidence: number;
  reason: string;
}

export function isModAction(v: unknown): v is ModAction {
  return typeof v === 'string' && (MOD_ACTIONS as readonly string[]).includes(v);
}

export function isModCategory(v: unknown): v is ModCategory {
  return typeof v === 'string' && (MOD_CATEGORIES as readonly string[]).includes(v);
}

/**
 * Coerce model output into a Verdict.
 *
 * A moderation agent's output drives message deletion, so anything that does
 * not validate degrades to allow/unknown at zero confidence, which the
 * enforcement gate then refuses to act on.
 */
export function coerceVerdict(raw: unknown): Verdict {
  const safe: Verdict = {
    action: 'allow',
    category: 'unknown',
    confidence: 0,
    reason: 'unparseable agent response',
  };
  if (!raw || typeof raw !== 'object') return safe;

  const o = raw as Record<string, unknown>;
  const norm = (v: unknown): unknown =>
    typeof v === 'string' ? v.trim().toLowerCase() : v;
  const rawAction = norm(o.action);
  const rawCategory = norm(o.category);

  const action = isModAction(rawAction) ? rawAction : 'allow';
  const category = isModCategory(rawCategory) ? rawCategory : 'unknown';

  let confidence =
    typeof o.confidence === 'number' ? o.confidence : Number(o.confidence);
  if (!Number.isFinite(confidence)) confidence = 0;
  confidence = Math.min(1, Math.max(0, confidence));

  const reason =
    typeof o.reason === 'string' && o.reason.trim()
      ? o.reason.trim().slice(0, 300)
      : 'no reason given';

  return { action, category, confidence, reason };
}

// ── Chat policy (compiled from natural-language owner orders) ───────────────

export const LINK_MODES = ['off', 'strict', 'ai'] as const;
export type LinkMode = (typeof LINK_MODES)[number];

export const EXEMPT_GROUPS = ['admins', 'premium', 'whitelist'] as const;
export type ExemptGroup = (typeof EXEMPT_GROUPS)[number];

export interface Enforcement {
  delete: boolean;
  warn: boolean;
  /** null = never mute; otherwise restrict for this many seconds. */
  muteSeconds: number | null;
}

export interface LinkPolicy {
  /** off = ignore links | strict = rule engine only | ai = escalate ambiguous to moderator */
  mode: LinkMode;
  /** Groups never checked. */
  exempt: ExemptGroup[];
  /** Always allowed — substring match on the URL. */
  allowDomains: string[];
  /** Always deleted. */
  denyDomains: string[];
  /** Which agent categories are actionable. */
  denyCategories: ModCategory[];
  /** Keep links the agent judges on-topic for recent admin/pinned context. */
  allowIfRelatedToContext: boolean;
  enforcement: Enforcement;
}

export interface ChatPolicy {
  /** Thread/server identifier this policy applies to. */
  threadId: string;
  /** Master switch. */
  enabled: boolean;
  /** Log the verdict, take no action — the safe default. */
  dryRun: boolean;
  /** Below this the bot flags for review instead of enforcing. */
  minConfidence: number;
  /** Ask a second model when the first lands just below the bar. */
  secondOpinion: boolean;
  links: LinkPolicy;
  /** User IDs exempt from every check. */
  whitelist: string[];
  /** Owner orders in their own words — kept for prompt context. */
  notes: string[];
  updatedBy: string | null;
  updatedAt: number;
}

export const DEFAULT_POLICY: Omit<ChatPolicy, 'threadId'> = {
  enabled: false,
  dryRun: true,
  minConfidence: 0.75,
  secondOpinion: false,
  links: {
    mode: 'ai',
    exempt: ['admins', 'whitelist'],
    allowDomains: [],
    denyDomains: [],
    denyCategories: ['promo', 'referral', 'scam', 'phishing'],
    allowIfRelatedToContext: true,
    enforcement: { delete: true, warn: true, muteSeconds: null },
  },
  whitelist: [],
  notes: [],
  updatedBy: null,
  updatedAt: 0,
};

// ── Agent configuration ─────────────────────────────────────────────────────

/** One concrete provider + model pair to try. */
export interface ModelRef {
  provider: ProviderName;
  model: string;
  /** Only for self-hosted / custom endpoints. */
  baseUrl?: string;
}

export interface AgentConfig {
  /** Omit to inherit from the `default` agent. */
  provider?: ProviderName;
  /** Single model — or use `models` to rotate within the provider on 429. */
  model?: string;
  models?: string[];
  temperature?: number;
  maxTokens?: number;
  /** Request response_format:json_object and parse/validate the reply. */
  json?: boolean;
  timeout?: number;
  /** Tried in order after every model of the primary provider has failed. */
  fallback?: ModelRef[];
}

export interface AgentRequest {
  system: string;
  user: string | ChatMessage[];
  /** Per-call overrides on top of the agent's config. */
  overrides?: Partial<AgentConfig>;
  /** Dashboard owner id — selects their DB-backed provider snapshot. */
  userId?: string | undefined;
}

export interface AgentResult<T> {
  data: T;
  raw: string;
  provider: string;
  model: string;
  /** How many provider/model attempts were used. */
  attempts: number;
}
