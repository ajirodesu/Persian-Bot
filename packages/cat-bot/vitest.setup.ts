// Vitest setup — minimal env so env.config.ts validation passes at import.
// Provider keys are intentionally NOT set here; tests set them per-case.
process.env.NODE_ENV ??= 'test';
process.env.DATABASE_TYPE ??= 'turso';
process.env.BETTER_AUTH_SECRET ??= 'test-secret-for-vitest-only-32-chars';
process.env.BETTER_AUTH_URL ??= 'http://localhost:3000';
process.env.ENCRYPTION_KEY ??= 'test-encryption-key-for-vitest-only';
