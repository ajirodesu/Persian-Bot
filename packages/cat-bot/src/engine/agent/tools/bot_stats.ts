/**
 * bot_stats Tool — Live bot runtime statistics for the AI agent
 *
 * Ports project-canis's botStats tool (mrepol742/project-canis
 * src/components/ai/tools/botStats.ts) into Cat-Bot's native agent tool shape
 * (config + run, dynamically loaded by agent.ts).
 *
 * Reports V8 heap memory, process uptime, and the number of currently connected
 * bot sessions across all platforms — the analog of project-canis's WhatsApp
 * client count. Cat-Bot is a multi-platform bot whose live listeners are
 * tracked by SessionManager (getActiveKeys()).
 */

import v8 from 'node:v8';
import { sessionManager } from '@/engine/modules/session/session-manager.lib.js';

// ============================================================================
// TOOL DEFINITION
// ============================================================================

export const config = {
  name: 'bot_stats',
  description:
    'Get current bot statistics: heap memory usage, process uptime, and the ' +
    'number of connected bot sessions across all platforms.',
  parameters: {
    type: 'object',
    properties: {},
  },
};

// ============================================================================
// TOOL RUN
// ============================================================================

export const run = async (): Promise<string> => {
  const heapStats = v8.getHeapStatistics();
  const usedMB = (process.memoryUsage().heapUsed / 1024 / 1024).toFixed(2);
  const totalMB = (heapStats.total_heap_size / 1024 / 1024).toFixed(2);
  const upSec = process.uptime();
  const hours = Math.floor(upSec / 3600);
  const minutes = Math.floor((upSec % 3600) / 60);

  return JSON.stringify({
    memoryUsedMB: parseFloat(usedMB),
    memoryTotalMB: parseFloat(totalMB),
    uptime: `${hours}h ${minutes}m`,
    connectedSessions: sessionManager.getActiveKeys().length,
  });
};
