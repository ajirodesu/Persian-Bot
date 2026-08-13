/**
 * bot_stats Tool — Process Health & Session Count
 *
 * Converted from project-canis (src/components/ai/tools/botStats.ts).
 * Returns live process statistics — heap memory usage, uptime, and the number
 * of currently connected/running bot sessions — so the agent can answer
 * performance and resource questions (and the operator can verify the bot is
 * healthy) without any external service.
 *
 * All values are read from in-memory process state — zero DB or network I/O —
 * so the tool answers instantly and is always available.
 */

import { getHeapStatistics } from 'node:v8';
import { sessionManager } from '@/engine/modules/session/session-manager.lib.js';

// ============================================================================
// TOOL DEFINITION
// ============================================================================

export const config = {
  name: 'bot_stats',
  description:
    'Get current bot statistics: heap memory usage (MB), process uptime, ' +
    'and the number of active bot sessions currently running on this server. ' +
    'No arguments required.',
  parameters: {
    type: 'object',
    properties: {},
  },
};

// ============================================================================
// TOOL RUN
// ============================================================================

export const run = async (): Promise<string> => {
  try {
    const heap = getHeapStatistics();
    const mem = process.memoryUsage();
    const upSec = process.uptime();

    const days = Math.floor(upSec / 86_400);
    const hours = Math.floor((upSec % 86_400) / 3_600);
    const minutes = Math.floor((upSec % 3_600) / 60);

    // JSON payload mirrors the original botStats tool's output shape while
    // adding the fields most useful in the Cat-Bot context (uptimeSeconds and
    // nodeVersion). Fixed to 2 decimals so the numbers are LLM-friendly.
    return JSON.stringify(
      {
        memoryUsedMB: Number((mem.heapUsed / 1024 / 1024).toFixed(2)),
        memoryTotalMB: Number((heap.total_heap_size / 1024 / 1024).toFixed(2)),
        uptime: `${days > 0 ? `${days}d ` : ''}${hours}h ${minutes}m`,
        uptimeSeconds: Math.floor(upSec),
        activeBotSessions: sessionManager.getActiveKeys().length,
        nodeVersion: process.version,
      },
      null,
      2,
    );
  } catch (err) {
    return `Bot stats error: ${err instanceof Error ? err.message : String(err)}`;
  }
};
