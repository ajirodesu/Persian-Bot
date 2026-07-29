/**
 * migrate-turso-to-mongodb
 * Direct migration from Turso/libSQL to MongoDB.
 */
import '../scripts/load-env.js';
import {
  tursoClient,
  initDb as initTursoDb,
} from '../adapters/turso/src/client.js';
import { mongoClient, getMongoDb } from '../adapters/mongodb/src/client.js';
import {
  tablesDef,
  collectionsMap,
  BOOLEAN_JSON_KEYS,
  convertDatesForMongo,
} from './table-defs.js';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function toMongoValue(jsonKey: string, val: any): any {
  if (val === null || val === undefined) return null;
  if (BOOLEAN_JSON_KEYS.has(jsonKey)) return Number(val) === 1;
  return val;
}

async function main() {
  console.log(`turso-to-mongodb migration`);

  await initTursoDb();

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
          outRow[jsonKey] = toMongoValue(jsonKey, r[plainKey] ?? null);
        }
        return outRow;
      });
    } catch (e: any) {
      console.warn(`[WARN] Skipping ${def.table}: ${e.message}`);
      db[def.jsonKey] = [];
    }
  }

  const threads = db.botThread || [];
  const participantsData = await tursoClient
    .execute('SELECT thread_id, user_id FROM bot_thread_participants')
    .catch(() => ({ rows: [] as unknown as Array<Record<string, unknown>> }));
  const adminsData = await tursoClient
    .execute('SELECT thread_id, user_id FROM bot_thread_admins')
    .catch(() => ({ rows: [] as unknown as Array<Record<string, unknown>> }));
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

  const mongoDb = getMongoDb();
  console.log('Writing to MongoDB...');

  for (const [jsonKey, mongoCol] of Object.entries(collectionsMap)) {
    await mongoDb
      .collection(mongoCol)
      .deleteMany({})
      .catch((e: any) =>
        console.warn(`[WARN] Delete failed for ${mongoCol}: ${e.message}`),
      );
    const rows = db[jsonKey] || [];
    if (rows.length > 0) {
      const docs = rows.map(convertDatesForMongo).map((r) => {
        // Map 'id' back to '_id' for better-auth so it can natively query these records via ObjectId/String _id.
        if (
          r.id &&
          ['user', 'session', 'account', 'verification'].includes(jsonKey)
        ) {
          r._id = r.id;
          delete r.id;
        }
        return r;
      });
      try {
        await mongoDb.collection(mongoCol).insertMany(docs);
      } catch (e: any) {
        console.warn(`[WARN] Insert failed for ${mongoCol}: ${e.message}`);
      }
      console.log(`  ${jsonKey.padEnd(34)} ${rows.length}`);
    }
  }

  await mongoDb
    .collection('botThreads')
    .deleteMany({})
    .catch((e: any) =>
      console.warn(`[WARN] Delete failed for botThreads: ${e.message}`),
    );
  const threadRows = db.botThread;
  if (threadRows && threadRows.length > 0) {
    const threadDocs = threadRows.map((t) => {
      const { participants, admins, ...rest } = t;
      return convertDatesForMongo({
        ...rest,
        participantIDs: participants || [],
        adminIDs: admins || [],
      });
    });
    try {
      await mongoDb.collection('botThreads').insertMany(threadDocs);
    } catch (e: any) {
      console.warn(`[WARN] Insert failed for botThreads: ${e.message}`);
    }
    console.log(`  ${'botThread'.padEnd(34)} ${threadDocs.length}`);
  }

  await mongoDb
    .collection('botDiscordServers')
    .deleteMany({})
    .catch(() => {});
  const serverRows = db.botDiscordServer;
  if (serverRows && serverRows.length > 0) {
    const serverDocs = serverRows.map((t) => {
      const { participants, admins, ...rest } = t;
      return convertDatesForMongo({
        ...rest,
        participantIDs: participants || [],
        adminIDs: admins || [],
      });
    });
    try {
      await mongoDb.collection('botDiscordServers').insertMany(serverDocs);
    } catch (e: any) {
      console.warn(`[WARN] Insert failed for botDiscordServers: ${e.message}`);
    }
    console.log(`  ${'botDiscordServer'.padEnd(34)} ${serverDocs.length}`);
  }

  console.log('\nMigration complete.');
  await mongoClient.close();
}

main().catch((err: unknown) => {
  console.error('Migration failed:', err);
  process.exit(1);
});
