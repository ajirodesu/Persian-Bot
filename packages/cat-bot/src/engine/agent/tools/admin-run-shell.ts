/**
 * AI Agent — admin_run_shell tool
 *
 * SYSTEM ADMIN ONLY. Runs a shell command in the repository checkout — the
 * capability that lets the agent install dependencies (e.g. `npm install`),
 * run builds, or execute any repo-scoped command. The working directory is the
 * repository root (or a repo-relative `cwd`); commands run with the bot
 * process's privileges, so this tool is gated to system admins only. A timeout
 * (default 120s, max 600s) prevents hung processes, and captured output is
 * capped to keep replies bounded.
 */

import {
  exec,
  type ExecException,
} from 'node:child_process';
import { isAbsolute, relative, sep } from 'node:path';
import type { ToolMeta, ToolContext } from '../agent-tool.types.js';
import { requireSystemAdmin } from '../lib/admin-source-tools.lib.js';
import { getRepoRootOrThrow } from '@/server/lib/local-git.lib.js';

const MAX_OUTPUT_CHARS = 60_000;
const DEFAULT_TIMEOUT_SECONDS = 120;
const MAX_TIMEOUT_SECONDS = 600;

// ============================================================================
// TOOL DEFINITION
// ============================================================================

export const meta: ToolMeta = {
  name: 'admin_run_shell',
  description:
    'SYSTEM ADMIN ONLY — run a shell command inside the bot\u2019s git repository. ' +
    'Use this to install dependencies (e.g. "npm install"), run builds, or ' +
    'execute any repo-scoped command. The working directory is the repository ' +
    'root by default (or a repo-relative `cwd`). Returns the exit code and the ' +
    'captured output (stdout + stderr). Commands run with the same privileges ' +
    'as the bot process, so this tool is restricted to system administrators.',
  parameters: {
    type: 'object',
    properties: {
      command: {
        type: 'string',
        description:
          'The shell command to run, e.g. "npm install" or "npm run build". ' +
          'Pass a single command string exactly as you would type it in a terminal.',
      },
      cwd: {
        type: 'string',
        description:
          'Optional repository-relative working directory, e.g. ' +
          '"packages/cat-bot". Defaults to the repository root.',
      },
      timeoutSeconds: {
        type: 'number',
        description:
          'Optional timeout in seconds (default 120, max 600). Use a larger ' +
          'value for long-running installs/builds.',
      },
    },
    required: ['command'],
  },
  adminOnly: true,
};

// ============================================================================
// TOOL RUN
// ============================================================================

function capOutput(text: string): string {
  if (text.length <= MAX_OUTPUT_CHARS) return text;
  return (
    `... output truncated (${text.length} chars shown last ${MAX_OUTPUT_CHARS})\n\n` +
    text.slice(-MAX_OUTPUT_CHARS)
  );
}

export const initialize = async (
  {
    command,
    cwd,
    timeoutSeconds,
  }: { command?: string; cwd?: string; timeoutSeconds?: number },
  ctx: ToolContext,
): Promise<string> => {
  const denial = await requireSystemAdmin(ctx);
  if (denial) return denial;

  const cmd = String(command ?? '').trim();
  if (!cmd) {
    return 'No command provided — pass the shell command to run.';
  }

  let root: string;
  try {
    root = getRepoRootOrThrow();
  } catch (err) {
    return err instanceof Error ? err.message : String(err);
  }

  const rawCwd = String(cwd ?? '').trim();
  const workDir =
    rawCwd === ''
      ? root
      : root + sep + rawCwd.split(/[\\/]/).filter(Boolean).join(sep);
  const relPath = relative(root, workDir);
  if (isAbsolute(relPath) || relPath === '..' || relPath.startsWith(`..${sep}`)) {
    return `Refusing to run outside the repository — "${rawCwd}" is not inside ${root}.`;
  }
  const timeoutMs =
    Math.max(1, Math.min(MAX_TIMEOUT_SECONDS, Math.floor(timeoutSeconds ?? DEFAULT_TIMEOUT_SECONDS) || DEFAULT_TIMEOUT_SECONDS)) * 1000;

  return new Promise<string>((resolvePromise) => {
    exec(
      cmd,
      { cwd: workDir, timeout: timeoutMs, maxBuffer: MAX_OUTPUT_CHARS * 4, windowsHide: true },
      (error: ExecException | null, stdout: Buffer | string, stderr: Buffer | string) => {
        const out = (buf: Buffer | string): string =>
          typeof buf === 'string' ? buf : buf.toString('utf8');
        const errno = error as (ExecException & { code?: number | string }) | null;
        const timedOut = error !== null && errno?.signal === 'SIGTERM';
        const code = error === null ? 0 : typeof errno?.code === 'number' ? errno.code : null;
        const combined = capOutput(
          `${out(stdout).trimEnd()}${out(stderr) ? `\n${out(stderr).trimEnd()}` : ''}`.trim(),
        );

        if (timedOut) {
          resolvePromise(
            `Command timed out after ${timeoutMs / 1000}s and was killed.\n` +
              (combined ? `Partial output:\n${combined}` : 'No output was captured before the timeout.'),
          );
          return;
        }
        const statusLine = code === 0 ? 'Exit 0' : code === null ? 'Killed (no exit code)' : `Exit ${code}`;
        resolvePromise(
          `${statusLine}: ${cmd}${rawCwd === '' ? '' : ` (in ${rawCwd})`}\n` +
            (combined ? `\n${combined}` : '(no output)'),
        );
      },
    );
  });
};