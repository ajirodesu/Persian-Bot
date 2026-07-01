import 'dotenv/config';
import { auth } from '../src/server/lib/better-auth.lib.js';
import crypto from 'crypto';

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
