/**
 * shell Tool — Execute a shell command on the host for the AI agent
 *
 * Ports project-canis's shell tool (mrepol742/project-canis
 * src/components/ai/tools/shell.ts) into Cat-Bot's native agent tool shape
 * (config + run, dynamically loaded by agent.ts).
 *
 * Security: mirrors the /shell command (Role.SYSTEM_ADMIN) — only global system
 * administrators may run arbitrary commands on the host. Commands execute via
 * child_process.exec inside a per-process workspace directory (the same CWD
 * confinement as project-canis's runDirect fallback); output is capped so long
 * results never overflow the LLM context.
 */

import { exec } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { AppCtx } from '@/engine/types/controller.types.js';
import { resolveAgentContext } from '../agent.util.js';
import { isSystemAdmin } from '@/engine/repos/system-admin.repo.js';
import { logger } from '@/engine/modules/logger/logger.lib.js';

/** Cap on returned output so long results never overflow the LLM context window. */
const MAX_OUTPUT = 4000;
/** How long a spawned command may run before it is killed. */
const EXEC_TIMEOUT_MS = 30_000;
/** Maximum bytes of stdout/stderr buffered from a single command. */
const MAX_BUFFER_BYTES = 1024 * 1024;
/** Per-process workspace for shell commands — created lazily on first run. */
const WORKSPACE_DIR = path.join(os.tmpdir(), 'cat-bot-agent-workspace');

// ============================================================================
// TOOL DEFINITION
// ============================================================================

export const config = {
  name: 'shell',
  description:
    'Execute a shell command on the bot host. Your working directory is the ' +
    'agent workspace. Output is truncated to 4000 characters. Restricted to ' +
    'system administrators only.',
  parameters: {
    type: 'object',
    properties: {
      command: {
        type: 'string',
        description:
          'The shell command to run. Example: `echo hello`, or ' +
          '`node -e "console.log(1 + 1)"`.',
      },
    },
    required: ['command'],
  },
};

// ============================================================================
// TOOL RUN
// ============================================================================

export const run = async (
  { command }: { command?: string },
  ctx: AppCtx,
): Promise<string> => {
  const { senderID } = resolveAgentContext(ctx);

  // ── Access gate — system admins only (mirrors the /shell command role) ─────
  // Fail-closed: an admin-status DB error denies rather than grants access.
  if (!senderID) {
    return '⛔ Could not identify the requesting user — access denied.';
  }
  try {
    if (!(await isSystemAdmin(senderID))) {
      return '⛔ This tool is restricted to system administrators.';
    }
  } catch {
    return '⛔ Could not verify system administrator privileges — access denied.';
  }

  const query = (command ?? '').trim();
  if (!query) return 'No command provided.';

  fs.mkdirSync(WORKSPACE_DIR, { recursive: true });

  return new Promise<string>((resolve) => {
    exec(
      query,
      {
        timeout: EXEC_TIMEOUT_MS,
        maxBuffer: MAX_BUFFER_BYTES,
        cwd: WORKSPACE_DIR,
        windowsHide: true,
      },
      (err, stdout, stderr) => {
        const errObj = (err ?? {}) as { code?: number; signal?: string };
        const out =
          [
            stdout.trim(),
            stderr.trim() ? `STDERR: ${stderr.trim()}` : '',
          ]
            .filter(Boolean)
            .join('\n') || '(no output)';

        const payload = {
          command: query,
          status: err ? 'error' : 'ok',
          exit_code: errObj.code ?? null,
          signal: errObj.signal ?? null,
          output: out.slice(0, MAX_OUTPUT),
        };

        if (err) {
          logger.error('[agent:shell] command failed', {
            command: query,
            error: err,
          });
        }
        resolve(JSON.stringify(payload));
      },
    );
  });
};
