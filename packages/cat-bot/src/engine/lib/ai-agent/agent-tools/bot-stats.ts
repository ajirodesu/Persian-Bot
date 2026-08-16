/**
 * AI Agent — bot_stats tool (ported from canis src/components/ai/tools/botStats.ts)
 */

import v8 from 'v8';
import type { ToolMeta, ToolContext } from '../agent-tool.types.js';

// ============================================================================
// TOOL DEFINITION
// ============================================================================

export const meta: ToolMeta = {
  name: 'bot_stats',
  description:
    'Get current bot statistics: heap memory usage, process uptime, and number of active sessions.',
  parameters: {
    type: 'object',
    properties: {},
  },
};

// ============================================================================
// TOOL RUN
// ============================================================================

export const initialize = async (
  _args: Record<string, unknown>,
  _ctx: ToolContext,
): Promise<string> => {
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
  });
};
