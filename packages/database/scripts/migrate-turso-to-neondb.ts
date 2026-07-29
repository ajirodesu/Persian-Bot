/**
 * migrate-turso-to-neondb
 * Direct migration from Turso/libSQL to NeonDB/Postgres.
 */
import './load-env.js';
import {
  tursoClient,
  initDb as initTursoDb,
} from '../adapters/turso/src/client.js';
import { pool, initDb as initNeonDb } from '../adapters/neondb/src/client.js';
import { tablesDef, BOOLEAN_JSON_KEYS } from './table-defs.js';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function toPgValue(jsonKey: string, val: any): any {
  if (val === null || val === undefined) return null;
  if (BOOLEAN_JSON_KEYS.has(jsonKey)) return Number(val) === 1;
  return val;
}

async function main() {
  console.log(`turso-to-neondb migration`);

  await initTursoDb();
  await initNeonDb();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db: Record<string, any[]> = {};

  console.log('Reading from Turso...');
  for (const def of tablesDef) {
    try {
      const sqlCols = Object.values(def.cols)
        .map((c) => c.replace(/"/g, ''))
        .join(', ');
      const result = await tursoClient.execute(
        `SELECT ${sqlCols} FROM ${def.table}`,
      );
      db[def.jsonKey] = (
        result.rows as unknown as Array<Record<string, unknown>>
      ).map((r) => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const outRow: any = {};
        for (const [jsonKey, rawDbKey] of Object.entries(def.cols)) {
          const plainKey = rawDbKey.replace(/"/g, '');
          outRow[jsonKey] = toPgValue(jsonKey, r[plainKey] ?? null);
        }
        return outRow;
      });
    } catch (e: any) {
      console.warn(`[WARN] Skipping ${def.table}: ${e.message}`);
      db[def.jsonKey] = [];
    }
  }

  // Reconstruct M:M sets for the junction tables.
  const threads = db.botThread || [];
  const participantsData = await tursoClient
    .execute('SELECT thread_id, user_id FROM bot_thread_participants')
    .catch((e: any) => {
      console.warn(`[WARN] ${e.message}`);
      return { rows: [] as unknown as Array<Record<string, unknown>> };
    });
  const adminsData = await tursoClient
    .execute('SELECT thread_id, user_id FROM bot_thread_admins')
    .catch((e: any) => {
      console.warn(`[WARN] ${e.message}`);
      return { rows: [] as unknown as Array<Record<string, unknown>> };
    });
  const threadMap = new Map();
  for (const t of threads)
    threadMap.set(t.id, { ...t, participants: [], admins: [] });
  for (const p of participantsData.rows as unknown as Array<{
    thread_id: string;
    user_id: string;
  }>)
    threadMap.get(p.thread_id)?.participants.push(p.user_id);
  for (const a of adminsData.rows as unknown as Array<{
    thread_id: string;
    user_id: string;
  }>)
    threadMap.get(a.thread_id)?.admins.push(a.user_id);
  db.botThread = Array.from(threadMap.values());

  const servers = db.botDiscordServer || [];
  const dsParticipantsData = await tursoClient
    .execute('SELECT server_id, user_id FROM bot_discord_server_participants')
    .catch(() => ({ rows: [] as unknown as Array<Record<string, unknown>> }));
  const dsAdminsData = await tursoClient
    .execute('SELECT server_id, user_id FROM bot_discord_server_admins')
    .catch(() => ({ rows: [] as unknown as Array<Record<string, unknown>> }));
  const serverMap = new Map();
  for (const t of servers)
    serverMap.set(t.id, { ...t, participants: [], admins: [] });
  for (const p of dsParticipantsData.rows as unknown as Array<{
    server_id: string;
    user_id: string;
  }>)
    serverMap.get(p.server_id)?.participants.push(p.user_id);
  for (const a of dsAdminsData.rows as unknown as Array<{
    server_id: string;
    user_id: string;
  }>)
    serverMap.get(a.server_id)?.admins.push(a.user_id);
  db.botDiscordServer = Array.from(serverMap.values());

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    console.log('Truncating tables in NeonDB...');
    try {
      await client.query(
        `TRUNCATE TABLE "user", bot_users, bot_threads, bot_discord_server, system_admin CASCADE`,
      );
    } catch (e: any) {
      console.warn(`[WARN] Truncate failed: ${e.message}`);
    }

    console.log('Writing to NeonDB...');
    for (const def of tablesDef) {
      const rows = db[def.jsonKey] || [];
      if (!rows.length) continue;

      const colNames = Object.values(def.cols);
      const jsonKeys = Object.keys(def.cols);

      // Insert in batches of 100 to avoid hitting PostgreSQL parameter limits.
      for (let i = 0; i < rows.length; i += 100) {
        const batch = rows.slice(i, i + 100);
        const placeholders = [];
        const values = [];
        let pIndex = 1;

        for (const row of batch) {
          const rowPlaceholders = [];
          for (const key of jsonKeys) {
            rowPlaceholders.push(`$${pIndex++}`);
            let val = row[key] ?? null;
            if (
              typeof val === 'object' &&
              val !== null &&
              !Array.isArray(val)
            ) {
              val = JSON.stringify(val);
            }
            values.push(val);
          }
          placeholders.push(`(${rowPlaceholders.join(', ')})`);
        }
        try {
          await client.query('SAVEPOINT batch_insert');
          await client.query(
            `INSERT INTO ${def.table} (${colNames.join(', ')}) VALUES ${placeholders.join(', ')} ON CONFLICT DO NOTHING`,
            values,
          );
          await client.query('RELEASE SAVEPOINT batch_insert');
        } catch (e: any) {
          await client.query('ROLLBACK TO SAVEPOINT batch_insert');
          console.warn(`[WARN] Insert failed for ${def.table}: ${e.message}`);
        }
      }
      console.log(`  ${def.jsonKey.padEnd(34)} ${rows.length}`);

      if (def.jsonKey === 'botThread') {
        const pData = [],
          aData = [];
        for (const t of rows) {
          for (const p of t.participants || [])
            pData.push({ thread_id: t.id, user_id: p });
          for (const a of t.admins || [])
            aData.push({ thread_id: t.id, user_id: a });
        }
        if (pData.length > 0) {
          const pValues = pData
            .map((p) => `('${p.thread_id}', '${p.user_id}')`)
            .join(', ');
          try {
            await client.query('SAVEPOINT p_insert');
            await client.query(
              `INSERT INTO bot_thread_participants (thread_id, user_id) VALUES ${pValues} ON CONFLICT DO NOTHING`,
            );
            await client.query('RELEASE SAVEPOINT p_insert');
          } catch (e: any) {
            await client.query('ROLLBACK TO SAVEPOINT p_insert');
            console.warn(`[WARN] ${e.message}`);
          }
        }
        if (aData.length > 0) {
          const aValues = aData
            .map((a) => `('${a.thread_id}', '${a.user_id}')`)
            .join(', ');
          try {
            await client.query('SAVEPOINT a_insert');
            await client.query(
              `INSERT INTO bot_thread_admins (thread_id, user_id) VALUES ${aValues} ON CONFLICT DO NOTHING`,
            );
            await client.query('RELEASE SAVEPOINT a_insert');
          } catch (e: any) {
            await client.query('ROLLBACK TO SAVEPOINT a_insert');
            console.warn(`[WARN] ${e.message}`);
          }
        }
      }

      if (def.jsonKey === 'botDiscordServer') {
        const pData = [],
          aData = [];
        for (const t of rows) {
          for (const p of t.participants || [])
            pData.push({ server_id: t.id, user_id: p });
          for (const a of t.admins || [])
            aData.push({ server_id: t.id, user_id: a });
        }
        if (pData.length > 0) {
          const pValues = pData
            .map((p) => `('${p.server_id}', '${p.user_id}')`)
            .join(', ');
          try {
            await client.query('SAVEPOINT p_insert_ds');
            await client.query(
              `INSERT INTO bot_discord_server_participants (server_id, user_id) VALUES ${pValues} ON CONFLICT DO NOTHING`,
            );
            await client.query('RELEASE SAVEPOINT p_insert_ds');
          } catch (e: any) {
            await client.query('ROLLBACK TO SAVEPOINT p_insert_ds');
          }
        }
        if (aData.length > 0) {
          const aValues = aData
            .map((a) => `('${a.server_id}', '${a.user_id}')`)
            .join(', ');
          try {
            await client.query('SAVEPOINT a_insert_ds');
            await client.query(
              `INSERT INTO bot_discord_server_admins (server_id, user_id) VALUES ${aValues} ON CONFLICT DO NOTHING`,
            );
            await client.query('RELEASE SAVEPOINT a_insert_ds');
          } catch (e: any) {
            await client.query('ROLLBACK TO SAVEPOINT a_insert_ds');
          }
        }
      }
    }

    await client.query('COMMIT');
    console.log('\nMigration complete.');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((err: unknown) => {
  console.error('Migration failed:', err);
  process.exit(1);
});
