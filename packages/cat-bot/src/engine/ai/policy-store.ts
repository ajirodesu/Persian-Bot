/**
 * Moderation policy store — per-thread chat policies persisted through
 * Persian-Bot's database collections (db.bot / db.threads), with an in-memory
 * cache in front. Unknown/invalid values can never be persisted: only
 * recognised fields survive coercePolicyPatch().
 */

import { DEFAULT_POLICY } from './agent-types.js';
import type { ChatPolicy } from './agent-types.js';
import type { PolicyPatch } from './policy.js';
import { logger } from '@/engine/modules/logger/logger.lib.js';

export interface PolicyStoreHandles {
  loadThreadPolicy(threadId: string): Promise<Partial<ChatPolicy> | null>;
  saveThreadPolicy(threadId: string, policy: ChatPolicy): Promise<void>;
}

const cache = new Map<string, ChatPolicy>();

/** Test seam. */
export function clearPolicyCache(): void {
  cache.clear();
}

export function defaultPolicyFor(threadId: string): ChatPolicy {
  return {
    ...DEFAULT_POLICY,
    threadId,
    links: { ...DEFAULT_POLICY.links, enforcement: { ...DEFAULT_POLICY.links.enforcement } },
    whitelist: [],
    notes: [],
  };
}

export async function getPolicy(
  threadId: string,
  handles?: PolicyStoreHandles,
): Promise<ChatPolicy> {
  const cached = cache.get(threadId);
  if (cached) return cached;

  let policy = defaultPolicyFor(threadId);
  if (handles) {
    try {
      const stored = await handles.loadThreadPolicy(threadId);
      if (stored && typeof stored === 'object') {
        policy = { ...policy, ...stored, threadId };
      }
    } catch (err) {
      logger.warn(`[ai-policy] load failed for ${threadId} (${(err as Error)?.message?.slice(0, 100)})`);
    }
  }
  cache.set(threadId, policy);
  return policy;
}

/** Merge a validated patch over the current policy. Never touches dryRun via patch. */
export function applyPatch(current: ChatPolicy, patch: PolicyPatch): ChatPolicy {
  const next: ChatPolicy = {
    ...current,
    links: {
      ...current.links,
      enforcement: { ...current.links.enforcement },
    },
    whitelist: [...current.whitelist],
    notes: [...current.notes],
  };

  if (patch.enabled !== undefined) next.enabled = patch.enabled;
  if (patch.minConfidence !== undefined) next.minConfidence = patch.minConfidence;
  if (patch.links) {
    if (patch.links.mode !== undefined) next.links.mode = patch.links.mode;
    if (patch.links.exempt !== undefined) next.links.exempt = [...patch.links.exempt];
    if (patch.links.allowDomains !== undefined) next.links.allowDomains = [...patch.links.allowDomains];
    if (patch.links.denyDomains !== undefined) next.links.denyDomains = [...patch.links.denyDomains];
    if (patch.links.denyCategories !== undefined) next.links.denyCategories = [...patch.links.denyCategories];
    if (patch.links.allowIfRelatedToContext !== undefined) {
      next.links.allowIfRelatedToContext = patch.links.allowIfRelatedToContext;
    }
    if (patch.links.enforcement !== undefined) {
      next.links.enforcement = { ...patch.links.enforcement };
    }
  }
  if (patch.note) {
    next.notes = [...next.notes.slice(-19), patch.note];
  }
  next.updatedAt = Date.now();
  return next;
}

export async function savePolicy(
  policy: ChatPolicy,
  handles?: PolicyStoreHandles,
  updatedBy?: string,
): Promise<ChatPolicy> {
  const next: ChatPolicy = {
    ...policy,
    updatedBy: updatedBy ?? policy.updatedBy,
    updatedAt: Date.now(),
  };
  cache.set(next.threadId, next);
  if (handles) {
    try {
      await handles.saveThreadPolicy(next.threadId, next);
    } catch (err) {
      logger.warn(`[ai-policy] save failed for ${next.threadId} (${(err as Error)?.message?.slice(0, 100)})`);
    }
  }
  return next;
}

// ── Moderation audit trail (in-memory ring; persisted best-effort by callers) ──

export interface ModAuditEntry {
  id: number;
  threadId: string;
  senderId: string;
  action: string;
  category: string;
  confidence: number;
  reason: string;
  model?: string;
  at: number;
}

const audit: ModAuditEntry[] = [];
let auditSeq = 0;

export function recordModeration(entry: Omit<ModAuditEntry, 'id' | 'at'>): ModAuditEntry {
  const full: ModAuditEntry = { ...entry, id: ++auditSeq, at: Date.now() };
  audit.push(full);
  if (audit.length > 200) audit.splice(0, audit.length - 200);
  return full;
}

export function recentModerations(limit = 50): ModAuditEntry[] {
  return audit.slice(-limit).reverse();
}

/** Test seam. */
export function clearAudit(): void {
  audit.length = 0;
  auditSeq = 0;
}
