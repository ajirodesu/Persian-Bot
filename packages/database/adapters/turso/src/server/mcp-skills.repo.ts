import { tursoClient } from '../client.js';

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
  const res = await tursoClient.execute({
    sql: `SELECT ${COLS} FROM bot_user_mcp_skills WHERE user_id = :userId ORDER BY created_at DESC`,
    args: { userId },
  });
  return res.rows as unknown as McpSkillRow[];
}

export async function getMcpSkillById(id: string): Promise<McpSkillRow | null> {
  const res = await tursoClient.execute({
    sql: `SELECT ${COLS} FROM bot_user_mcp_skills WHERE id = :id`,
    args: { id },
  });
  return (res.rows[0] as unknown as McpSkillRow | undefined) ?? null;
}

/** Admin view: every user's integrations with owner identity. */
export async function listAllMcpSkills(): Promise<
  Array<McpSkillRow & { user_email: string | null; user_name: string | null }>
> {
  const res = await tursoClient.execute(
    `SELECT ${'m.' + COLS.replaceAll(', ', ', m.')}, u.email AS user_email, u.name AS user_name
     FROM bot_user_mcp_skills m LEFT JOIN "user" u ON u.id = m.user_id
     ORDER BY m.created_at DESC`,
  );
  return res.rows as unknown as Array<
    McpSkillRow & { user_email: string | null; user_name: string | null }
  >;
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
  await tursoClient.execute({
    sql: `INSERT INTO bot_user_mcp_skills
            (id, user_id, kind, name, config, risk, min_role, status, danger_reasons, approved_by)
          VALUES (:id, :userId, :kind, :name, :config, :risk, :minRole, :status, :dangerReasons, :approvedBy)`,
    args: {
      id: row.id,
      userId: row.userId,
      kind: row.kind,
      name: row.name,
      config: row.config,
      risk: row.risk,
      minRole: row.minRole,
      status: row.status,
      dangerReasons: row.dangerReasons,
      approvedBy: row.approvedBy,
    },
  });
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
  const sets = entries.map(([k], i) => `${k} = :v${i}`).join(', ');
  const args: Record<string, unknown> = { id };
  entries.forEach(([, v], i) => {
    args[`v${i}`] = v;
  });
  await tursoClient.execute({
    sql: `UPDATE bot_user_mcp_skills SET ${sets}, updated_at = STRFTIME('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = :id`,
    args,
  });
}

export async function deleteMcpSkill(id: string, userId: string): Promise<void> {
  await tursoClient.execute({
    sql: `DELETE FROM bot_user_mcp_skills WHERE id = :id AND user_id = :userId`,
    args: { id, userId },
  });
}

/** Admin delete — not scoped to any owner. */
export async function deleteMcpSkillById(id: string): Promise<void> {
  await tursoClient.execute({
    sql: `DELETE FROM bot_user_mcp_skills WHERE id = :id`,
    args: { id },
  });
}
