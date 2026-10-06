import { getMongoDb } from '../client.js';

export interface McpSkillDoc {
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
  createdAt: Date;
  updatedAt: Date;
}

const COLLECTION = 'botUserMcpSkills';

type Stored = McpSkillDoc & { _id?: unknown };

function toRow(doc: Stored): Record<string, unknown> {
  return {
    id: doc.id,
    user_id: doc.userId,
    kind: doc.kind,
    name: doc.name,
    config: doc.config,
    risk: doc.risk,
    min_role: doc.minRole,
    status: doc.status,
    danger_reasons: doc.dangerReasons,
    approved_by: doc.approvedBy,
    created_at: doc.createdAt,
    updated_at: doc.updatedAt,
  };
}

export async function listUserMcpSkills(
  userId: string,
): Promise<Record<string, unknown>[]> {
  const db = getMongoDb();
  const docs = await db
    .collection<Stored>(COLLECTION)
    .find({ userId }, { projection: { _id: 0 } })
    .sort({ createdAt: -1 })
    .toArray();
  return docs.map(toRow);
}

export async function getMcpSkillById(
  id: string,
): Promise<Record<string, unknown> | null> {
  const db = getMongoDb();
  const doc = await db
    .collection<Stored>(COLLECTION)
    .findOne({ id }, { projection: { _id: 0 } });
  return doc ? toRow(doc) : null;
}

/** Admin view: every user's integrations with owner identity. */
export async function listAllMcpSkills(): Promise<Record<string, unknown>[]> {
  const db = getMongoDb();
  const docs = await db
    .collection<Stored>(COLLECTION)
    .find({}, { projection: { _id: 0 } })
    .sort({ createdAt: -1 })
    .toArray();
  const out: Record<string, unknown>[] = [];
  for (const doc of docs) {
    const owner = await db
      .collection<{ id: string; email?: string; name?: string }>('user')
      .findOne({ id: doc.userId }, { projection: { _id: 0, email: 1, name: 1 } });
    out.push({
      ...toRow(doc),
      user_email: owner?.email ?? null,
      user_name: owner?.name ?? null,
    });
  }
  return out;
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
  const db = getMongoDb();
  const now = new Date();
  await db.collection<McpSkillDoc>(COLLECTION).insertOne({
    ...row,
    createdAt: now,
    updatedAt: now,
  });
}

const FIELD_MAP: Record<string, string> = {
  name: 'name',
  config: 'config',
  risk: 'risk',
  min_role: 'minRole',
  status: 'status',
  danger_reasons: 'dangerReasons',
  approved_by: 'approvedBy',
};

export async function updateMcpSkill(
  id: string,
  patch: Record<string, unknown>,
): Promise<void> {
  const mapped: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(patch)) {
    const field = FIELD_MAP[k];
    if (field) mapped[field] = v;
  }
  if (Object.keys(mapped).length === 0) return;
  const db = getMongoDb();
  await db
    .collection(COLLECTION)
    .updateOne({ id }, { $set: { ...mapped, updatedAt: new Date() } });
}

export async function deleteMcpSkill(id: string, userId: string): Promise<void> {
  const db = getMongoDb();
  await db.collection(COLLECTION).deleteMany({ id, userId });
}

/** Admin delete — not scoped to any owner. */
export async function deleteMcpSkillById(id: string): Promise<void> {
  const db = getMongoDb();
  await db.collection(COLLECTION).deleteMany({ id });
}
