/**
 * installer.ts — /installer — Install a command module from a file link
 *
 * Collects three fields via an onReply conversation flow and installs a
 * command module into src/app/commands/:
 *
 *   User: /installer
 *   Bot:  📦 Please provide the filename.
 *   User: [quotes the bot's message] ping
 *   Bot:  🔗 Please provide the file link.
 *   User: [quotes the bot's message] https://pastebin.com/raw/AbC123
 *   Bot:  ✏️ Please provide a commit message.
 *   User: [quotes the bot's message] Add ping command
 *   Bot:  ✅ Installed `ping.ts` · commit `a1b2c3d`
 *         Restart the bot (or reload commands) to activate it.
 *
 * The filename is stored with a `.ts` extension automatically — replying
 * `ping.ts` and `ping` both install `ping.ts`. The file link can be a
 * Pastebin link, a GitHub blob/raw link, or any direct URL; GitHub `/blob/`
 * links are rewritten to their raw form and Pastebin links get `/raw`
 * appended so the file content (not an HTML page) is downloaded.
 *
 * Once all three fields are collected the module is written to
 * `src/app/commands/<name>.ts`, staged, and committed with the provided
 * commit message via the same local-git lib the Admin Git tab uses.
 *
 * Restricted to SYSTEM_ADMIN — it writes files to disk on the host running
 * the bot process.
 *
 * Author: AjiroDesu
 */

import { writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import type { AppCtx } from '@/engine/types/controller.types.js';
import { Role } from '@/engine/constants/role.constants.js';
import { MessageStyle } from '@/engine/constants/message-style.constants.js';
import type { CommandMeta } from '@/engine/types/module-meta.types.js';
import { logger } from '@/engine/modules/logger/logger.lib.js';
import {
  getRepoRootOrThrow,
  normalizeRepoPath,
  stagePaths,
  commitStaged,
  RepoFileManagerError,
} from '@/server/lib/local-git.lib.js';

// ── Config ────────────────────────────────────────────────────────────────────

/** Directory (relative to the cat-bot package root) that command modules live in. */
const COMMANDS_DIR = join('src', 'app', 'commands');

/** Timeout for downloading the file from the provided link. */
const DOWNLOAD_TIMEOUT_MS = 15_000;

/**
 * True when the bot runs on a managed hosting platform (Render or Railway)
 * that auto-restarts the service on deploy — so a freshly installed command
 * takes effect automatically without a manual restart/reload.
 */
function isManagedHosting(): boolean {
  const env = process.env;
  return Boolean(
    env['RENDER'] ||
      env['RENDER_SERVICE_ID'] ||
      env['RAILWAY_PUBLIC_DOMAIN'] ||
      env['RAILWAY_SERVICE_ID'] ||
      env['RAILWAY_SERVICE_NAME'],
  );
}

export const meta: CommandMeta = {
  name: 'installer',
  aliases: ['install', 'getcmd'] as string[],
  version: '2.0.0',
  role: Role.SYSTEM_ADMIN,
  author: 'AjiroDesu',
  description: 'Installs a command module from a file link (Pastebin / GitHub) via an onReply flow.',
  category: 'system',
  usage: '',
  cooldown: 5,
  hasPrefix: true,
};

// ── Pending-flow states ───────────────────────────────────────────────────────

const STATE = {
  awaiting_filename: 'awaiting_filename',
  awaiting_link: 'awaiting_link',
  awaiting_commit_message: 'awaiting_commit_message',
} as const;

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Strips a trailing `.ts` so `ping` and `ping.ts` both yield the name `ping`. */
function stripTsExtension(raw: string): string {
  return raw.replace(/\.ts$/i, '');
}

/** Strips path traversal and anything but a safe lowercase command-style name. */
function sanitizeCommandName(raw: string): string | null {
  const name = stripTsExtension(raw.trim()).toLowerCase();
  if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(name)) return null;
  return name;
}

/** Loose http(s) URL check for the replied file link. */
function isValidFileLink(raw: string): boolean {
  const trimmed = raw.trim();
  if (!/^https?:\/\//i.test(trimmed)) return false;
  try {
    new URL(trimmed);
    return true;
  } catch {
    return false;
  }
}

/**
 * Rewrites GitHub blob / Pastebin links to their raw downloadable form so a
 * direct fetch returns the file content instead of an HTML page. Any other
 * URL is passed through untouched.
 */
function resolveRawFileUrl(raw: string): string {
  let url = raw.trim();

  // GitHub file pages embed the source in HTML — swap to the raw endpoint.
  if (/^https?:\/\/(www\.)?github\.com\//i.test(url)) {
    url = url.replace(/\/blob\//i, '/');
    url = url.replace(
      /^https?:\/\/(www\.)?github\.com\//i,
      'https://raw.githubusercontent.com/',
    );
  }

  // Pastebin serves the plain file under /raw/ — add it when missing.
  const pastebin = url.match(/^https?:\/\/(www\.)?pastebin\.com\/(?!raw\/)/i);
  if (pastebin) {
    const [prefix] = pastebin;
    url = url.replace(prefix, `${prefix}raw/`);
  }

  return url;
}

/** Downloads a raw file's text content from the (already raw-ified) link. */
async function fetchFileFromLink(link: string): Promise<string> {
  const response = await fetch(link, {
    headers: {
      'User-Agent': 'cat-bot/installer',
      Accept: 'text/plain, */*',
    },
    signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS),
    redirect: 'follow',
  });
  if (!response.ok) {
    throw new Error(
      `The link responded ${response.status} ${response.statusText}.`,
    );
  }
  const content = await response.text();
  if (!content.trim()) {
    throw new Error('The link returned an empty file.');
  }
  return content;
}

/**
 * Writes the downloaded source into the commands dir and commits it with the
 * provided commit message. Returns the new commit's short sha.
 */
async function installCommand(
  commandName: string,
  source: string,
  commitMessage: string,
): Promise<{ sha: string }> {
  const root = getRepoRootOrThrow();
  const localPath = resolve(process.cwd(), COMMANDS_DIR, `${commandName}.ts`);

  if (existsSync(localPath)) {
    throw new RepoFileManagerError(
      400,
      `\`${commandName}.ts\` already exists locally. Remove it first if you want to reinstall.`,
    );
  }

  await mkdir(dirname(localPath), { recursive: true });
  await writeFile(localPath, source, 'utf-8');

  // Stage the new file relative to the git repo root (forward slashes even on Windows).
  const repoPath = normalizeRepoPath(relative(root, localPath).replace(/\\/g, '/'));
  await stagePaths([repoPath]);

  let sha: string;
  try {
    ({ sha } = await commitStaged(commitMessage));
  } catch (err) {
    if (err instanceof RepoFileManagerError && /nothing staged/i.test(err.message)) {
      throw new RepoFileManagerError(
        400,
        `\`${commandName}.ts\` was written, but its content matches an already-committed file — nothing to commit.`,
      );
    }
    throw err;
  }

  return { sha };
}

// ── Command Handler — step 1: request the filename ────────────────────────────

export const onCommand = async ({ chat, state }: AppCtx): Promise<void> => {
  // Fail fast if there's no git checkout configured — no point collecting
  // three fields the command can't commit at the end.
  try {
    getRepoRootOrThrow();
  } catch (err) {
    const error = err as { message?: string };
    await chat.replyMessage({
      style: MessageStyle.MARKDOWN,
      message: `❌ ${error.message ?? 'No git repository is configured for installing.'}`,
    });
    return;
  }

  const messageID = await chat.replyMessage({
    style: MessageStyle.MARKDOWN,
    message: [
      '📦 **Install a command from a file link**',
      'Please provide the filename.',
      '',
      '_The extension is set to `.ts` automatically — reply with just the name (e.g. `ping`)._',
    ].join('\n'),
  });

  // Guard: platforms that do not return a message ID from replyMessage cannot
  // support onReply because there is no stable key to register the state on.
  if (!messageID) {
    await chat.replyMessage({
      style: MessageStyle.MARKDOWN,
      message:
        '❌ Installer unavailable: this platform did not return a message ID from replyMessage().',
    });
    return;
  }

  state.create({
    id: state.generateID({ id: String(messageID) }),
    state: STATE.awaiting_filename,
    context: {},
  });
};

// ── Reply Handlers ────────────────────────────────────────────────────────────

export const onReply = {
  // Step 2: collect the filename, then request the file link.
  [STATE.awaiting_filename]: async ({
    chat,
    session,
    state,
    event,
  }: AppCtx): Promise<void> => {
    // Remove the pending state before replying so a second quote on the same
    // prompt cannot re-trigger the handler after the step is complete.
    state.delete(session.id);

    const commandName = sanitizeCommandName(String(event['message'] ?? ''));

    if (!commandName) {
      const retryID = await chat.replyMessage({
        style: MessageStyle.MARKDOWN,
        message:
          '⚠️ **Invalid filename.**\nPlease provide the filename — lowercase letters, numbers, and hyphens only (e.g. `ping`).',
      });
      if (retryID) {
        state.create({
          id: state.generateID({ id: String(retryID) }),
          state: STATE.awaiting_filename,
          context: {},
        });
      }
      return;
    }

    const localPath = resolve(process.cwd(), COMMANDS_DIR, `${commandName}.ts`);
    if (existsSync(localPath)) {
      await chat.replyMessage({
        style: MessageStyle.MARKDOWN,
        message:
          `⚠️ \`${commandName}.ts\` already exists locally. Remove it first if you want to reinstall — run \`/installer\` again.`,
      });
      return;
    }

    const messageID = await chat.replyMessage({
      style: MessageStyle.MARKDOWN,
      message: '🔗 Please provide the file link (e.g. a Pastebin or GitHub link).',
    });
    if (!messageID) {
      await chat.replyMessage({
        style: MessageStyle.MARKDOWN,
        message:
          '❌ Installer unavailable: this platform did not return a message ID from replyMessage().',
      });
      return;
    }

    state.create({
      id: state.generateID({ id: String(messageID) }),
      state: STATE.awaiting_link,
      // Carry the filename forward to the link step.
      context: { commandName },
    });
  },

  // Step 3: collect the file link, then request the commit message.
  [STATE.awaiting_link]: async ({
    chat,
    session,
    state,
    event,
  }: AppCtx): Promise<void> => {
    state.delete(session.id);

    const commandName = String(session.context['commandName'] ?? '').trim();
    const rawLink = String(event['message'] ?? '').trim();

    if (!commandName) {
      await chat.replyMessage({
        style: MessageStyle.MARKDOWN,
        message: '❌ Installer expired — run `/installer` to start over.',
      });
      return;
    }

    if (!isValidFileLink(rawLink)) {
      const retryID = await chat.replyMessage({
        style: MessageStyle.MARKDOWN,
        message:
          '⚠️ **Invalid link.**\nPlease provide the file link — a Pastebin link, a GitHub link, or any direct `https://` URL to the file.',
      });
      if (retryID) {
        state.create({
          id: state.generateID({ id: String(retryID) }),
          state: STATE.awaiting_link,
          context: { commandName },
        });
      }
      return;
    }

    const fileLink = resolveRawFileUrl(rawLink);

    const messageID = await chat.replyMessage({
      style: MessageStyle.MARKDOWN,
      message: '✏️ Please provide a commit message.',
    });
    if (!messageID) {
      await chat.replyMessage({
        style: MessageStyle.MARKDOWN,
        message:
          '❌ Installer unavailable: this platform did not return a message ID from replyMessage().',
      });
      return;
    }

    state.create({
      id: state.generateID({ id: String(messageID) }),
      state: STATE.awaiting_commit_message,
      // Carry the filename + resolved link forward to the commit-message step.
      context: { commandName, fileLink },
    });
  },

  // Step 4: collect the commit message, then download + install + commit.
  [STATE.awaiting_commit_message]: async ({
    chat,
    session,
    state,
    event,
  }: AppCtx): Promise<void> => {
    state.delete(session.id);

    const commandName = String(session.context['commandName'] ?? '').trim();
    const fileLink = String(session.context['fileLink'] ?? '').trim();
    const commitMessage = String(event['message'] ?? '').trim();

    if (!commandName || !fileLink) {
      await chat.replyMessage({
        style: MessageStyle.MARKDOWN,
        message: '❌ Installer expired — run `/installer` to start over.',
      });
      return;
    }

    if (!commitMessage) {
      const retryID = await chat.replyMessage({
        style: MessageStyle.MARKDOWN,
        message:
          '⚠️ **Missing commit message.**\nPlease provide a commit message describing the new command.',
      });
      if (retryID) {
        state.create({
          id: state.generateID({ id: String(retryID) }),
          state: STATE.awaiting_commit_message,
          context: { commandName, fileLink },
        });
      }
      return;
    }

    try {
      const source = await fetchFileFromLink(fileLink);
      const { sha } = await installCommand(commandName, source, commitMessage);

      const activateHint = isManagedHosting()
        ? 'The bot will restart in a few minutes to apply these changes.'
        : 'Restart the bot (or reload commands) to activate it.';
      await chat.replyMessage({
        style: MessageStyle.MARKDOWN,
        message: [
          `✅ **Installed \`${commandName}.ts\`** · commit \`${sha || '(unknown)'}\``,
          activateHint,
        ].join('\n'),
      });
      logger.info(
        `[installer] Installed command "${commandName}" from ${fileLink} (${sha || 'commit unknown'})`,
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await chat.replyMessage({
        style: MessageStyle.MARKDOWN,
        message: `⚠️ **Install failed:** ${message}`,
      });
      logger.error(`[installer] Failed to install "${commandName}" from ${fileLink}`, {
        error: err,
      });
    }
  },
};
