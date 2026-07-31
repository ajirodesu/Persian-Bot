// Load .env before any process.env access — MongoDB URI vars must be readable at module evaluation time.
import 'dotenv/config';
import { MongoClient, ServerApiVersion, type Db } from 'mongodb';

// ── Environment resolution ────────────────────────────────────────────────────

const MONGODB_URI_RAW = process.env['MONGODB_URI'];
const MONGO_PASSWORD = process.env['MONGO_PASSWORD'];
const MONGO_DATABASE_NAME = process.env['MONGO_DATABASE_NAME'];

if (!MONGODB_URI_RAW) {
  throw new Error(
    '[MongoDB] Missing required env var: MONGODB_URI\n' +
      'Set it in your .env file. See .env.example for the <PASSWORD> placeholder format.',
  );
}
if (!MONGO_DATABASE_NAME) {
  throw new Error(
    '[MongoDB] Missing required env var: MONGO_DATABASE_NAME\n' +
      'Set it to the name of the MongoDB database this bot should use.',
  );
}

// Replace the <PASSWORD> placeholder with a properly URI-encoded password so
// special characters (@ # $ % & + = space) in the password do not corrupt the
// connection string parser. The raw password is never logged.
const mongoUri: string = MONGO_PASSWORD
  ? MONGODB_URI_RAW.replace('<PASSWORD>', encodeURIComponent(MONGO_PASSWORD))
  : MONGODB_URI_RAW;

// ── Singleton guard ───────────────────────────────────────────────────────────
// tsx --watch and similar hot-reload systems re-evaluate modules on every file save.
// Without this guard, each reload opens a new MongoClient and leaks connection pool slots.
const globalForMongo = globalThis as unknown as {
  mongoClient: MongoClient | undefined;
};

export const mongoClient: MongoClient =
  globalForMongo.mongoClient ??
  new MongoClient(mongoUri, {
    serverApi: {
      // Stable API v1: fails loudly on deprecated or removed MongoDB server commands
      // rather than silently degrading — essential for Atlas compatibility and
      // catching issues during MongoDB Atlas / server version upgrades.
      version: ServerApiVersion.v1,
      strict: true,
      deprecationErrors: true,
    },
  });

// Only pin to globalThis in dev; production processes boot once and never hot-reload.
if (process.env['NODE_ENV'] !== 'production')
  globalForMongo.mongoClient = mongoClient;

/**
 * Returns the Db instance for MONGO_DATABASE_NAME.
 */
export const getMongoDb = (): Db => mongoClient.db(MONGO_DATABASE_NAME);

// ── Connection readiness ─────────────────────────────────────────────────────
// The MongoDB driver connects lazily by default — without this, the TCP + TLS +
// auth handshake would land on whichever query happens to run first, which could
// be a user's first command instead of boot. Connecting eagerly here and exposing
// the promise as `dbReady` mirrors the neondb/turso adapters, so app.ts's existing
// `await dbReady` boot gate applies uniformly across every adapter.
const globalForMongoReady = globalThis as unknown as {
  mongoDbReadyPromise: Promise<void> | undefined;
};

if (!globalForMongoReady.mongoDbReadyPromise) {
  globalForMongoReady.mongoDbReadyPromise = mongoClient
    .connect()
    .then(() => undefined)
    .catch((err: unknown) => {
      // Non-fatal at the client level — log clearly so a bad URI/credentials surface
      // immediately rather than silently retrying on every subsequent query.
      console.error('[MongoDB] Failed to establish initial connection:', err);
    });
}

/** Resolves once the initial MongoDB connection has been established. Await this before issuing any query. */
export const dbReady: Promise<void> = globalForMongoReady.mongoDbReadyPromise;

// ── Connection heartbeat ─────────────────────────────────────────────────────
// Same rationale as the neondb/turso heartbeats: keep at least one pooled socket
// warm through quiet periods so the next real command after inactivity doesn't
// pay a full reconnect on top of its own query.
const HEARTBEAT_INTERVAL_MS = 45_000;

setInterval(() => {
  mongoClient
    .db(MONGO_DATABASE_NAME)
    .command({ ping: 1 })
    .catch(() => {
      // Ignore errors — the driver reconnects automatically on the next real query.
      // A heartbeat failure must never crash the process or surface to application code.
    });
}, HEARTBEAT_INTERVAL_MS).unref();
