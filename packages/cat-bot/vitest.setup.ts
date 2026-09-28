// Sets the required env vars BEFORE any engine module (env.config validates on import).
process.env['DATABASE_TYPE'] = 'mongodb';
process.env['BETTER_AUTH_SECRET'] = 'test-secret-for-vitest-only-0123456789';
process.env['BETTER_AUTH_URL'] = 'http://localhost:3000';
process.env['ENCRYPTION_KEY'] =
  '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
process.env['NODE_ENV'] = 'test';
