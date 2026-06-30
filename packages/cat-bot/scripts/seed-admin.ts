import 'dotenv/config';
import { auth } from '../src/server/lib/better-auth.lib.js';
import crypto from 'crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Reconstruct __dirname from import.meta.url — ESM scripts have no __dirname global.
// The resolved path anchors all relative directory lookups to this file's location,
// independent of whatever CWD the caller uses when running: tsx scripts/seed-admin.ts
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Creates packages/database/database/ before the adapter writes its first file.
// The json adapter writes database.json and prisma-sqlite writes database.sqlite
// into that directory — both throw ENOENT on their first open() if it is absent.
function ensureDbDir(): void {
  const dbType = process.env['DATABASE_TYPE'];
  // Unset DATABASE_TYPE silently defaults to prisma-sqlite, which also needs the dir.
  if (dbType === 'json' || dbType === 'prisma-sqlite' || dbType === undefined) {
    const dbDir = path.resolve(__dirname, '../../database/database');
    if (!fs.existsSync(dbDir)) {
      fs.mkdirSync(dbDir, { recursive: true });
      console.log(`📁 Created database directory: ${dbDir}`);
    }
  }
}

// ── Edit these before running ────────────────────────────────────────────────
const ADMIN_EMAIL = 'admin@example.com';
const ADMIN_NAME = 'Admin';
// ─────────────────────────────────────────────────────────────────────────────

// Generate a secure random password
function generatePassword(length = 16) {
  return crypto
    .randomBytes(length)
    .toString('base64') // convert to readable format
    .replace(/[^a-zA-Z0-9]/g, '') // remove special chars for simplicity
    .slice(0, length);
}

const ADMIN_PASSWORD = generatePassword();
ensureDbDir();

const result = await auth.api.createUser({
  body: {
    email: ADMIN_EMAIL,
    password: ADMIN_PASSWORD,
    name: ADMIN_NAME,
    role: 'admin',
  },
});

console.log('✅ Admin created:', result.user);
console.log('🔐 Generated password:', ADMIN_PASSWORD);
