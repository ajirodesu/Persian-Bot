import { pool } from '../client.js';

export interface McpSkillRow {
  id: string;
  user_id: string;
  kind: string;
  name: string;
  config: string;
  risk: number;
  min_role: number;
  status: string;
  danger_reasons: string | null;
  approved_by: string | null;
  created_at: string;
  updated_at: string;
}

const COLS =
  'id, user_id, kind, name, config, risk, min_role, status, danger_reasons, approved_by, created_at, updated_at';

export async function listUserMcpSkills(userId: string): Promise<McpSkillRow[]> {
  const res = await pool.query<McpSkillRow>(
    `SELECT ${COLS} FROM bot_user_mcp_skills WHERE user_id = $1 ORDER BY created_at DESC`,
    [userId],
  );
  return res.rows;
}

export async function getMcpSkillById(id: string): Promise<McpSkillRow | null> {
  const res = await pool.query<McpSkillRow>(
    `SELECT ${COLS} FROM bot_user_mcp_skills WHERE id = $1`,
    [id],
  );
  return res.rows[0] ?? null;
}

/** Admin view: every user's integrations with owner identity. */
export async function listAllMcpSkills(): Promise<
  Array<McpSkillRow & { user_email: string | null; user_name: string | null }>
> {
  const prefixed = 'm.' + COLS.replaceAll(', ', ', m.');
  const res = await pool.query<
    McpSkillRow & { user_email: string | null; user_name: string | null }
  >(
    `SELECT ${prefixed}, u.email AS user_email, u.name AS user_name
     FROM bot_user_mcp_skills m LEFT JOIN "user" u ON u.id = m.user_id
     ORDER BY m.created_at DESC`,
  );
  return res.rows;
}

export async function createMcpSkill(row: {
  id: string;
  userId: string;
  kind: string;
  name: string;
  config: string;
  risk: number;
  minRole: number;
  status: string;
  dangerReasons: string | null;
  approvedBy: string | null;
}): Promise<void> {
  await pool.query(
    `INSERT INTO bot_user_mcp_skills
       (id, user_id, kind, name, config, risk, min_role, status, danger_reasons, approved_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
    [
      row.id,
      row.userId,
      row.kind,
      row.name,
      row.config,
      row.risk,
      row.minRole,
      row.status,
      row.dangerReasons,
      row.approvedBy,
    ],
  );
}

const UPDATABLE = new Set([
  'name',
  'config',
  'risk',
  'min_role',
  'status',
  'danger_reasons',
  'approved_by',
]);

export async function updateMcpSkill(
  id: string,
  patch: Record<string, unknown>,
): Promise<void> {
  const entries = Object.entries(patch).filter(([k]) => UPDATABLE.has(k));
  if (entries.length === 0) return;
  const sets = entries.map(([k], i) => `${k} = $${i + 2}`).join(', ');
  await pool.query(
    `UPDATE bot_user_mcp_skills SET ${sets}, updated_at = NOW() WHERE id = $1`,
    [id, ...entries.map(([, v]) => v)],
  );
}

export async function deleteMcpSkill(id: string, userId: string): Promise<void> {
  await pool.query(`DELETE FROM bot_user_mcp_skills WHERE id = $1 AND user_id = $2`, [
    id,
    userId,
  ]);
}

/** Admin delete — not scoped to any owner. */
export async function deleteMcpSkillById(id: string): Promise<void> {
  await pool.query(`DELETE FROM bot_user_mcp_skills WHERE id = $1`, [id]);
}
