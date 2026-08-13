/**
 * send_file Tool — Send a Local File to the User
 *
 * Converted from project-canis (src/components/ai/tools/sendFile.ts).
 * The original sends a local file in WhatsApp; Cat-Bot's equivalent is a
 * stream attachment delivered through replyMessage, which every platform
 * adapter uploads natively.
 *
 * Use this after creating files with the shell tool (commands run in the
 * per-process workspace, e.g. /tmp/cat-bot-agent-workspace). Accepts the
 * absolute path of any existing file — HTML, zip, images, PDFs, scripts,
 * etc. — plus an optional caption shown with the file.
 *
 * SECURITY: unlike the read-only info tools, send_file reads arbitrary
 * files off the server filesystem and ships them into a chat (an open
 * version would let anyone exfiltrate e.g. .env), so it is gated to the
 * bot's administrators only — the account owner's Bot Admins (Dashboard →
 * Settings) and global System Admins. Everyone else gets an explicit
 * access-denied string. The gate is fail-closed: a DB error during the
 * privilege check denies access.
 */

import fs from 'node:fs';
import path from 'node:path';

import type { AppCtx } from '@/engine/types/controller.types.js';
import { resolveAgentContext } from '../agent.util.js';
import { isBotAdmin } from '@/engine/repos/credentials.repo.js';
import { isSystemAdmin } from '@/engine/repos/system-admin.repo.js';
import type { NamedStreamAttachment } from '@/engine/adapters/models/interfaces/api.interfaces.js';
import { MessageStyle } from '@/engine/constants/message-style.constants.js';

// ============================================================================
// TOOL DEFINITION
// ============================================================================

export const config = {
  name: 'send_file',
  description:
    'Send a local file to the user. ' +
    'Use this after creating files with the shell tool. ' +
    'Supports any file type: HTML, zip, images, PDFs, scripts, etc. ' +
    'Pass the absolute path of the file to send, e.g. /tmp/cat-bot-agent-workspace/index.html, ' +
    'and an optional caption. ' +
    'Access is restricted to bot administrators and system administrators.',
  parameters: {
    type: 'object',
    properties: {
      path: {
        // ['string', 'null'] — models frequently pass null for skipped optional
        // args; Groq rejects a bare type: 'string' server-side (400
        // tool_use_failed) when the value is null.
        type: ['string', 'null'],
        description:
          'Absolute path to the file to send, e.g. /tmp/cat-bot-agent-workspace/index.html',
      },
      caption: {
        type: ['string', 'null'],
        description: 'Optional caption shown under the file in the chat',
      },
    },
    required: ['path'],
  },
};

// ============================================================================
// AUTHORIZATION (fail-closed)
// ============================================================================

async function isAuthorized(ctx: AppCtx): Promise<boolean> {
  const { senderID, sessionUserId, sessionId, platform } =
    resolveAgentContext(ctx);
  if (!senderID) return false;
  try {
    if (await isSystemAdmin(senderID)) return true;
  } catch {
    // fail-closed
  }
  if (sessionUserId && sessionId) {
    try {
      if (await isBotAdmin(sessionUserId, platform, sessionId, senderID))
        return true;
    } catch {
      // fail-closed
    }
  }
  return false;
}

// ============================================================================
// TOOL RUN
// ============================================================================

export const run = async (
  args: { path?: unknown; caption?: unknown },
  ctx: AppCtx,
): Promise<string> => {
  if (!(await isAuthorized(ctx))) {
    return '⛔ Access denied: the send_file tool is restricted to the bot administrator and system administrators.';
  }

  const filePath = typeof args.path === 'string' ? args.path.trim() : '';
  if (!filePath) {
    return 'No file path provided. Pass the absolute path of the file to send.';
  }
  const caption = typeof args.caption === 'string' ? args.caption.trim() : '';

  // Resolve and validate the target before reading anything.
  const resolved = path.resolve(filePath);
  let stat: fs.Stats;
  try {
    stat = await fs.promises.stat(resolved);
  } catch {
    return `File not found: ${filePath}`;
  }
  if (!stat.isFile()) {
    return `Not a file (or unreadable): ${filePath}`;
  }

  const threadID = (ctx.event['threadID'] as string) || '';
  if (!threadID) {
    return 'Could not resolve the current thread to send the file to.';
  }

  const name = path.basename(resolved);
  const attachment: NamedStreamAttachment = {
    name,
    stream: fs.createReadStream(resolved),
  };

  try {
    await ctx.api.replyMessage(threadID, {
      message: caption || `📎 Here is your file: **${name}**`,
      style: MessageStyle.MARKDOWN,
      attachment: [attachment],
    });
    return `File sent successfully. Filename: ${name}, size: ${stat.size} bytes.`;
  } catch (err) {
    return `Failed to send file: ${err instanceof Error ? err.message : String(err)}`;
  }
};
