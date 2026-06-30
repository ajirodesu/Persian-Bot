/**
 * migrate-mongodb-to-sqlite
 * Direct migration from MongoDB to Prisma/SQLite.
 */
import './load-env.js';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { PrismaClient } from '../adapters/prisma-sqlite/src/generated/prisma/client.js';
import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3';
import { mongoClient, getMongoDb } from '../adapters/mongodb/src/client.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const dbRoot = path.resolve(__dirname, '..');

const rawUrl =
  process.env['SQLITE_DATABASE_URL'] ?? process.env['DATABASE_URL'];
const DB_SQLITE_FILE = rawUrl
  ? rawUrl.replace(/^file:/, '')
  : path.resolve(dbRoot, 'database/database.sqlite');

const collectionsMap: Record<string, string> = {
  botSessionCommand: 'botSessionCommands',
  botSessionEvent: 'botSessionEvents',
  botCredentialDiscord: 'botCredentialDiscord',
  botCredentialTelegram: 'botCredentialTelegram',
  botSession: 'botSessions',
  botAdmin: 'botAdmins',
  botPremium: 'botPremiums',
  botUser: 'botUsers',
  systemAdmin: 'systemAdmin',
  botThreadSession: 'botThreadSessions',
  botUserSession: 'botUserSessions',
  botDiscordChannel: 'botDiscordChannels',
  botDiscordServerSession: 'botDiscordServerSessions',
  botUserBanned: 'botUserBanned',
  botThreadBanned: 'botThreadBanned',
  user: 'user',
  session: 'session',
  account: 'account',
  verification: 'verification',
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function rows<T>(db: Record<string, any[]>, key: string): T[] {
  return (db[key] ?? []) as T[];
}

const isoDateRegex = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function convertDates(obj: any): any {
  if (typeof obj === 'string' && isoDateRegex.test(obj)) return new Date(obj);
  if (Array.isArray(obj)) return obj.map(convertDates);
  if (obj !== null && typeof obj === 'object') {
    if (obj instanceof Date) return obj;
    if (
      obj._bsontype === 'ObjectID' ||
      (obj.toHexString && typeof obj.toHexString === 'function')
    )
      return obj.toString();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const out: any = {};
    for (const [k, v] of Object.entries(obj)) out[k] = convertDates(v);
    return out;
  }
  return obj;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function deepConvert(obj: any): any {
  return convertDates(obj);
}

async function main() {
  console.log(`mongodb-to-sqlite migration`);
  console.log(`  Target : ${DB_SQLITE_FILE}`);

  const mongoDb = getMongoDb();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db: Record<string, any[]> = {};

  // ── Phase 1: Read all documents from MongoDB
  console.log('Reading from MongoDB...');
  for (const [jsonKey, mongoCol] of Object.entries(collectionsMap)) {
    try {
      const docs = await mongoDb.collection(mongoCol).find({}).toArray();
      db[jsonKey] = docs.map((d) => {
        const converted = deepConvert(d);
        // Map _id to id so better-auth tables have string PKs matching Prisma schema
        if (converted._id && !converted.id) converted.id = converted._id;
        delete converted._id;
        return converted;
      });
    } catch (e: any) {
      console.warn(`[WARN] Skipping ${mongoCol}: ${e.message}`);
      db[jsonKey] = [];
    }
  }

  // Handle the custom M:M document mapping for botThread
  try {
    const rawThreads = await mongoDb
      .collection('botThreads')
      .find({})
      .toArray();
    db.botThread = rawThreads.map((t) => {
      const converted = deepConvert(t);
      if (converted._id && !converted.id) converted.id = converted._id;
      delete converted._id;
      const { participantIDs, adminIDs, ...rest } = converted;
      return {
        ...rest,
        participants: participantIDs || [],
        admins: adminIDs || [],
      };
    });
  } catch (e: any) {
    console.warn(`[WARN] Skipping botThreads: ${e.message}`);
    db.botThread = [];
  }

  // Handle the custom M:M document mapping for botDiscordServer
  try {
    const rawServers = await mongoDb
      .collection('botDiscordServers')
      .find({})
      .toArray();
    db.botDiscordServer = rawServers.map((t) => {
      const converted = deepConvert(t);
      if (converted._id && !converted.id) converted.id = converted._id;
      delete converted._id;
      const { participantIDs, adminIDs, ...rest } = converted;
      return {
        ...rest,
        participants: participantIDs || [],
        admins: adminIDs || [],
      };
    });
  } catch (e: any) {
    console.warn(`[WARN] Skipping botDiscordServers: ${e.message}`);
    db.botDiscordServer = [];
  }

  // ── Phase 2: Insert into SQLite in topological order
  const adapter = new PrismaBetterSqlite3({ url: `file:${DB_SQLITE_FILE}` });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const prisma = new PrismaClient({ adapter } as any);

  const safeExec = async <T>(p: Promise<T>): Promise<void> => {
    try {
      await p;
    } catch (e: any) {
      console.warn(`[WARN] ${e.message}`);
    }
  };

  console.log('Clearing existing SQLite data...');
  // Delete all records in safe topological order to satisfy SQLite FK constraints
  await safeExec(prisma.botUserBanned.deleteMany());
  await safeExec(prisma.botThreadBanned.deleteMany());
  await safeExec(prisma.botSessionCommand.deleteMany());
  await safeExec(prisma.botSessionEvent.deleteMany());
  await safeExec(prisma.botUserSession.deleteMany());
  await safeExec(prisma.botThreadSession.deleteMany());
  await safeExec(prisma.botDiscordChannel.deleteMany());
  await safeExec(prisma.botDiscordServerSession.deleteMany());
  await safeExec(prisma.botDiscordServer.deleteMany());
  await safeExec(prisma.botCredentialDiscord.deleteMany());
  await safeExec(prisma.botCredentialTelegram.deleteMany());
  await safeExec(prisma.botAdmin.deleteMany());
  await safeExec(prisma.botPremium.deleteMany());
  await safeExec(prisma.botSession.deleteMany());
  await safeExec(prisma.botThread.deleteMany());
  await safeExec(prisma.botUser.deleteMany());
  await safeExec(prisma.verification.deleteMany());
  await safeExec(prisma.account.deleteMany());
  await safeExec(prisma.session.deleteMany());
  await safeExec(prisma.user.deleteMany());
  await safeExec(prisma.systemAdmin.deleteMany());

  console.log('Writing to SQLite...');
  if (db.user?.length)
    await safeExec(prisma.user.createMany({ data: rows(db, 'user') }));
  if (db.session?.length)
    await safeExec(prisma.session.createMany({ data: rows(db, 'session') }));
  if (db.account?.length)
    await safeExec(prisma.account.createMany({ data: rows(db, 'account') }));
  if (db.verification?.length)
    await safeExec(
      prisma.verification.createMany({ data: rows(db, 'verification') }),
    );
  if (db.systemAdmin?.length)
    await safeExec(
      prisma.systemAdmin.createMany({ data: rows(db, 'systemAdmin') }),
    );
  if (db.botUser?.length)
    await safeExec(prisma.botUser.createMany({ data: rows(db, 'botUser') }));

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  for (const t of rows<any>(db, 'botThread')) {
    const { participants = [], admins = [], ...threadScalars } = t;
    await safeExec(
      prisma.botThread.create({
        data: {
          ...threadScalars,
          participants: participants.length
            ? { connect: participants.map((id: string) => ({ id })) }
            : undefined,
          admins: admins.length
            ? { connect: admins.map((id: string) => ({ id })) }
            : undefined,
        },
      }),
    );
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  for (const s of rows<any>(db, 'botDiscordServer')) {
    const { participants = [], admins = [], ...serverScalars } = s;
    await safeExec(
      prisma.botDiscordServer.create({
        data: {
          ...serverScalars,
          participants: participants.length
            ? { connect: participants.map((id: string) => ({ id })) }
            : undefined,
          admins: admins.length
            ? { connect: admins.map((id: string) => ({ id })) }
            : undefined,
        },
      }),
    );
  }

  if (db.botDiscordChannel?.length)
    await safeExec(
      prisma.botDiscordChannel.createMany({
        data: rows(db, 'botDiscordChannel'),
      }),
    );
  if (db.botDiscordServerSession?.length)
    await safeExec(
      prisma.botDiscordServerSession.createMany({
        data: rows(db, 'botDiscordServerSession'),
      }),
    );

  if (db.botSession?.length)
    await safeExec(
      prisma.botSession.createMany({ data: rows(db, 'botSession') }),
    );
  if (db.botAdmin?.length)
    await safeExec(prisma.botAdmin.createMany({ data: rows(db, 'botAdmin') }));
  if (db.botPremium?.length)
    await safeExec(
      prisma.botPremium.createMany({ data: rows(db, 'botPremium') }),
    );

  if (db.botCredentialDiscord?.length)
    await safeExec(
      prisma.botCredentialDiscord.createMany({
        data: rows(db, 'botCredentialDiscord'),
      }),
    );
  if (db.botCredentialTelegram?.length)
    await safeExec(
      prisma.botCredentialTelegram.createMany({
        data: rows(db, 'botCredentialTelegram'),
      }),
    );

  if (db.botUserSession?.length)
    await safeExec(
      prisma.botUserSession.createMany({ data: rows(db, 'botUserSession') }),
    );
  if (db.botThreadSession?.length)
    await safeExec(
      prisma.botThreadSession.createMany({
        data: rows(db, 'botThreadSession'),
      }),
    );
  if (db.botSessionCommand?.length)
    await safeExec(
      prisma.botSessionCommand.createMany({
        data: rows(db, 'botSessionCommand'),
      }),
    );
  if (db.botSessionEvent?.length)
    await safeExec(
      prisma.botSessionEvent.createMany({ data: rows(db, 'botSessionEvent') }),
    );

  if (db.botUserBanned?.length) {
    await safeExec(
      prisma.botUserBanned.createMany({
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        data: db.botUserBanned.map((r: any) => ({
          ...r,
          reason: r.reason ?? null,
        })),
      }),
    );
  }
  if (db.botThreadBanned?.length) {
    await safeExec(
      prisma.botThreadBanned.createMany({
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        data: db.botThreadBanned.map((r: any) => ({
          ...r,
          reason: r.reason ?? null,
        })),
      }),
    );
  }

  console.log('\nMigration complete. Row counts:');
  for (const [table, tableRows] of Object.entries(db)) {
    if (tableRows.length > 0) {
      console.log(`  ${table.padEnd(34)} ${tableRows.length}`);
    }
  }

  await prisma.$disconnect();
  await mongoClient.close();
}

main().catch((err) => {
  console.error('Migration failed:', err);
  process.exit(1);
});
