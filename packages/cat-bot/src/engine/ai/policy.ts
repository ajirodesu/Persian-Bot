/**
 * Policy agent — translates an owner's natural-language moderation order
 * into a validated structured policy patch.
 *
 * The model NEVER overwrites the policy directly: coercePolicyPatch() accepts
 * only recognised fields with valid values and drops everything else. dryRun
 * and whitelist can only change through explicit human actions.
 *
 * Portions derived from Reze-Bot (MIT):
 *   https://github.com/GrandpaEJx/Reze-Bot
 * See THIRD_PARTY_NOTICES.md. Adapted to Persian-Bot conventions.
 */

import { askAgentJSON } from './runner.js';
import { LINK_MODES, EXEMPT_GROUPS, MOD_CATEGORIES, isModCategory } from './agent-types.js';
import type { ChatPolicy, LinkMode, ExemptGroup, ModCategory } from './agent-types.js';

export interface PolicyPatch {
  enabled?: boolean;
  minConfidence?: number;
  links?: Partial<ChatPolicy['links']>;
  /** The order restated in one English line, stored in policy.notes. */
  note?: string;
  /** What the agent thinks it changed, shown to the owner. */
  summary?: string;
}

const SYSTEM = [
  "You translate a group owner's moderation instruction into a JSON policy patch.",
  'The instruction may be in any language.',
  '',
  '## Output schema — every field optional, omit what the instruction does not mention',
  '{',
  '  "enabled": boolean,',
  '  "minConfidence": number between 0 and 1,',
  '  "links": {',
  `    "mode": ${LINK_MODES.map((m) => `"${m}"`).join(' | ')},`,
  `    "exempt": array of ${EXEMPT_GROUPS.map((e) => `"${e}"`).join(' | ')},`,
  '    "allowDomains": array of strings,',
  '    "denyDomains": array of strings,',
  `    "denyCategories": array of ${MOD_CATEGORIES.map((c) => `"${c}"`).join(' | ')},`,
  '    "allowIfRelatedToContext": boolean,',
  '    "enforcement": { "delete": boolean, "warn": boolean, "muteSeconds": number or null }',
  '  },',
  '  "note": "the instruction restated in one clear English sentence",',
  '  "summary": "one sentence telling the owner what you changed"',
  '}',
  '',
  '## Rules',
  '1. Change only what the instruction actually asks for. Omitted fields keep their current value.',
  '2. "delete promotional links" -> denyCategories includes "promo" (and "referral" if resale/affiliate is implied).',
  '3. "but not if it relates to an admin post / the current topic" -> allowIfRelatedToContext: true.',
  '4. "allow X" with a domain -> allowDomains. "block X" -> denyDomains.',
  '5. "only allow my channel, nothing else" -> mode "strict" plus that domain in allowDomains.',
  '6. "stop moderating" -> enabled: false.',
  '7. Arrays REPLACE the current value. To add to a list, return the current list plus the new entries.',
  '8. Never invent a domain the owner did not mention.',
  '9. You cannot change dry-run mode or the user whitelist. If asked, say so in "summary" and change nothing else.',
].join('\n');

function currentStateBlock(policy: ChatPolicy): string {
  const l = policy.links;
  return [
    '## Current policy',
    `enabled: ${policy.enabled}`,
    `minConfidence: ${policy.minConfidence}`,
    `links.mode: ${l.mode}`,
    `links.exempt: ${JSON.stringify(l.exempt)}`,
    `links.allowDomains: ${JSON.stringify(l.allowDomains)}`,
    `links.denyDomains: ${JSON.stringify(l.denyDomains)}`,
    `links.denyCategories: ${JSON.stringify(l.denyCategories)}`,
    `links.allowIfRelatedToContext: ${l.allowIfRelatedToContext}`,
    `links.enforcement: ${JSON.stringify(l.enforcement)}`,
    policy.notes.length > 0 ? `\nExisting owner rules:\n${policy.notes.map((n) => `- ${n}`).join('\n')}` : '',
  ]
    .filter(Boolean)
    .join('\n');
}

function asBool(v: unknown): boolean | undefined {
  if (typeof v === 'boolean') return v;
  if (v === 'true') return true;
  if (v === 'false') return false;
  return undefined;
}

function asStringArray(v: unknown, max = 50): string[] | undefined {
  if (!Array.isArray(v)) return undefined;
  return v
    .filter((x): x is string => typeof x === 'string')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean)
    .slice(0, max);
}

/** Accept only recognised fields/values; drop everything else. */
export function coercePolicyPatch(raw: unknown): PolicyPatch {
  const patch: PolicyPatch = {};
  if (!raw || typeof raw !== 'object') return patch;
  const o = raw as Record<string, unknown>;

  const enabled = asBool(o.enabled);
  if (enabled !== undefined) patch.enabled = enabled;

  const conf = Number(o.minConfidence);
  if (Number.isFinite(conf) && conf >= 0 && conf <= 1) patch.minConfidence = conf;

  if (o.links && typeof o.links === 'object') {
    const l = o.links as Record<string, unknown>;
    const links: Partial<ChatPolicy['links']> = {};

    if (typeof l.mode === 'string' && (LINK_MODES as readonly string[]).includes(l.mode)) {
      links.mode = l.mode as LinkMode;
    }

    const exempt = asStringArray(l.exempt);
    if (exempt) {
      links.exempt = exempt.filter((e): e is ExemptGroup =>
        (EXEMPT_GROUPS as readonly string[]).includes(e),
      );
    }

    const allow = asStringArray(l.allowDomains);
    if (allow) links.allowDomains = allow;

    const deny = asStringArray(l.denyDomains);
    if (deny) links.denyDomains = deny;

    const cats = asStringArray(l.denyCategories);
    if (cats) links.denyCategories = cats.filter((c): c is ModCategory => isModCategory(c));

    const related = asBool(l.allowIfRelatedToContext);
    if (related !== undefined) links.allowIfRelatedToContext = related;

    if (l.enforcement && typeof l.enforcement === 'object') {
      const e = l.enforcement as Record<string, unknown>;
      const del = asBool(e.delete);
      const warn = asBool(e.warn);
      const mute = e.muteSeconds === null ? null : Number(e.muteSeconds);
      links.enforcement = {
        delete: del ?? true,
        warn: warn ?? true,
        muteSeconds:
          mute === null || !Number.isFinite(mute) || mute <= 0
            ? null
            : Math.min(Math.floor(mute), 7 * 86400),
      };
    }

    if (Object.keys(links).length > 0) patch.links = links;
  }

  if (typeof o.note === 'string' && o.note.trim()) patch.note = o.note.trim().slice(0, 300);
  if (typeof o.summary === 'string' && o.summary.trim()) {
    patch.summary = o.summary.trim().slice(0, 300);
  }

  return patch;
}

/** Human-readable list of what the patch would actually change. */
export function diffPatch(current: ChatPolicy, patch: PolicyPatch): string[] {
  const changes: string[] = [];
  const fmt = (v: unknown): string =>
    Array.isArray(v) ? (v.length > 0 ? v.join(', ') : '(none)') : String(v);

  if (patch.enabled !== undefined && patch.enabled !== current.enabled) {
    changes.push(`enabled: ${current.enabled} → ${patch.enabled}`);
  }
  if (patch.minConfidence !== undefined && patch.minConfidence !== current.minConfidence) {
    changes.push(`confidence bar: ${current.minConfidence} → ${patch.minConfidence}`);
  }

  const l = patch.links;
  if (l) {
    const c = current.links;
    if (l.mode !== undefined && l.mode !== c.mode) changes.push(`link mode: ${c.mode} → ${l.mode}`);
    if (
      l.allowIfRelatedToContext !== undefined &&
      l.allowIfRelatedToContext !== c.allowIfRelatedToContext
    ) {
      changes.push(
        `allow if related to admin context: ${c.allowIfRelatedToContext} → ${l.allowIfRelatedToContext}`,
      );
    }
    for (const key of ['exempt', 'allowDomains', 'denyDomains', 'denyCategories'] as const) {
      const next = l[key];
      if (next === undefined) continue;
      if (JSON.stringify(next) !== JSON.stringify(c[key])) {
        changes.push(`${key}: ${fmt(c[key])} → ${fmt(next)}`);
      }
    }
    if (l.enforcement && JSON.stringify(l.enforcement) !== JSON.stringify(c.enforcement)) {
      changes.push(`enforcement: ${JSON.stringify(c.enforcement)} → ${JSON.stringify(l.enforcement)}`);
    }
  }

  return changes;
}

export async function compileOrder(
  order: string,
  policy: ChatPolicy,
  userId?: string,
): Promise<{ patch: PolicyPatch; changes: string[]; error?: string; model?: string }> {
  try {
    const res = await askAgentJSON('policy', {
      system: SYSTEM,
      user: `${currentStateBlock(policy)}\n\n## Owner instruction\n"""\n${order.slice(0, 1000)}\n"""`,
      ...(userId ? { userId } : {}),
    }, coercePolicyPatch);

    return {
      patch: res.data,
      changes: diffPatch(policy, res.data),
      model: `${res.provider}/${res.model}`,
    };
  } catch (err) {
    return { patch: {}, changes: [], error: (err as Error)?.message ?? String(err) };
  }
}

export const __test = { SYSTEM, currentStateBlock };
