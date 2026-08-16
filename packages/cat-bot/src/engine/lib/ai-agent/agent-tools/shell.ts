/**
 * AI Agent — shell tool (ported from canis src/components/ai/tools/shell.ts)
 *
 * Executes a shell command in the per-session workspace. When SANDBOXED is
 * enabled (Linux + bwrap on PATH) commands run inside a bubblewrap sandbox with
 * the host filesystem read-only and the workspace bind-mounted at
 * /tmp/workspace. Defaults to OFF for cross-platform safety.
 */

import { exec, spawn } from 'child_process';
import util from 'util';
import fs from 'fs';
import type { ToolMeta, ToolContext } from './types.js';

const execPromise = util.promisify(exec);
const MAX_OUTPUT = 2000;
const TIMEOUT_MS = 30_000;

// Hardcoded (no env vars): sandboxing is Linux-only + bwrap — OFF by default;
// the shell used to run commands.
const SANDBOXED = false;
const EXEC_SHELL = '/bin/bash';

// ============================================================================
// TOOL DEFINITION
// ============================================================================

export const meta: ToolMeta = {
  name: 'shell',
  description:
    "Execute a shell command in the agent's workspace. " +
    'All files you create go into the workspace. ' +
    'Use send_file to deliver a file from the workspace to the user. ' +
    'Network access is available (you can install packages with npm, pip, etc.).',
  parameters: {
    type: 'object',
    properties: {
      command: {
        type: 'string',
        description:
          'The shell command to run. Example: mkdir -p site && cat > site/index.html << EOF\\n<html>...</html>\\nEOF',
      },
    },
    required: ['command'],
  },
};

function collectOutput(stdout: string, stderr: string): string {
  const parts = [
    stdout.trim(),
    stderr.trim() ? `STDERR: ${stderr.trim()}` : '',
  ].filter(Boolean);
  return (parts.join('\n') || '(no output)').slice(0, MAX_OUTPUT);
}

/**
 * Run a command inside a bwrap sandbox (Linux only):
 * host filesystem read-only, fresh /tmp, workspace bind-mounted read-write as
 * /tmp/workspace, network kept, namespaces isolated.
 */
function runSandboxed(command: string, workspaceDir: string): Promise<string> {
  return new Promise((resolve) => {
    const bwrapArgs = [
      '--ro-bind',
      '/',
      '/',
      '--dev',
      '/dev',
      '--proc',
      '/proc',
      '--tmpfs',
      '/tmp',
      '--tmpfs',
      '/root',
      '--tmpfs',
      '/run',
      '--bind',
      workspaceDir,
      '/tmp/workspace',
      '--unshare-pid',
      '--unshare-uts',
      '--unshare-ipc',
      '--new-session',
      '--die-with-parent',
      EXEC_SHELL,
      '-c',
      `cd /tmp/workspace && timeout -k 1 28 ${command}`,
    ];

    const proc = spawn('bwrap', bwrapArgs, {
      timeout: TIMEOUT_MS,
      killSignal: 'SIGKILL',
    });

    let stdout = '';
    let stderr = '';
    proc.stdout.on('data', (d: Buffer) => {
      stdout += d.toString();
    });
    proc.stderr.on('data', (d: Buffer) => {
      stderr += d.toString();
    });

    proc.on('close', () => resolve(collectOutput(stdout, stderr)));
    proc.on('error', (err: Error) => resolve(`Sandbox error: ${err.message}`));
  });
}

/** Direct execution fallback (SANDBOXED=false) — CWD-confined to the workspace. */
async function runDirect(
  command: string,
  workspaceDir: string,
): Promise<string> {
  try {
    const { stdout, stderr } = await execPromise(command, {
      timeout: TIMEOUT_MS,
      maxBuffer: 1024 * 1024,
      shell: EXEC_SHELL,
      cwd: workspaceDir,
    });
    return collectOutput(stdout, stderr);
  } catch (err: unknown) {
    const e = err as {
      stdout?: string;
      stderr?: string;
      message?: string;
    };
    const out = [e.stdout?.trim() ?? '', e.stderr?.trim() ?? e.message ?? '']
      .filter(Boolean)
      .join('\n');
    return out.slice(0, MAX_OUTPUT);
  }
}

// ============================================================================
// TOOL RUN
// ============================================================================

export const initialize = async (
  { command }: { command?: string },
  ctx: ToolContext,
): Promise<string> => {
  const cmd = (command ?? '').trim();
  if (!cmd) return 'No command provided.';
  fs.mkdirSync(ctx.workspaceDir, { recursive: true });
  return SANDBOXED
    ? runSandboxed(cmd, ctx.workspaceDir)
    : runDirect(cmd, ctx.workspaceDir);
}
