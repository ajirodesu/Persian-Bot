/**
 * /uptime — Process Uptime & Live Resource Snapshot
 *
 * Displays how long the current Node.js process has been running alongside a
 * lightweight resource snapshot (memory, CPU load average) drawn exclusively
 * from Node.js built-in APIs — no external packages required.
 *
 * Data sources (all native):
 *   process.uptime()          — seconds since process start
 *   process.memoryUsage().rss — resident set size of the Node process in bytes
 *   os.totalmem() / freemem() — host total/available RAM
 *   os.loadavg()              — 1 / 5 / 15-minute load averages (POSIX only;
 *                               returns [0, 0, 0] on Windows — handled gracefully)
 *
 * Ping measurement: the displayed "Ping" used to be `Date.now() - ctx.startTime`,
 * i.e. everything from event receipt through this handler running — prefix parsing,
 * middleware, the isCommandEnabled() session/DB lookup, etc. Any of that (a cold
 * cache, a sleepy DB, a slow middleware added later) silently inflated the number
 * without reflecting an actual round-trip. Instead, the stats message is sent/edited
 * first with a placeholder, the real send/edit round-trip is timed, and a follow-up
 * edit fills in the real number — so "Ping" always reflects an actual measured
 * round-trip to the platform, not upstream pipeline time.
 */

import os from 'node:os';
import type { AppCtx } from '@/engine/types/controller.types.js';
import { Role } from '@/engine/constants/role.constants.js';
import { sessionManager } from '@/engine/modules/session/session-manager.lib.js';
import { MessageStyle } from '@/engine/constants/message-style.constants.js';
import { ButtonStyle } from '@/engine/constants/button-style.constants.js';
import { hasNativeButtons } from '@/engine/utils/ui-capabilities.util.js';
import type { CommandMeta } from '@/engine/types/module-config.types.js';

export const meta: CommandMeta = {
  name: 'uptime',
  aliases: [] as string[],
  version: '1.0.0',
  role: Role.ANYONE,
  author: 'John Lester',
  description:
    'Shows how long the bot has been running and a live resource snapshot',
  category: 'Info',
  usage: '',
  cooldown: 5,
  hasPrefix: true,
};

/**
 * Converts a raw byte value to a human-readable size string.
 * Uses 1024-based units (KiB, MiB, GiB) — matches what system monitors display.
 */
function formatBytes(bytes: number): string {
  const units = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
  let value = bytes;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex++;
  }
  // Show one decimal place only when the value is smaller than 10 to avoid "9.9 GB" → "10.0 GB" jitter
  const formatted =
    value < 10 && unitIndex > 0
      ? value.toFixed(1)
      : Math.round(value).toString();
  return `${formatted} ${units[unitIndex] ?? 'Bytes'}`;
}

const BUTTON_ID = { refresh: 'refresh' } as const;

// onCommand defined before button so button.refresh.onClick can reference it directly.
export const onCommand = async ({
  chat,
  native,
  event,
  button,
  session,
}: AppCtx): Promise<void> => {
  // process.uptime() returns fractional seconds since the Node.js process started
  const uptimeSeconds = process.uptime();
  const hours = Math.floor(uptimeSeconds / 3600);
  const minutes = Math.floor((uptimeSeconds % 3600) / 60);
  const seconds = Math.floor(uptimeSeconds % 60);

  // Zero-pad so "1:5:3" never appears — consistent HH:MM:SS format
  const pad = (n: number): string => String(n).padStart(2, '0');

  const mem = process.memoryUsage();
  const totalRam = os.totalmem();
  const freeRam = os.freemem();
  const usedRam = totalRam - freeRam;

  // os.loadavg() returns [1min, 5min, 15min] on POSIX; all zeros on Windows
  const [load1, load5, load15] = os.loadavg() as [number, number, number];
  // Windows guard — only show load when the platform actually reports it
  const loadLine =
    load1 > 0
      ? `❯ **CPU load (1/5/15 min):** ${load1.toFixed(2)} / ${load5.toFixed(2)} / ${load15.toFixed(2)}`
      : `❯ **CPU load:** N/A (Windows)`;

  // Build the session key from native context to look up the start time recorded by
  // sessionManager.markActive() — gives wall-clock age of this specific bot session
  // independently from process.uptime(), which resets only on full process restart.
  const sessionKey = `${native.userId ?? ''}:${native.platform}:${native.sessionId ?? ''}`;
  const botUptimeMs = sessionManager.getUptime(sessionKey);
  const botUptimeFmt = (() => {
    if (botUptimeMs === null) return 'unknown';
    const totalSecs = Math.floor(botUptimeMs / 1000);
    const bh = Math.floor(totalSecs / 3600);
    const bm = Math.floor((totalSecs % 3600) / 60);
    const bs = Math.floor(totalSecs % 60);
    return `${pad(bh)}h ${pad(bm)}m ${pad(bs)}s`;
  })();

  // Button only on platforms with native component support — FB Messenger text-menu
  // fallback would add unnecessary noise to a resource-metrics display.

  // Reuse active instance ID during interaction
  const buttonId =
    event['type'] === 'button_action'
      ? session.id
      : button.generateID({ id: BUTTON_ID.refresh, public: true });

  const buildMessage = (pingText: string): string =>
    [
      `⏱️ **Uptime:** ${pad(hours)}h ${pad(minutes)}m ${pad(seconds)}s`,
      `❯ **Bot session:** ${botUptimeFmt}`,
      '',
      `❯ **RAM (host)** — Total: ${formatBytes(totalRam)} | Used: ${formatBytes(usedRam)} | Free: ${formatBytes(freeRam)}`,
      `❯ **RAM (node)** — RSS: ${formatBytes(mem.rss)} | Heap used: ${formatBytes(mem.heapUsed)}`,
      loadLine,
      `❯ **Ping:** ${pingText}`,
    ].join('\n');

  const basePayload = {
    style: MessageStyle.MARKDOWN,
    ...(hasNativeButtons(native.platform) ? { button: [buttonId] } : {}),
  };

  // Step 1: send/edit with a placeholder, timing only this real network call.
  const pingStart = Date.now();
  let messageID: string;
  if (event['type'] === 'button_action') {
    messageID = event['messageID'] as string;
    await chat.editMessage({
      ...basePayload,
      message: buildMessage('Measuring...'),
      message_id_to_edit: messageID,
    });
  } else {
    const sent = await chat.replyMessage({
      ...basePayload,
      message: buildMessage('Measuring...'),
    });
    messageID = sent as string;
  }
  const latency = Date.now() - pingStart;

  // Step 2: fill in the real, measured round-trip time.
  await chat.editMessage({
    ...basePayload,
    message: buildMessage(`${latency}ms`),
    message_id_to_edit: messageID,
  });
};

// Placed after onCommand — const is initialized before this object literal evaluates,
// so onClick: onCommand is a valid reference at module load time.
export const button = {
  [BUTTON_ID.refresh]: {
    label: '🔄 Refresh',
    style: ButtonStyle.SECONDARY,
    // Re-invokes onCommand so the refresh response is identical to re-issuing /uptime.
    onClick: (ctx: AppCtx) => onCommand(ctx),
  },
};
