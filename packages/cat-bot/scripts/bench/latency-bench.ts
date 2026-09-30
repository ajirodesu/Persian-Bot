/**
 * Author: AjiroDesu
 *
 * Internal-latency benchmark for Cat-Bot's dispatch pipeline.
 *
 * Replays synthetic events through the REAL handleMessage pipeline for every
 * platform adapter (discord / telegram / fluxer / webchat) with the network
 * layer mocked: the platform API is a recording no-op, so measured time is
 * purely Cat-Bot's own processing (receive → parse → middleware → command
 * lookup → handler → dispatch). Platform network/API time is OUT of scope
 * here and is measured separately (see EXTERNAL section below).
 *
 * Steady-state methodology: 30 warmup events per case fill every LRU
 * (command enables, session data, reaction emoji) exactly as production
 * traffic does, then N timed iterations run. A separate COLD reading shows
 * the first-event cost (cache misses → real DB round-trips).
 *
 * DB note: warmup + measurement use the bench identity (userId
 * 'bench-probe'), so the detached on-chat sync writes a few clearly-labeled
 * bench rows to the dev database. Reads dominate; writes are fire-and-forget
 * by engine design.
 *
 * Usage: npm run bench
 *   CATBOT_PERF_TRACE=1 npm run bench   (also emits per-stage stderr marks)
 *
 * Exit code is 1 when any steady-state ping p99 exceeds the 10ms budget —
 * this doubles as the latency regression gate.
 */
import { performance } from 'node:perf_hooks';
import { handleMessage } from '@/engine/controllers/handlers/message.handler.js';
import { parseCommand } from '@/engine/modules/command/command-parser.util.js';
import { buildBaseCtx } from '@/engine/controllers/factories/ctx.factory.js';
import { findSimilarCommand } from '@/engine/modules/command/command-suggest.util.js';
import type {
  CommandMap,
  CommandModule,
  NativeContext,
} from '@/engine/types/controller.types.js';
import type { UnifiedApi } from '@/engine/adapters/models/api.model.js';
import { Platforms } from '@/engine/modules/platform/platform.constants.js';
import '@/engine/middleware/index.js';

const P99_BUDGET_MS = 10;
const WARMUP = 20;
const ITERATIONS = 100;
// Pause between case blocks so detached background syncs (DB upserts the
// engine fires per message) drain instead of piling into a rate-limit
// storm that would pollute the next block's event loop.
const DRAIN_MS = 500;

// ── Mock platform API ───────────────────────────────────────────────────────
// Records dispatch; resolves on the next microtask. No sockets, no HTTP —
// the mock contributes ~0.001ms, so the reading is Cat-Bot's own work.

interface MockChat {
  replyMessage: (opts: { message: string }) => Promise<unknown>;
}

function createMockApi(platform: string): { api: UnifiedApi; sent: string[] } {
  const sent: string[] = [];
  const base = {
    platform,
    replyMessage: async (_threadID: string, opts: { message?: string }): Promise<string> => {
      sent.push(opts.message ?? '');
      return `mock-${sent.length}`;
    },
    sendMessage: async (): Promise<string> => `mock-${sent.length}`,
    editMessage: async (): Promise<void> => undefined,
    unsendMessage: async (): Promise<void> => undefined,
    reactToMessage: async (): Promise<void> => undefined,
    sendTypingIndicator: async (): Promise<void> => undefined,
    getBotID: async (): Promise<string> => 'mock-bot-id',
    getUserName: async (userID: string): Promise<string> =>
      userID === 'bench-probe' ? 'Bench Probe' : userID,
    getThreadName: async (): Promise<string> => 'bench-thread',
    getMemberCount: async (): Promise<number> => 2,
    getUserInfo: async (
      userIds: string[],
    ): Promise<Record<string, { name: string }>> =>
      Object.fromEntries(userIds.map((id) => [id, { name: 'Bench Probe' }])),
    getFullUserInfo: async (userID: string): Promise<{
      platform: string;
      id: string;
      name: string;
      firstName: string | null;
      username: string | null;
      avatarUrl: string | null;
    }> => ({
      platform,
      id: userID,
      name: 'Bench Probe',
      firstName: null,
      username: 'benchprobe',
      avatarUrl: null,
    }),
    getFullThreadInfo: async (threadID: string): Promise<{
      platform: string;
      threadID: string;
      name: string;
      isGroup: boolean;
      memberCount: number;
      participantIDs: string[];
      adminIDs: string[];
      avatarUrl: string | null;
      serverID: string | null;
    }> => ({
      platform,
      threadID,
      name: 'bench-thread',
      isGroup: false,
      memberCount: 2,
      participantIDs: ['bench-probe'],
      adminIDs: ['bench-probe'],
      avatarUrl: null,
      serverID: null,
    }),
  };
  return { api: base as unknown as UnifiedApi, sent };
}

// ── Synthetic command table ─────────────────────────────────────────────────
// One real handler (ping) plus 348 filler entries so the suggestion scan and
// registry walk the same shape as production (348 real commands).

function buildCommands(): CommandMap {
  const map: CommandMap = new Map<string, CommandModule>();
  const ping: CommandModule = {
    meta: { name: 'ping' },
    onCommand: async (ctx: unknown): Promise<void> => {
      const chat = (ctx as { chat: MockChat }).chat;
      await chat.replyMessage({ message: 'pong' });
    },
  };
  map.set('ping', ping);
  for (let i = 0; i < 348; i += 1) {
    const name = `dummycmd${i}`;
    map.set(name, { meta: { name } });
  }
  return map;
}

// ── Events ──────────────────────────────────────────────────────────────────

function makeEvent(text: string, n: number): Record<string, unknown> {
  return {
    type: 'message',
    senderID: 'bench-probe',
    message: text,
    threadID: 'bench-thread',
    messageID: `bench-m-${n}`,
    mentions: {},
    timestamp: Date.now(),
    isGroup: false,
  };
}

function makeNative(platform: string): NativeContext {
  return { platform, userId: 'bench-probe', sessionId: 'bench-session' };
}

// ── Stats ───────────────────────────────────────────────────────────────────

interface Stats {
  p50: number;
  p95: number;
  p99: number;
  mean: number;
  max: number;
}

function summarize(samples: number[]): Stats {
  const sorted = [...samples].sort((a, b) => a - b);
  const at = (q: number): number => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length)) ] ?? 0;
  const mean = sorted.reduce((a, b) => a + b, 0) / sorted.length;
  return { p50: at(0.5), p95: at(0.95), p99: at(0.99), mean, max: sorted[sorted.length - 1] ?? 0 };
}

function fmt(s: Stats): string {
  const f = (n: number): string => n.toFixed(3).padStart(8);
  return `p50 ${f(s.p50)}  p95 ${f(s.p95)}  p99 ${f(s.p99)}  mean ${f(s.mean)}  max ${f(s.max)}`;
}

async function timeHandle(
  api: UnifiedApi,
  commands: CommandMap,
  text: string,
  native: NativeContext,
  n: number,
): Promise<number> {
  const t0 = performance.now();
  await handleMessage(api, makeEvent(text, n), commands, '/', native);
  return performance.now() - t0;
}

// ── External latency (reported separately, never counted to target) ─────────
// A: Turso round-trip floor (the dominant external I/O on our hot path).
// B: TLS+HTTP floor to each platform API base (unauthenticated — connection
//    setup only, a lower bound, NOT a real API call).

async function measureExternal(): Promise<void> {
  console.log('\n--- EXTERNAL latency (separate from target) ---');
  const db = (await import('database').catch(
    () => null,
  )) as { tursoClient?: { execute: (sql: string) => Promise<unknown> } } | null;
  const tursoClient = db?.tursoClient ?? null;
  if (tursoClient) {
    try {
      const samples: number[] = [];
      for (let i = 0; i < 10; i += 1) {
        const t0 = performance.now();
        await tursoClient.execute('SELECT 1');
        samples.push(performance.now() - t0);
      }
      console.log(`turso SELECT 1      : ${fmt(summarize(samples))}  (ms)`);
    } catch (err) {
      // Rate-limited or unreachable DB must never fail the latency gate —
      // external measurement is best-effort by design.
      console.log(
        `turso SELECT 1      : unavailable (${err instanceof Error ? err.message.slice(0, 60) : 'unknown'})`,
      );
    }
  } else {
    console.log('turso SELECT 1      : skipped (client unavailable)');
  }
  const hosts = [
    ['telegram', 'https://api.telegram.org/'],
    ['discord ', 'https://discord.com/api/v10/'],
    ['fluxer  ', 'https://api.fluxer.app/'],
  ] as Array<[string, string]>;
  for (const [name, url] of hosts) {
    const samples: number[] = [];
    for (let i = 0; i < 5; i += 1) {
      const t0 = performance.now();
      try {
        await fetch(url, { method: 'HEAD', signal: AbortSignal.timeout(8000) });
      } catch {
        // Unauthenticated endpoints may 4xx/5xx or reset — the handshake
        // timing is what we record; failures still took measurable time.
      }
      samples.push(performance.now() - t0);
    }
    console.log(`platform ${name}    : ${fmt(summarize(samples))}  (ms, connection floor)`);
  }
}

// ── Main ────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  // Cold (first-event) cost is measured FIRST in a fresh process while the
  // LRUs are still empty — cache misses here mean real DB round-trips.
  console.log('--- COLD first-event cost (cache misses, includes DB I/O) ---');
  {
    const { api } = createMockApi(Platforms.Telegram);
    const coldCommands = buildCommands();
    const t0 = performance.now();
    await handleMessage(api, makeEvent('/ping', 0), coldCommands, '/', makeNative(Platforms.Telegram));
    console.log(`cold /ping (telegram): ${(performance.now() - t0).toFixed(1)}ms (DB round-trips included)\n`);
  }

  const commands = buildCommands();
  const platforms = [Platforms.Discord, Platforms.Telegram, Platforms.Fluxer, Platforms.Webchat];
  const cases = [
    { name: 'ping command (success path)', text: '/ping' },
    { name: 'unknown cmd (suggest path)', text: '/pnigxqzv' },
    { name: 'plain chatter (no prefix)', text: 'hello there everyone' },
  ];

  console.log('Cat-Bot internal latency benchmark (mock network, steady-state)');
  console.log(`warmup=${WARMUP} iterations=${ITERATIONS} per case per platform\n`);

  let failed = false;

  const sleep = (ms: number): Promise<void> =>
    new Promise((resolve) => setTimeout(resolve, ms));

  for (const platform of platforms) {
    const { api } = createMockApi(platform);
    const native = makeNative(platform);
    for (const kase of cases) {
      for (let i = 0; i < WARMUP; i += 1) {
        await timeHandle(api, commands, kase.text, native, i);
      }
      const samples: number[] = [];
      for (let i = 0; i < ITERATIONS; i += 1) {
        samples.push(await timeHandle(api, commands, kase.text, native, WARMUP + i));
      }
      const stats = summarize(samples);
      const gate = kase.name.startsWith('ping') && stats.p99 > P99_BUDGET_MS;
      if (gate) failed = true;
      console.log(
        `${platform.padEnd(9)} ${kase.name.padEnd(27)} ${fmt(stats)}${gate ? '  <-- OVER BUDGET' : ''}`,
      );
      await sleep(DRAIN_MS);
    }
  }

  // Stage micro-benchmarks (bottleneck ranking).
  console.log('\n--- Stage micro-benchmarks ---');
  {
    const { api } = createMockApi(Platforms.Discord);
    const native = makeNative(Platforms.Discord);
    const event = makeEvent('/ping hello world', 0);
    const MICRO = 5000;
    let t0 = performance.now();
    for (let i = 0; i < MICRO; i += 1) buildBaseCtx(api, event, commands, native, '/');
    console.log(`buildBaseCtx       : ${((performance.now() - t0) / MICRO).toFixed(4)} ms/op (n=${MICRO})`);
    const args = ['/ping', 'hello', 'world'];
    t0 = performance.now();
    for (let i = 0; i < MICRO; i += 1) parseCommand(args, '/');
    console.log(`parseCommand       : ${((performance.now() - t0) / MICRO).toFixed(4)} ms/op (n=${MICRO})`);
    t0 = performance.now();
    for (let i = 0; i < MICRO; i += 1) commands.get('ping');
    console.log(`Map.get lookup     : ${((performance.now() - t0) / MICRO).toFixed(4)} ms/op (n=${MICRO})`);
    t0 = performance.now();
    const SUG = 500;
    for (let i = 0; i < SUG; i += 1) findSimilarCommand('pnigxqzv', commands, new Set<string>());
    console.log(`findSimilarCommand : ${((performance.now() - t0) / SUG).toFixed(4)} ms/op (n=${SUG}, 349 entries)`);
  }

  await measureExternal();

  console.log(`\nBudget: steady-state ping p99 <= ${P99_BUDGET_MS}ms → ${failed ? 'FAIL' : 'PASS'}`);
  if (failed) process.exit(1);
}

void main().catch((err: unknown) => {
  console.error('benchmark crashed:', err);
  process.exit(2);
});
