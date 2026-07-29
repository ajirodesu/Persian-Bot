/**
 * migrate-neondb-to-turso
 * Direct migration from NeonDB/Postgres to Turso/libSQL.
 */
import './load-env.js';
import { pool, initDb as initNeonDb } from '../adapters/neondb/src/client.js';
import {
  tursoClient,
  initDb as initTursoDb,
} from '../adapters/turso/src/client.js';
import { tablesDef, BOOLEAN_JSON_KEYS } from './table-defs.js';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function toTursoValue(jsonKey: string, val: any): any {
  if (val === undefined) return null;
  if (val instanceof Date) return val.toISOString();
  if (BOOLEAN_JSON_KEYS.has(jsonKey) && typeof val === 'boolean')
    return val ? 1 : 0;
  if (
    typeof val === 'object' &&
    val !== null &&
    !Array.isArray(val) &&
    !(val instanceof Date)
  ) {
    return JSON.stringify(val);
  }
  return val;
}

async function main() {
  console.log(`neondb-to-turso migration`);

  // Ensure both schemas exist before proceeding to avoid undefined-table errors.
  await initNeonDb();
  await initTursoDb();

  const pgClient = await pool.connect();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db: Record<string, any[]> = {};

  console.log('Reading from NeonDB...');
  try {
    for (const def of tablesDef) {
      try {
        const sqlCols = Object.values(def.cols).join(', ');
        const result = await pgClient.query(
          `SELECT ${sqlCols} FROM ${def.table}`,
        );
        db[def.jsonKey] = result.rows.map((r) => {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const outRow: any = {};
          for (const [jsonKey, rawDbKey] of Object.entries(def.cols)) {
            outRow[jsonKey] = r[rawDbKey.replace(/"/g, '')] ?? null;
          }
          return outRow;
        });
      } catch (e: any) {
        console.warn(`[WARN] Skipping ${def.table}: ${e.message}`);
        db[def.jsonKey] = [];
      }
    }

    // Reconstruct M:M sets for the junction tables, same as migrate-neondb-to-mongodb.ts
    const threads = db.botThread || [];
    const participantsData = await pgClient
      .query('SELECT thread_id, user_id FROM bot_thread_participants')
      .catch((e: any) => {
        console.warn(`[WARN] ${e.message}`);
        return { rows: [] };
      });
    const adminsData = await pgClient
      .query('SELECT thread_id, user_id FROM bot_thread_admins')
      .catch((e: any) => {
        console.warn(`[WARN] ${e.message}`);
        return { rows: [] };
      });
    const threadMap = new Map();
    for (const t of threads)
      threadMap.set(t.id, { ...t, participants: [], admins: [] });
    for (const p of participantsData.rows)
      threadMap.get(p.thread_id)?.participants.push(p.user_id);
    for (const a of adminsData.rows)
      threadMap.get(a.thread_id)?.admins.push(a.user_id);
    db.botThread = Array.from(threadMap.values());

    const servers = db.botDiscordServer || [];
    const dsParticipantsData = await pgClient
      .query('SELECT server_id, user_id FROM bot_discord_server_participants')
      .catch(() => ({ rows: [] }));
    const dsAdminsData = await pgClient
      .query('SELECT server_id, user_id FROM bot_discord_server_admins')
      .catch(() => ({ rows: [] }));
    const serverMap = new Map();
    for (const t of servers)
      serverMap.set(t.id, { ...t, participants: [], admins: [] });
    for (const p of dsParticipantsData.rows)
      serverMap.get(p.server_id)?.participants.push(p.user_id);
    for (const a of dsAdminsData.rows)
      serverMap.get(a.server_id)?.admins.push(a.user_id);
    db.botDiscordServer = Array.from(serverMap.values());
  } finally {
    pgClient.release();
    await pool.end();
  }

  console.log('Truncating tables in Turso...');
  await tursoClient.execute('PRAGMA foreign_keys = OFF;');
  try {
    for (const def of [...tablesDef].reverse()) {
      await tursoClient
        .execute(`DELETE FROM ${def.table}`)
        .catch((e: any) => console.warn(`[WARN] Truncate failed: ${e.message}`));
    }
    await tursoClient
      .execute('DELETE FROM bot_thread_participants')
      .catch(() => {});
    await tursoClient.execute('DELETE FROM bot_thread_admins').catch(() => {});
    await tursoClient
      .execute('DELETE FROM bot_discord_server_participants')
      .catch(() => {});
    await tursoClient
      .execute('DELETE FROM bot_discord_server_admins')
      .catch(() => {});
  } finally {
    await tursoClient.execute('PRAGMA foreign_keys = ON;');
  }

  console.log('Writing to Turso...');
  for (const def of tablesDef) {
    const rows = db[def.jsonKey] || [];
    if (!rows.length) continue;

    const jsonKeys = Object.keys(def.cols);
    // Turso column identifiers reuse the same double-quoted syntax as Postgres — SQLite
    // accepts standard SQL double-quoted identifiers unmodified.
    const colNames = Object.values(def.cols);

    // Insert row-by-row via a libSQL batch — simpler than building multi-row VALUES with
    // per-row uniquely-named params, and @libsql/client's batch() runs atomically.
    const statements = rows.map((row) => {
      const args: Record<string, unknown> = {};
      const placeholders = jsonKeys.map((key) => {
        args[key] = toTursoValue(key, row[key] ?? null);
        return `:${key}`;
      });
      return {
        sql: `INSERT INTO ${def.table} (${colNames.join(', ')}) VALUES (${placeholders.join(', ')}) ON CONFLICT DO NOTHING`,
        args,
      };
    });

    try {
      await tursoClient.batch(statements, 'write');
    } catch (e: any) {
      console.warn(`[WARN] Batch insert failed for ${def.table}: ${e.message}`);
    }
    console.log(`  ${def.jsonKey.padEnd(34)} ${rows.length}`);

    if (def.jsonKey === 'botThread') {
      const pStatements: { sql: string; args: Record<string, unknown> }[] = [];
      const aStatements: { sql: string; args: Record<string, unknown> }[] = [];
      for (const t of rows) {
        for (const p of t.participants || [])
          pStatements.push({
            sql: `INSERT INTO bot_thread_participants (thread_id, user_id) VALUES (:threadId, :userId) ON CONFLICT DO NOTHING`,
            args: { threadId: t.id, userId: p },
          });
        for (const a of t.admins || [])
          aStatements.push({
            sql: `INSERT INTO bot_thread_admins (thread_id, user_id) VALUES (:threadId, :userId) ON CONFLICT DO NOTHING`,
            args: { threadId: t.id, userId: a },
          });
      }
      if (pStatements.length)
        await tursoClient
          .batch(pStatements, 'write')
          .catch((e: any) => console.warn(`[WARN] ${e.message}`));
      if (aStatements.length)
        await tursoClient
          .batch(aStatements, 'write')
          .catch((e: any) => console.warn(`[WARN] ${e.message}`));
    }

    if (def.jsonKey === 'botDiscordServer') {
      const pStatements: { sql: string; args: Record<string, unknown> }[] = [];
      const aStatements: { sql: string; args: Record<string, unknown> }[] = [];
      for (const t of rows) {
        for (const p of t.participants || [])
          pStatements.push({
            sql: `INSERT INTO bot_discord_server_participants (server_id, user_id) VALUES (:serverId, :userId) ON CONFLICT DO NOTHING`,
            args: { serverId: t.id, userId: p },
          });
        for (const a of t.admins || [])
          aStatements.push({
            sql: `INSERT INTO bot_discord_server_admins (server_id, user_id) VALUES (:serverId, :userId) ON CONFLICT DO NOTHING`,
            args: { serverId: t.id, userId: a },
          });
      }
      if (pStatements.length)
        await tursoClient
          .batch(pStatements, 'write')
          .catch((e: any) => console.warn(`[WARN] ${e.message}`));
      if (aStatements.length)
        await tursoClient
          .batch(aStatements, 'write')
          .catch((e: any) => console.warn(`[WARN] ${e.message}`));
    }
  }

  console.log('\nMigration complete.');
}

main().catch((err: unknown) => {
  console.error('Migration failed:', err);
  process.exit(1);
});
