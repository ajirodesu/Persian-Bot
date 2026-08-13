/**
 * shell Tool — Sandboxed Command Execution (Admin Only)
 *
 * Converted from project-canis (src/components/ai/tools/shell.ts).
 *
 * Executes a shell command in a confined workspace directory with a hard
 * timeout. The original wraps execution in a bwrap sandbox; Cat-Bot mirrors
 * that when the operator sets AGENT_SANDBOX=true AND bwrap is installed on the
 * host (Linux) — otherwise it falls back to direct execution confined to a
 * per-process temp workspace with the same timeout/output caps. This keeps the
 * tool 100% available on every platform instead of failing when the sandbox
 * binary is absent.
 *
 * SECURITY: unlike the other tools, shell grants arbitrary process execution,
 * so it is gated to the bot's administrators only — the account owner's Bot
 * Admins (Dashboard → Settings) and global System Admins. Everyone else gets
 * an explicit access-denied string. The gate is fail-closed: a DB error during
 * the privilege check denies access.
 */

import { exec, spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

import type { AppCtx } from '@/engine/types/controller.types.js';
import { resolveAgentContext } from '../agent.util.js';
import { isBotAdmin } from '@/engine/repos/credentials.repo.js';
import { isSystemAdmin } from '@/engine/repos/system-admin.repo.js';
import { env } from '@/engine/config/env.config.js';

// ============================================================================
// CONSTANTS
// ============================================================================

const MAX_OUTPUT = 2_000;
const TIMEOUT_MS = 30_000;
const WORKSPACE_DIR = path.join(os.tmpdir(), 'cat-bot-agent-workspace');

// ============================================================================
// OUTPUT HELPERS (pure — unit tested)
// ============================================================================

/**
 * Strips ANSI escape sequences (colors, cursor moves) so raw command output
 * reads cleanly to the LLM. Scans char-by-char instead of using a control
 * escape in a regex (no-control-regex lint rule).
 */
export function stripAnsi(text: string): string {
  let out = '';
  let inEscape = false;
  for (const ch of text) {
    if (ch === '\u001B') {
      inEscape = true;
      continue;
    }
    if (inEscape) {
      // CSI sequences end at an alphabetic byte
      if (/[A-Za-z]/.test(ch)) inEscape = false;
      continue;
    }
    out += ch;
  }
  return out;
}

/** Combines stdout + stderr into one LLM-friendly string, capped at MAX_OUTPUT. */
export function collectOutput(stdout: string, stderr: string): string {
  const out = stripAnsi(stdout).trim();
  const err = stripAnsi(stderr).trim();
  const parts = [out, err ? `STDERR: ${err}` : ''].filter(Boolean);
  const joined = parts.join('\n') || '(no output)';
  return joined.length > MAX_OUTPUT ? joined.slice(0, MAX_OUTPUT) : joined;
}

// ============================================================================
// TOOL DEFINITION
// ============================================================================

export const config = {
  name: 'shell',
  description:
    'Execute a shell command on the bot server (administrators only). ' +
    'Commands run in a confined workspace directory with a 30-second timeout. ' +
    'Returns the command output (stdout + stderr). Use for file inspection, ' +
    'package metadata, git status, or any server-side task the user requests. ' +
    'Access is restricted to bot administrators and system administrators.',
  parameters: {
    type: 'object',
    properties: {
      command: {
        type: ['string', 'null'],
        description:
          "The shell command to run. Example: ls -la /tmp/cat-bot-agent-workspace",
      },
    },
    required: ['command'],
  },
};

// ============================================================================
// EXECUTION ENGINE
// ============================================================================

const execAsync = promisify(exec);

function resolveShell(): string {
  if (process.platform === 'win32') return process.env.ComSpec ?? 'cmd.exe';
  return process.env.SHELL || '/bin/sh';
}

function ensureWorkspace(): string {
  fs.mkdirSync(WORKSPACE_DIR, { recursive: true });
  return WORKSPACE_DIR;
}

/** Probes once whether bwrap is installed; cached for the process lifetime. */
let bwrapAvailable: boolean | null = null;
function isBwrapAvailable(): boolean {
  if (bwrapAvailable === null) {
    try {
      const probe = spawnSync('bwrap', ['--version'], { timeout: 5_000 });
      bwrapAvailable = probe.status === 0;
    } catch {
      bwrapAvailable = false;
    }
  }
  return bwrapAvailable;
}

/** Direct execution — CWD confined to the workspace, hard timeout, output caps. */
async function runDirect(command: string, workspaceDir: string, shell: string): Promise<string> {
  try {
    const { stdout, stderr } = await execAsync(command, {
      timeout: TIMEOUT_MS,
      maxBuffer: 1024 * 1024,
      cwd: workspaceDir,
      shell,
      windowsHide: true,
    });
    return collectOutput(stdout, stderr);
  } catch (err) {
    const e = err as { stdout?: string; stderr?: string; message?: string };
    const out = [
      e.stdout?.trim() ?? '',
      e.stderr?.trim() ?? '',
      e.message ? `ERROR: ${e.message.trim()}` : '',
    ]
      .filter(Boolean)
      .join('\n');
    return out.slice(0, MAX_OUTPUT) || '(no output)';
  }
}

/**
 * bwrap sandbox (mirrors project-canis): host filesystem read-only, fresh
 * tmpfs for /tmp /root /run, workspace bind-mounted at /tmp/workspace, PID/IPC/
 * UTS namespaces isolated, network kept, hard SIGKILL after TIMEOUT_MS.
 */
function runSandboxed(command: string, workspaceDir: string, shell: string): Promise<string> {
  return new Promise((resolve) => {
    const bwrapArgs = [
      '--ro-bind', '/', '/',
      '--dev', '/dev',
      '--proc', '/proc',
      '--tmpfs', '/tmp',
      '--tmpfs', '/root',
      '--tmpfs', '/run',
      '--bind', workspaceDir, '/tmp/workspace',
      '--unshare-pid',
      '--unshare-uts',
      '--unshare-ipc',
      '--new-session',
      '--die-with-parent',
      shell, '-c',
      `cd /tmp/workspace && timeout -k 1 28 ${command}`,
    ];
    const proc = spawn('bwrap', bwrapArgs, {
      timeout: TIMEOUT_MS,
      killSignal: 'SIGKILL',
    });
    let stdout = '';
    let stderr = '';
    proc.stdout?.on('data', (d: Buffer) => {
      stdout += d.toString();
    });
    proc.stderr?.on('data', (d: Buffer) => {
      stderr += d.toString();
    });
    proc.on('close', () => resolve(collectOutput(stdout, stderr)));
    proc.on('error', (err: Error) => resolve(`Sandbox error: ${err.message}`));
  });
}

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
  args: { command?: unknown },
  ctx: AppCtx,
): Promise<string> => {
  if (!(await isAuthorized(ctx))) {
    return '⛔ Access denied: the shell tool is restricted to the bot administrator and system administrators.';
  }

  const command = typeof args.command === 'string' ? args.command.trim() : '';
  if (!command) return 'No command provided.';

  const workspaceDir = ensureWorkspace();
  const shell = resolveShell();
  const sandboxEnabled = env.AGENT_SANDBOX === 'true';

  if (sandboxEnabled && isBwrapAvailable()) {
    return runSandboxed(command, workspaceDir, shell);
  }

  const output = await runDirect(command, workspaceDir, shell);
  if (sandboxEnabled) {
    return (
      '[note: AGENT_SANDBOX=true but bwrap is not installed — ran without ' +
      `sandbox isolation]\n${output}`
    );
  }
  return output;
};
