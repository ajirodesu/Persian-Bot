/**
 * shell.ts — /shell — Execute a shell command and return its output
 *
 * Ports the `zsh` command from mrepol742/project-canis
 * (https://github.com/mrepol742/project-canis/blob/master/src/commands/zsh.ts)
 * into Cat-Bot's native module contract (meta + onCommand).
 *
 * Restricted to system admins (Role.SYSTEM_ADMIN) because it runs arbitrary
 * commands on the host machine. Output is capped at 4000 characters so long
 * command results cannot exceed chat platform message limits; the cap mirrors
 * the original zsh command's truncation behaviour.
 *
 *   /shell ls -la
 *   Bot: drwxr-xr-x  9 user staff   288 May  1 12:00 .
 *        ...
 *
 * Author: AjiroDesu
 */

import { exec } from 'node:child_process';
import type { AppCtx } from '@/engine/types/controller.types.js';
import { Role } from '@/engine/constants/role.constants.js';
import { MessageStyle } from '@/engine/constants/message-style.constants.js';
import { logger } from '@/engine/modules/logger/logger.lib.js';
import type { CommandMeta } from '@/engine/types/module-meta.types.js';

/** Maximum reply length — matches the truncation limit of the original zsh command. */
const MAX_OUTPUT_LENGTH = 4000;
/** How long a spawned command may run before it is killed. */
const EXEC_TIMEOUT_MS = 30_000;
/** Maximum bytes of stdout/stderr buffered from a single command. */
const MAX_BUFFER_BYTES = 1024 * 1024;

/** Cuts a command's combined output down to the chat platform message limit. */
function truncateOutput(raw: string): string {
  if (raw.length <= MAX_OUTPUT_LENGTH) return raw;
  return `${raw.slice(0, MAX_OUTPUT_LENGTH)}\n\n[Output truncated]`;
}

/**
 * Runs a command through the host shell and resolves with its captured output.
 *
 * Wraps the callback form of child_process.exec (the same shape used by
 * server/lib/local-git.lib.ts) so the merged stdout/stderr contract is typed
 * explicitly — `util.promisify(exec)` overloads are fragile under this repo's
 * strict tsconfig settings. Node attaches `.stdout`/`.stderr` to the error
 * object when the command fails, which the caller's catch block reads back.
 */
function execCommand(
  query: string,
): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolvePromise, reject) => {
    exec(
      query,
      {
        timeout: EXEC_TIMEOUT_MS,
        maxBuffer: MAX_BUFFER_BYTES,
        windowsHide: true,
      },
      (err, stdout, stderr) => {
        if (err) {
          reject(err);
          return;
        }
        resolvePromise({ stdout, stderr });
      },
    );
  });
}

export const meta: CommandMeta = {
  name: 'shell',
  aliases: ['terminal'] as string[],
  version: '1.0.0',
  role: Role.SYSTEM_ADMIN,
  author: 'AjiroDesu',
  description: 'Execute a shell command and return the output.',
  category: 'system',
  usage: '<command>',
  cooldown: 5,
  hasPrefix: true,
};

export const onCommand = async ({
  chat,
  args,
  prefix = '',
}: AppCtx): Promise<void> => {
  const query = args.join(' ').trim();

  if (query.length === 0) {
    await chat.replyMessage({
      style: MessageStyle.MARKDOWN,
      message: `Please provide a command.\n» \`${prefix}shell <command>\`\n_Example: \`${prefix}shell ls -la\`_`,
    });
    return;
  }

  try {
    const { stdout, stderr } = await execCommand(query);

    // Command succeeded but produced no output at all — surface a confirmation
    // instead of echoing a blank reply.
    let response = `${stdout}\n\n${stderr}`;
    if (response.trim().length === 0) {
      response = '✅ Command completed with no output.';
    } else {
      response = truncateOutput(response);
    }

    // TEXT style: arbitrary shell output may contain markdown metacharacters
    // (e.g. `_ * [ ]`), which would break Telegram MarkdownV2 parsing.
    await chat.replyMessage({
      style: MessageStyle.TEXT,
      message: response,
    });
    logger.info(`[shell] Executed command: ${query}`);
  } catch (err) {
    // Node attaches captured stdout/stderr to the error object on a failed exec.
    const { stdout = '', stderr = '' } = (err ?? {}) as {
      stdout?: string;
      stderr?: string;
    };
    const errMessage = err instanceof Error ? err.message : String(err);

    let response = stderr || errMessage || 'Unknown error.';
    if (stdout) response = `${stdout}\n\n${response}`;
    response = truncateOutput(response);

    await chat.replyMessage({
      style: MessageStyle.TEXT,
      message: response,
    });
    logger.error(`[shell] Error executing command: ${query}`, { error: err });
  }
};
