/**
 * AI Tool registry — typed tools with schema validation, role gating and
 * timeouts. Tool results return as observations the agent loop feeds back
 * into the model (think → act → observe → repeat).
 *
 * Portions derived from Reze-Bot (MIT):
 *   https://github.com/GrandpaEJx/Reze-Bot
 * See THIRD_PARTY_NOTICES.md. Adapted to Persian-Bot conventions
 * (Role levels, AppCtx-backed context, Fluxer-native tools).
 */

import type { JSONSchema, ToolDefinition } from './provider/types.js';
import type { AppCtx } from '@/engine/types/controller.types.js';

export interface ToolContext {
  /** Current thread/channel identifier. */
  threadId: string;
  /** Platform sender ID of the invoking user. */
  senderId: string;
  /** Persian-Bot Role level (0 ANYONE … 4 SYSTEM_ADMIN). */
  role: number;
  /** True in groups/servers, false in DMs. */
  isGroup: boolean;
  platform: string;
  /** Bot session identity for scoping. */
  userId?: string;
  sessionId?: string;
  /** Display/context hints the model may use. */
  chatTitle?: string | null;
  userName?: string | null;
  /** Runs a Persian-Bot command string in this chat; injected by the caller. */
  runCommand?: (commandString: string) => Promise<boolean>;
  /**
   * The live handler context for tools that must dispatch real work.
   * Preferred over runCommand for command execution (silent preview model).
   */
  appCtx?: AppCtx | undefined;
  /** Extra platform context for Fluxer/Discord/Telegram inspection tools. */
  extra?: Record<string, unknown>;
  signal?: AbortSignal;
  /** Marks AI-initiated execution so commands can refuse recursion. */
  aiInitiated?: boolean;
}

export interface ToolResult {
  ok: boolean;
  /** What the model sees — keep it short, it is re-sent on every later step. */
  content: string;
  /** Not shown to the model; for internal callers. */
  data?: unknown;
  /**
   * Files the caller should deliver to the chat (e.g. images a skill
   * produced). URLs only, http(s) — validated at send time, capped per turn.
   */
  attachments?: ToolAttachment[] | undefined;
}

/** A file reference a tool wants delivered to the chat. */
export interface ToolAttachment {
  name: string;
  url: string;
}

/** Max files delivered to the chat from one agent turn. */
export const MAX_TURN_ATTACHMENTS = 3;

export interface Tool {
  name: string;
  description: string;
  parameters: JSONSchema;
  /** 0 read-only · 1 visible side effect · 2 destructive. */
  risk?: 0 | 1 | 2;
  /** Minimum Persian-Bot Role level. */
  minRole?: number;
  timeoutMs?: number;
  handler: (args: Record<string, unknown>, ctx: ToolContext) => Promise<ToolResult>;
}

export interface ValidationResult {
  ok: boolean;
  value: Record<string, unknown>;
  errors: string[];
}

/**
 * Validate + coerce arguments against the tool schema.
 * Forgiving where models are reliably sloppy ("3" for a number, "true" for a
 * boolean, a bare value for a single-element array); strict otherwise.
 * Unknown properties are dropped.
 */
export function validateArgs(schema: JSONSchema, raw: unknown): ValidationResult {
  const errors: string[] = [];
  const out: Record<string, unknown> = {};

  if (schema.type !== 'object' || !schema.properties) {
    return {
      ok: true,
      value: (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>,
      errors,
    };
  }

  const input =
    raw && typeof raw === 'object' && !Array.isArray(raw)
      ? (raw as Record<string, unknown>)
      : {};

  for (const [key, prop] of Object.entries(schema.properties)) {
    const present =
      key in input && input[key] !== null && input[key] !== undefined && input[key] !== '';

    if (!present) {
      if (prop.default !== undefined) out[key] = prop.default;
      else if (schema.required?.includes(key)) errors.push(`missing required argument "${key}"`);
      continue;
    }

    const coerced = coerce(input[key], prop, key, errors);
    if (coerced !== undefined) out[key] = coerced;
  }

  return { ok: errors.length === 0, value: out, errors };
}

function coerce(v: unknown, prop: JSONSchema, key: string, errors: string[]): unknown {
  switch (prop.type) {
    case 'string': {
      const s = typeof v === 'string' ? v : String(v);
      if (prop.enum && !prop.enum.includes(s)) {
        errors.push(`"${key}" must be one of: ${prop.enum.join(', ')}`);
        return undefined;
      }
      return s;
    }
    case 'number':
    case 'integer': {
      const n = typeof v === 'number' ? v : Number(String(v).trim());
      if (!Number.isFinite(n)) {
        errors.push(`"${key}" must be a number`);
        return undefined;
      }
      const final = prop.type === 'integer' ? Math.trunc(n) : n;
      if (prop.minimum !== undefined && final < prop.minimum) {
        errors.push(`"${key}" must be >= ${prop.minimum}`);
        return undefined;
      }
      if (prop.maximum !== undefined && final > prop.maximum) {
        errors.push(`"${key}" must be <= ${prop.maximum}`);
        return undefined;
      }
      return final;
    }
    case 'boolean': {
      if (typeof v === 'boolean') return v;
      const s = String(v).toLowerCase();
      if (['true', 'yes', '1'].includes(s)) return true;
      if (['false', 'no', '0'].includes(s)) return false;
      errors.push(`"${key}" must be true or false`);
      return undefined;
    }
    case 'array': {
      const arr = Array.isArray(v) ? v : [v];
      if (!prop.items) return arr;
      return arr
        .map((item) => coerce(item, prop.items as JSONSchema, key, errors))
        .filter((x) => x !== undefined);
    }
    default:
      return v;
  }
}

// ── Registry ─────────────────────────────────────────────────────────────────

const registry = new Map<string, Tool>();

export function registerTool(tool: Tool): void {
  registry.set(tool.name, tool);
}

export function getTool(name: string): Tool | undefined {
  return registry.get(name);
}

export function listTools(opts: { role?: number; names?: string[] } = {}): Tool[] {
  const all = [...registry.values()];
  const byName = opts.names ? all.filter((t) => opts.names!.includes(t.name)) : all;
  if (opts.role === undefined) return byName;
  return byName.filter((t) => (t.minRole ?? 0) <= opts.role!);
}

export function toolDefinitions(tools: Tool[]): ToolDefinition[] {
  return tools.map((t) => ({
    type: 'function' as const,
    function: { name: t.name, description: t.description, parameters: t.parameters },
  }));
}

/**
 * Run one tool call. Never throws: bad arguments, missing tools, timeouts
 * and handler failures all come back as `ok:false` observations the model
 * can read and correct from.
 *
 * `extra` carries turn-scoped tools (e.g. a user's MCP/Skill tools built for
 * this turn only). They resolve first so per-user handlers never leak into
 * the global registry — and never leak across users sharing this process.
 */
export async function executeTool(
  name: string,
  rawArgs: unknown,
  ctx: ToolContext,
  extra?: Tool[],
): Promise<ToolResult> {
  const tool = (extra?.length ? resolveToolIn(extra, name) : undefined) ?? resolveTool(name);
  if (!tool) {
    const known = [...(extra ?? []).map((t) => t.name), ...registry.keys()].join(', ');
    return {
      ok: false,
      content: `No tool named "${name}". Available tools: ${known}. Use one of those, or answer the user directly.`,
    };
  }

  if ((tool.minRole ?? 0) > ctx.role) {
    return {
      ok: false,
      content: `Not permitted: "${name}" requires a higher role than this user has.`,
    };
  }

  const { ok, value, errors } = validateArgs(tool.parameters, rawArgs);
  if (!ok) {
    return { ok: false, content: `Invalid arguments for "${name}": ${errors.join('; ')}` };
  }

  const timeoutMs = tool.timeoutMs ?? 20_000;
  try {
    return await Promise.race([
      tool.handler(value, ctx),
      new Promise<ToolResult>((_, reject) =>
        setTimeout(() => reject(new Error(`timed out after ${timeoutMs}ms`)), timeoutMs),
      ),
    ]);
  } catch (err) {
    return {
      ok: false,
      content: `Tool "${name}" failed: ${(err as Error)?.message ?? String(err)}`,
    };
  }
}

/** Resolve against an explicit turn-scoped tool list (no global lookup). */
export function resolveToolIn(tools: Tool[], name: string): Tool | undefined {
  if (!name) return undefined;
  const exact = tools.find((t) => t.name === name);
  if (exact) return exact;

  const target = normalise(name);
  if (!target) return undefined;
  return tools.find((t) => normalise(t.name) === target);
}

/** Lowercase letters+digits only — "listCommands" and "list_commands" match. */
function normalise(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]/g, '');
}

function editDistance(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length || !b.length) return Math.max(a.length, b.length);

  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const row = [i];
    for (let j = 1; j <= b.length; j++) {
      row[j] = Math.min(
        prev[j]! + 1,
        row[j - 1]! + 1,
        prev[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
    }
    prev = row;
  }
  return prev[b.length]!;
}

/**
 * Find the tool a model meant. Exact → normalised → namespaced suffix →
 * near miss (edit distance ≤ 2) → containment. Anything further apart is a
 * real mistake and is reported as one.
 */
export function resolveTool(name: string): Tool | undefined {
  if (!name) return undefined;

  const exact = registry.get(name);
  if (exact) return exact;

  const target = normalise(name);
  if (!target) return undefined;

  const entries = [...registry.entries()];
  for (const [key, tool] of entries) {
    if (normalise(key) === target) return tool;
  }

  const tail = name.split(/[.:/]/).pop();
  if (tail && tail !== name) {
    const byTail = resolveTool(tail);
    if (byTail) return byTail;
  }

  let best: { tool: Tool; distance: number } | null = null;
  for (const [key, tool] of entries) {
    const d = editDistance(target, normalise(key));
    if (d <= 2 && (!best || d < best.distance)) best = { tool, distance: d };
  }
  if (best) return best.tool;

  for (const [key, tool] of entries) {
    const k = normalise(key);
    if (k.includes(target) || target.includes(k)) return tool;
  }
  return undefined;
}

/** Test seam — drop every registered tool. */
export function clearTools(): void {
  registry.clear();
}
