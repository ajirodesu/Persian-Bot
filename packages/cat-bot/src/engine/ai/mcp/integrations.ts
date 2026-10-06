/**
 * Integration tools — converts a user's active MCP servers and Skills into
 * AI tools for the agent loop, plus prompt-pack skills into prompt sections.
 *
 * Enforcement layers (all must pass before a call executes):
 *   1. Entry status: only `active`, or `restricted` + admin-approved, is used.
 *   2. Tool minRole: the entry's floor (dangerous entries are SYSTEM_ADMIN).
 *   3. Runtime backstop: a listed tool that looks dangerous is admin-only
 *      even when its entry was approved as safe.
 *   4. Standard registry validation, timeouts, and error budgets.
 */

import {
  listIntegrationsForUser,
  type McpSkillRecord,
  type McpConfig,
  type SkillConfig,
} from '@/engine/repos/mcp-skills.repo.js';
import { listMcpTools, callMcpTool } from './client.js';
import { toolLooksDangerous } from './scan.js';
import { logger } from '@/engine/modules/logger/logger.lib.js';
import type { Tool } from '../tools.js';
import type { JSONSchema } from '../provider/types.js';

/** Max third-party tools injected into one turn (prompt-budget guard). */
export const MAX_INTEGRATION_TOOLS = 12;
/** Max prompt-skill text injected into one turn. */
export const MAX_SKILL_PROMPT_CHARS = 2000;

interface ListCacheEntry {
  at: number;
  records: McpSkillRecord[];
}

const listCache = new Map<string, ListCacheEntry>();
const LIST_TTL_MS = 30_000;

/** Test seam. */
export function clearIntegrationCache(): void {
  listCache.clear();
}

async function integrationsFor(userId: string): Promise<McpSkillRecord[]> {
  const hit = listCache.get(userId);
  if (hit && Date.now() - hit.at < LIST_TTL_MS) return hit.records;
  const records = await listIntegrationsForUser(userId).catch(() => []);
  listCache.set(userId, { at: Date.now(), records });
  return records;
}

function slug(value: string): string {
  return (
    value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '')
      .slice(0, 24) || 'x'
  );
}

/** An entry is usable by `role` when approved and privileged enough. */
export function isUsableBy(record: McpSkillRecord, role: number): boolean {
  if (record.status === 'disabled' || record.status === 'pending_review') return false;
  if (record.status === 'restricted' && !record.approvedBy) return false;
  return role >= record.minRole;
}

function toSchema(inputSchema: unknown): JSONSchema {
  if (inputSchema && typeof inputSchema === 'object' && !Array.isArray(inputSchema)) {
    const s = inputSchema as Record<string, unknown>;
    if (s.type === 'object' || s.properties) {
      const out: JSONSchema = { type: 'object' };
      if (s.properties && typeof s.properties === 'object') {
        const props = s.properties as JSONSchema['properties'];
        if (props) out.properties = props;
      }
      if (Array.isArray(s.required)) {
        out.required = s.required.filter((r): r is string => typeof r === 'string');
      }
      return out;
    }
  }
  return { type: 'object', properties: {} };
}

export interface IntegrationToolBundle {
  tools: Tool[];
  /** Prompt-pack skill text (already budgeted), or null. */
  skillPrompt: string | null;
}

export async function getIntegrationTools(
  userId: string | undefined,
  role: number,
): Promise<IntegrationToolBundle> {
  const bundle: IntegrationToolBundle = { tools: [], skillPrompt: null };
  if (!userId) return bundle;

  let records: McpSkillRecord[];
  try {
    records = await integrationsFor(userId);
  } catch {
    return bundle;
  }

  const skillTexts: string[] = [];

  for (const record of records) {
    if (bundle.tools.length >= MAX_INTEGRATION_TOOLS) break;
    if (!isUsableBy(record, role)) continue;

    if (record.kind === 'mcp') {
      const cfg = record.config as McpConfig;
      if (!cfg.url) continue;
      let defs: Awaited<ReturnType<typeof listMcpTools>>;
      try {
        defs = await Promise.race([
          listMcpTools(cfg.url, cfg.headers ?? {}, Math.min(cfg.timeoutMs ?? 20_000, 15_000)),
          new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error('integration tool listing timed out')), 12_000),
          ),
        ]);
      } catch (err) {
        logger.warn(`[ai-mcp] tools/list failed for "${record.name}"`, {
          error: (err as Error)?.message ?? String(err),
        });
        continue;
      }

      for (const def of defs) {
        if (bundle.tools.length >= MAX_INTEGRATION_TOOLS) break;
        const backstop = toolLooksDangerous(def.name, def.description);
        bundle.tools.push({
          name: `mcp__${slug(record.name)}__${slug(def.name)}`.slice(0, 64),
          description: `[${record.name}] ${def.description ?? def.name}`.slice(0, 500),
          parameters: toSchema(def.inputSchema),
          risk: backstop ? 2 : record.risk,
          minRole: backstop ? Math.max(record.minRole, 4) : record.minRole,
          timeoutMs: Math.min(cfg.timeoutMs ?? 20_000, 30_000),
          handler: async (args, ctx) => {
            if (backstop && ctx.role < 4) {
              return { ok: false, content: 'Not permitted: this MCP tool requires a system admin.' };
            }
            const res = await callMcpTool(
              cfg.url,
              cfg.headers ?? {},
              def.name,
              args,
              Math.min(cfg.timeoutMs ?? 20_000, 30_000),
            );
            return res;
          },
        });
      }
    } else {
      const cfg = record.config as SkillConfig;
      if (cfg.mode === 'prompt') {
        if (cfg.instructions?.trim()) skillTexts.push(cfg.instructions.trim().slice(0, 1500));
        continue;
      }
      if (!cfg.url) continue;
      bundle.tools.push({
        name: `skill__${slug(record.name)}`.slice(0, 64),
        description: `[skill:${record.name}] Custom user tool.`,
        parameters: toSchema(cfg.parameters),
        risk: record.risk,
        minRole: record.minRole,
        timeoutMs: Math.min(cfg.timeoutMs ?? 20_000, 30_000),
        handler: async (args) => callSkillWebhook(record.name, cfg, args),
      });
    }
  }

  if (skillTexts.length > 0) {
    bundle.skillPrompt = skillTexts
      .join('\n\n')
      .slice(0, MAX_SKILL_PROMPT_CHARS);
  }
  return bundle;
}

import { MAX_TURN_ATTACHMENTS } from '../tools.js';

/** Parse skill-webhook file references (http(s) URLs only, capped). */
function parseAttachmentRefs(raw: unknown): { name: string; url: string }[] {
  if (!Array.isArray(raw)) return [];
  const out: { name: string; url: string }[] = [];
  for (const item of raw.slice(0, MAX_TURN_ATTACHMENTS)) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) continue;
    const url = (item as Record<string, unknown>).url;
    if (typeof url !== 'string' || !/^https?:\/\//i.test(url.trim())) continue;
    const rawName = (item as Record<string, unknown>).name;
    out.push({
      name: (typeof rawName === 'string' && rawName.trim() ? rawName.trim() : 'file').slice(0, 120),
      url: url.trim().slice(0, 2048),
    });
  }
  return out;
}

async function callSkillWebhook(
  name: string,
  cfg: SkillConfig,
  args: Record<string, unknown>,
): Promise<{ ok: boolean; content: string; data?: unknown; attachments?: { name: string; url: string }[] }> {
  const timeoutMs = Math.min(cfg.timeoutMs ?? 20_000, 30_000);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(cfg.url as string, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(cfg.headers ?? {}) },
      body: JSON.stringify(args),
      signal: controller.signal,
    });
    const text = await res.text().catch(() => '');
    if (!res.ok) {
      return { ok: false, content: `Skill "${name}" failed (${res.status}): ${text.slice(0, 300)}` };
    }
    let parsed: unknown = null;
    try {
      parsed = JSON.parse(text) as unknown;
    } catch {
      parsed = null;
    }
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      const o = parsed as Record<string, unknown>;
      const content =
        (typeof o.content === 'string' && o.content) ||
        (typeof o.text === 'string' && o.text) ||
        (typeof o.result === 'string' && o.result) ||
        (typeof o.message === 'string' && o.message) ||
        null;
      if (o.ok === false) {
        return { ok: false, content: `Skill "${name}" reported an error: ${(content ?? text).slice(0, 500)}` };
      }
      const attachments = parseAttachmentRefs(o.attachments);
      if (content) {
        return {
          ok: true,
          content: content.slice(0, 4000),
          data: o,
          ...(attachments.length > 0 ? { attachments } : {}),
        };
      }
      if (attachments.length > 0) {
        return {
          ok: true,
          content: `Skill "${name}" attached ${attachments.length} file(s).`,
          data: o,
          attachments,
        };
      }
    }
    if (text.trim()) return { ok: true, content: text.slice(0, 4000) };
    return { ok: true, content: `Skill "${name}" completed with no output.` };
  } catch (err) {
    const typed = err as Error & { name?: string };
    if (typed?.name === 'AbortError') {
      return { ok: false, content: `Skill "${name}" timed out after ${timeoutMs}ms.` };
    }
    return { ok: false, content: `Skill "${name}" failed: ${(err as Error)?.message ?? String(err)}` };
  } finally {
    clearTimeout(timer);
  }
}

export interface ProbeResult {
  ok: boolean;
  detail: string;
  tools?: string[];
  latencyMs: number;
}

/**
 * Connectivity probe for one integration (dashboard "Test" button + rescan).
 * For MCP servers it also re-scans the advertised tool surface.
 */
export async function probeIntegration(
  record: McpSkillRecord,
): Promise<ProbeResult & { freshScan?: { dangerous: string[] } }> {
  const started = Date.now();
  if (record.kind === 'mcp') {
    const cfg = record.config as McpConfig;
    if (!cfg.url) {
      return { ok: false, detail: 'No URL configured.', latencyMs: Date.now() - started };
    }
    try {
      const defs = await listMcpTools(cfg.url, cfg.headers ?? {}, Math.min(cfg.timeoutMs ?? 20_000, 15_000));
      const dangerous = defs.filter((d) => toolLooksDangerous(d.name, d.description)).map((d) => d.name);
      return {
        ok: true,
        detail: `Connected — ${defs.length} tool(s) advertised.`,
        tools: defs.map((d) => d.name),
        latencyMs: Date.now() - started,
        freshScan: { dangerous },
      };
    } catch (err) {
      return {
        ok: false,
        detail: `Connection failed: ${(err as Error)?.message ?? String(err)}`,
        latencyMs: Date.now() - started,
      };
    }
  }

  const cfg = record.config as SkillConfig;
  if (cfg.mode === 'prompt') {
    return {
      ok: true,
      detail: `Prompt skill ready (${(cfg.instructions ?? '').length} chars of instructions).`,
      latencyMs: Date.now() - started,
    };
  }
  if (!cfg.url) {
    return { ok: false, detail: 'No webhook URL configured.', latencyMs: Date.now() - started };
  }
  const res = await callSkillWebhook(record.name || 'skill', cfg, {});
  return {
    ok: res.ok,
    detail: res.ok ? `Webhook answered: ${res.content.slice(0, 200)}` : res.content,
    latencyMs: Date.now() - started,
  };
}
