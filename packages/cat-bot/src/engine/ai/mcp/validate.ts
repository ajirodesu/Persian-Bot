/**
 * Validation for user-supplied MCP/Skill definitions. Pure — shared by the
 * user and admin controllers and unit-tested in isolation.
 */

import type { McpConfig, SkillConfig } from '@/engine/repos/mcp-skills.repo.js';

export interface ValidatedIntegration {
  kind: 'mcp' | 'skill';
  name: string;
  config: McpConfig | SkillConfig;
}

export type ValidationResult =
  | { ok: true; value: ValidatedIntegration }
  | { ok: false; error: string };

const NAME_RE = /^[A-Za-z0-9][A-Za-z0-9 _.-]{0,63}$/;
const MAX_HEADERS = 10;
const MAX_HEADER_VALUE = 2048;
const MAX_INSTRUCTIONS = 4000;

function cleanUrl(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim().slice(0, 2048);
  if (!trimmed) return null;
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
    return trimmed;
  } catch {
    return null;
  }
}

function cleanHeaders(raw: unknown): Record<string, string> | undefined {
  if (raw === undefined || raw === null) return undefined;
  if (typeof raw !== 'object' || Array.isArray(raw)) return undefined;
  const entries = Object.entries(raw as Record<string, unknown>)
    .filter(([, v]) => typeof v === 'string' && (v as string).trim() !== '')
    .slice(0, MAX_HEADERS);
  if (entries.length === 0) return undefined;
  const out: Record<string, string> = {};
  for (const [k, v] of entries) {
    const key = k.trim().slice(0, 128);
    if (!key) continue;
    out[key] = String(v).slice(0, MAX_HEADER_VALUE);
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

function cleanTimeout(raw: unknown): number | undefined {
  if (raw === undefined || raw === null) return undefined;
  const n = typeof raw === 'number' ? raw : Number(String(raw));
  if (!Number.isFinite(n)) return undefined;
  return Math.min(60_000, Math.max(1_000, Math.trunc(n)));
}

function cleanParameters(raw: unknown): Record<string, unknown> | undefined {
  if (raw === undefined || raw === null) return undefined;
  if (typeof raw !== 'object' || Array.isArray(raw)) return undefined;
  try {
    JSON.stringify(raw);
  } catch {
    return undefined;
  }
  return raw as Record<string, unknown>;
}

export function validateIntegrationInput(raw: unknown): ValidationResult {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, error: 'Invalid integration definition.' };
  }
  const o = raw as Record<string, unknown>;

  if (o.kind !== 'mcp' && o.kind !== 'skill') {
    return { ok: false, error: 'kind must be "mcp" or "skill".' };
  }
  if (typeof o.name !== 'string' || !NAME_RE.test(o.name.trim())) {
    return {
      ok: false,
      error: 'name must be 1–64 characters: letters, numbers, spaces, _ . -',
    };
  }
  const name = o.name.trim();

  const cfg = o.config;
  if (!cfg || typeof cfg !== 'object' || Array.isArray(cfg)) {
    return { ok: false, error: 'config is required.' };
  }
  const c = cfg as Record<string, unknown>;
  const headers = cleanHeaders(c.headers);
  const timeoutMs = cleanTimeout(c.timeoutMs);

  if (o.kind === 'mcp') {
    const url = cleanUrl(c.url);
    if (!url) {
      return { ok: false, error: 'MCP servers need a valid http(s) URL.' };
    }
    const out: McpConfig = { url };
    if (headers) out.headers = headers;
    if (timeoutMs !== undefined) out.timeoutMs = timeoutMs;
    return { ok: true, value: { kind: 'mcp', name, config: out } };
  }

  const mode = c.mode === 'prompt' ? 'prompt' : 'tool';
  if (mode === 'prompt') {
    if (typeof c.instructions !== 'string' || !c.instructions.trim()) {
      return { ok: false, error: 'Prompt skills need instructions.' };
    }
    if (c.instructions.trim().length > MAX_INSTRUCTIONS) {
      return { ok: false, error: `Instructions must be under ${MAX_INSTRUCTIONS} characters.` };
    }
    const out: SkillConfig = { mode: 'prompt', instructions: c.instructions.trim() };
    return { ok: true, value: { kind: 'skill', name, config: out } };
  }

  const url = cleanUrl(c.url);
  if (!url) {
    return { ok: false, error: 'Tool skills need a valid webhook http(s) URL.' };
  }
  const out: SkillConfig = { mode: 'tool', url };
  if (headers) out.headers = headers;
  if (timeoutMs !== undefined) out.timeoutMs = timeoutMs;
  const parameters = cleanParameters(c.parameters);
  if (parameters) out.parameters = parameters;
  return { ok: true, value: { kind: 'skill', name, config: out } };
}
