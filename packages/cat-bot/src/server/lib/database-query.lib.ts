/**
 * Adapter-agnostic raw-SQL query helper.
 *
 * The dashboard's Database panel (bot-database.controller.ts) needs LIMIT/OFFSET,
 * ILIKE search, and dynamic ORDER BY — capabilities the engine's repo layer doesn't
 * expose — so it queries the database directly instead of going through a repo.
 * That raw query was previously written for Postgres only (`pool.query`, `$1..$n`
 * placeholders, `ILIKE`), so it threw `Cannot read properties of undefined (reading
 * 'query')` whenever DATABASE_TYPE=turso, since the `database` package only exports
 * a `pool` when DATABASE_TYPE=neondb (`tursoClient` is the Turso equivalent, and it's
 * a different, incompatible client type — see database/src/index.ts).
 *
 * This module picks the right client for the active DATABASE_TYPE and translates a
 * single Postgres-flavored query into libSQL syntax when needed, so callers can keep
 * writing one query instead of maintaining a parallel SQL string per adapter.
 */

import { pool, tursoClient } from 'database';
import { env } from '@/engine/config/env.config.js';

export interface DbQueryResult {
  rows: Record<string, unknown>[];
  rowCount: number | null;
}

/**
 * Runs a Postgres-flavored query (`$1, $2…` placeholders, `ILIKE` allowed) against
 * whichever adapter is active for DATABASE_TYPE.
 *
 * - neondb: passed straight through to `pg.Pool#query` — no translation needed.
 * - turso: `$n` placeholders are rewritten to named `:pN` params and `ILIKE` is
 *   rewritten to `LIKE` (SQLite's LIKE is already ASCII case-insensitive), then run
 *   via `tursoClient.execute`. Rows come back with SQLite's 0/1 integer encoding for
 *   boolean-like columns (naming convention `is_*`), so those are normalized to real
 *   booleans to match what neondb returns natively.
 * - mongodb: not supported by this raw-SQL path — throws a clear, catchable error
 *   instead of crashing on an undefined client.
 */
export async function dbQuery(
  pgSql: string,
  params: unknown[],
): Promise<DbQueryResult> {
  if (env.DATABASE_TYPE === 'mongodb') {
    throw new Error(
      'The database browsing panel requires a SQL adapter and is not available when DATABASE_TYPE=mongodb.',
    );
  }

  if (env.DATABASE_TYPE === 'turso') {
    if (!tursoClient) {
      throw new Error(
        'Turso client is not initialized. Check TURSO_DATABASE_URL / TURSO_AUTH_TOKEN.',
      );
    }

    const { sql, args } = toLibsqlQuery(pgSql, params);
    const result = await tursoClient.execute({ sql, args });
    // `result` types as `any` here — tursoClient comes through the database package's
    // untyped dynamic-import barrel — so the map callback's param needs an explicit
    // annotation; TS can't contextually infer it from an `any`-typed array under
    // noImplicitAny/strict, which is what TS7006 was flagging.
    const rows: Record<string, unknown>[] = (
      result.rows as unknown[]
    ).map((row: unknown) => normalizeSqliteRow(row, result.columns as string[]));

    return { rows, rowCount: rows.length };
  }

  // neondb (pg.Pool) — the original, already-correct path.
  if (!pool) {
    throw new Error(
      'Database pool is not initialized. Check DATABASE_TYPE / DATABASE_URL.',
    );
  }
  return pool.query(pgSql, params) as Promise<DbQueryResult>;
}

/** Rewrites `$1..$n` → `:p1..:pn` and `ILIKE` → `LIKE`; builds the matching named-args object. */
function toLibsqlQuery(
  pgSql: string,
  params: unknown[],
): { sql: string; args: Record<string, unknown> } {
  const sql = pgSql
    .replace(/\$(\d+)/g, (_match, n: string) => `:p${n}`)
    .replace(/\bILIKE\b/gi, 'LIKE');

  const args: Record<string, unknown> = {};
  params.forEach((value, index) => {
    args[`p${index + 1}`] = value;
  });

  return { sql, args };
}

/**
 * libSQL rows are indexable by position, not guaranteed to be plain enumerable
 * objects — read them via the result's `columns` list rather than `Object.keys`.
 * Also converts `bigint` (libSQL's INTEGER representation for large values) to
 * `number`, and 0/1 values on `is_*`-named columns to real booleans, so callers
 * see the same shapes neondb's native BOOLEAN/pg driver already produces.
 */
function normalizeSqliteRow(
  row: unknown,
  columns: string[],
): Record<string, unknown> {
  const indexable = row as unknown[];
  const plain: Record<string, unknown> = {};

  for (let i = 0; i < columns.length; i++) {
    const column = columns[i];
    if (column === undefined) continue;
    let value = indexable[i];
    if (typeof value === 'bigint') value = Number(value);
    if (column.startsWith('is_') && (value === 0 || value === 1)) {
      value = value === 1;
    }
    plain[column] = value;
  }

  return plain;
}
