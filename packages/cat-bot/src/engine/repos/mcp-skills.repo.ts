/**
 * MCP & Skills Repo — user-owned AI integrations backed by the
 * `bot_user_mcp_skills` table.
 *
 * Secrets inside integration configs (e.g. Authorization headers) are
 * encrypted at rest; everything else stays readable so admins can review,
 * edit, approve, or delete entries from the admin dashboard.
 */

import { randomUUID } from 'node:crypto';
import {
  listUserMcpSkills as _list,
  getMcpSkillById as _get,
  listAllMcpSkills as _listAll,
  createMcpSkill as _create,
  updateMcpSkill as _update,
  deleteMcpSkill as _delete,
  deleteMcpSkillById as _deleteById,
} from 'database';
import { encrypt, decrypt } from '@/engine/utils/crypto.util.js';

export type IntegrationKind = 'mcp' | 'skill';
export type IntegrationStatus = 'active' | 'pending_review' | 'restricted' | 'disabled';

/** MCP server config: Streamable-HTTP JSON-RPC endpoint. */
export interface McpConfig {
  url: string;
  headers?: Record<string, string>;
  timeoutMs?: number;
}

/** Skill config: webhook-backed custom tool, or prompt-pack skill. */
export interface SkillConfig {
  mode: 'tool' | 'prompt';
  /** tool mode: webhook invoked with the tool arguments as JSON. */
  url?: string;
  headers?: Record<string, string>;
  parameters?: Record<string, unknown>;
  timeoutMs?: number;
  /** prompt mode: extra system-prompt section for the agent. */
  instructions?: string;
}

export interface McpSkillRecord {
  id: string;
  userId: string;
  kind: IntegrationKind;
  name: string;
  config: McpConfig | SkillConfig;
  risk: 0 | 1 | 2;
  minRole: number;
  status: IntegrationStatus;
  dangerReasons: string[];
  approvedBy: string | null;
  createdAt: string;
  updatedAt: string;
}

const SECRET_KEY = /(token|secret|api[-_ ]?key|password|auth|bearer|private)/i;

function sealValue(value: string): string {
  return value.startsWith('enc:v1:') ? value : encrypt(value);
}

function openValue(value: unknown): unknown {
  if (typeof value === 'string' && value.startsWith('enc:v1:')) {
    try {
      return decrypt(value);
    } catch {
      return value;
    }
  }
  return value;
}

/** Encrypt secret header values; leaves everything else readable. */
function sealHeaders(
  headers: Record<string, string> | undefined,
): Record<string, string> | undefined {
  if (!headers) return undefined;
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(headers)) {
    out[k] = SECRET_KEY.test(k) ? sealValue(v) : v;
  }
  return out;
}

function openHeaders(
  headers: Record<string, unknown> | undefined,
): Record<string, string> | undefined {
  if (!headers || typeof headers !== 'object') return undefined;
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(headers)) {
    if (typeof v === 'string') out[k] = String(openValue(v));
  }
  return out;
}

function parseConfig(raw: unknown): McpConfig | SkillConfig {
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    const c = raw as Record<string, unknown>;
    const headers = openHeaders(c.headers as Record<string, unknown> | undefined);
    if (typeof c.url === 'string') {
      const out: McpConfig = { url: String(openValue(c.url)) };
      if (headers) out.headers = headers;
      if (Number.isFinite(Number(c.timeoutMs))) out.timeoutMs = Number(c.timeoutMs);
      return out;
    }
    const out: SkillConfig = { mode: c.mode === 'prompt' ? 'prompt' : 'tool' };
    if (typeof c.url === 'string') out.url = String(openValue(c.url));
    if (headers) out.headers = headers;
    if (c.parameters && typeof c.parameters === 'object') {
      out.parameters = c.parameters as Record<string, unknown>;
    }
    if (Number.isFinite(Number(c.timeoutMs))) out.timeoutMs = Number(c.timeoutMs);
    if (typeof c.instructions === 'string') out.instructions = c.instructions;
    return out;
  }
  if (typeof raw === 'string') {
    try {
      return parseConfig(JSON.parse(raw) as unknown);
    } catch {
      return { url: '' };
    }
  }
  return { url: '' };
}

function parseReasons(raw: unknown): string[] {
  if (Array.isArray(raw)) return raw.filter((r): r is string => typeof r === 'string');
  if (typeof raw === 'string') {
    try {
      const parsed: unknown = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        return parsed.filter((r): r is string => typeof r === 'string');
      }
    } catch {
      return [];
    }
  }
  return [];
}

function toRecord(row: Record<string, unknown>): McpSkillRecord {
  const kind = row.kind === 'skill' ? 'skill' : 'mcp';
  const risk = row.risk === 2 ? 2 : row.risk === 1 ? 1 : 0;
  const statusRaw = String(row.status ?? 'active');
  const status: IntegrationStatus =
    statusRaw === 'pending_review' || statusRaw === 'restricted' || statusRaw === 'disabled'
      ? statusRaw
      : 'active';
  return {
    id: String(row.id ?? ''),
    userId: String(row.user_id ?? ''),
    kind,
    name: String(row.name ?? ''),
    config: parseConfig(row.config),
    risk,
    minRole: Number(row.min_role ?? 0),
    status,
    dangerReasons: parseReasons(row.danger_reasons),
    approvedBy: typeof row.approved_by === 'string' ? row.approved_by : null,
    createdAt: String(row.created_at ?? ''),
    updatedAt: String(row.updated_at ?? ''),
  };
}

export function serializeConfig(config: McpConfig | SkillConfig): string {
  const c = config as unknown as Record<string, unknown>;
  const sealed: Record<string, unknown> = { ...c };
  sealed.headers = sealHeaders(c.headers as Record<string, string> | undefined);
  return JSON.stringify(sealed);
}

export async function listIntegrationsForUser(userId: string): Promise<McpSkillRecord[]> {
  try {
    const rows = (await _list(userId)) as unknown as Record<string, unknown>[];
    return (rows ?? []).map(toRecord);
  } catch {
    return [];
  }
}

export async function getIntegrationById(id: string): Promise<McpSkillRecord | null> {
  try {
    const row = (await _get(id)) as unknown as Record<string, unknown> | null;
    return row ? toRecord(row) : null;
  } catch {
    return null;
  }
}

/** Admin: every user's integrations with owner identity (secrets stay sealed). */
export async function listAllIntegrations(): Promise<
  Array<McpSkillRecord & { userEmail: string | null; userName: string | null }>
> {
  try {
    const rows = (await _listAll()) as unknown as Array<Record<string, unknown>>;
    return (rows ?? []).map((row) => ({
      ...toRecord(row),
      userEmail: typeof row.user_email === 'string' ? row.user_email : null,
      userName: typeof row.user_name === 'string' ? row.user_name : null,
    }));
  } catch {
    return [];
  }
}

export async function createIntegration(input: {
  userId: string;
  kind: IntegrationKind;
  name: string;
  config: McpConfig | SkillConfig;
  risk: 0 | 1 | 2;
  minRole: number;
  status: IntegrationStatus;
  dangerReasons: string[];
  approvedBy: string | null;
}): Promise<McpSkillRecord> {
  const id = randomUUID();
  await _create({
    id,
    userId: input.userId,
    kind: input.kind,
    name: input.name,
    config: serializeConfig(input.config),
    risk: input.risk,
    minRole: input.minRole,
    status: input.status,
    dangerReasons: JSON.stringify(input.dangerReasons),
    approvedBy: input.approvedBy,
  });
  const created = await getIntegrationById(id);
  if (!created) throw new Error('Failed to read back created integration');
  return created;
}

export async function updateIntegration(
  id: string,
  patch: {
    name?: string;
    config?: McpConfig | SkillConfig;
    risk?: 0 | 1 | 2;
    minRole?: number;
    status?: IntegrationStatus;
    dangerReasons?: string[];
    approvedBy?: string | null;
  },
): Promise<void> {
  const dbPatch: Record<string, unknown> = {};
  if (patch.name !== undefined) dbPatch.name = patch.name;
  if (patch.config !== undefined) dbPatch.config = serializeConfig(patch.config);
  if (patch.risk !== undefined) dbPatch.risk = patch.risk;
  if (patch.minRole !== undefined) dbPatch.min_role = patch.minRole;
  if (patch.status !== undefined) dbPatch.status = patch.status;
  if (patch.dangerReasons !== undefined) dbPatch.danger_reasons = JSON.stringify(patch.dangerReasons);
  if (patch.approvedBy !== undefined) dbPatch.approved_by = patch.approvedBy;
  await _update(id, dbPatch);
}

export async function deleteIntegrationForUser(id: string, userId: string): Promise<void> {
  await _delete(id, userId);
}

export async function deleteIntegrationById(id: string): Promise<void> {
  await _deleteById(id);
}
