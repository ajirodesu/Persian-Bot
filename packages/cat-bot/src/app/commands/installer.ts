/**
 * installer.ts — /installer — Install a command module straight from GitHub
 *
 * Fetches a single command file from the configured GitHub repository
 * (via the GitHub Contents API) and writes it into src/app/commands/, so a
 * new command can be dropped into a running bot without a manual git pull
 * or redeploy.
 *
 * Uses the same GitHub env vars already defined in env.config.ts for the
 * Admin File Manager:
 *   GITHUB_TOKEN       — personal access token (repo:contents read scope is enough)
 *   GITHUB_REPO_OWNER  — e.g. "AjiroDesu"
 *   GITHUB_REPO_NAME   — e.g. "cat-bot"
 *
 *   /installer ping
 *   Bot: ✅ Installed `ping.ts` from AjiroDesu/cat-bot@main.
 *        Restart the bot (or reload commands) to activate it.
 *
 * Restricted to SYSTEM_ADMIN — it writes files to disk on the host running
 * the bot process.
 *
 * Author: AjiroDesu
 */

import { writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import type { AppCtx } from '@/engine/types/controller.types.js';
import { Role } from '@/engine/constants/role.constants.js';
import { MessageStyle } from '@/engine/constants/message-style.constants.js';
import type { CommandMeta } from '@/engine/types/module-meta.types.js';
import { env } from '@/engine/config/env.config.js';
import { logger } from '@/engine/modules/logger/logger.lib.js';

// ── Config ────────────────────────────────────────────────────────────────────

/** Directory (relative to the cat-bot package root) that command modules live in. */
const COMMANDS_DIR = join('src', 'app', 'commands');

export const meta: CommandMeta = {
  name: 'installer',
  aliases: ['install', 'getcmd'] as string[],
  version: '1.0.0',
  role: Role.SYSTEM_ADMIN,
  author: 'AjiroDesu',
  description: 'Installs a command module from the configured GitHub repo.',
  category: 'system',
  usage: '<command-name> [path/in/repo.ts]',
  cooldown: 5,
  hasPrefix: true,
};

// ── Types ─────────────────────────────────────────────────────────────────────

interface GitHubContentResponse {
  type: 'file' | 'dir';
  name: string;
  path: string;
  sha: string;
  size: number;
  content?: string;
  encoding?: 'base64';
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Strips path traversal and anything but a safe lowercase command-style name. */
function sanitizeCommandName(raw: string): string | null {
  const name = raw.trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(name)) return null;
  return name;
}

/** Default branch used when reading files via the Contents API. */
const DEFAULT_BRANCH = 'main';

/** Builds the GitHub Contents API URL for a repo-relative file path. */
function buildContentsUrl(repoPath: string): string {
  const owner = env.GITHUB_REPO_OWNER;
  const repo = env.GITHUB_REPO_NAME;
  return `https://api.github.com/repos/${owner}/${repo}/contents/${repoPath}?ref=${DEFAULT_BRANCH}`;
}

/** Downloads and base64-decodes a single file's content via the Contents API. */
async function fetchRepoFile(repoPath: string): Promise<string> {
  const response = await fetch(buildContentsUrl(repoPath), {
    headers: {
      Accept: 'application/vnd.github+json',
      ...(env.GITHUB_TOKEN ? { Authorization: `Bearer ${env.GITHUB_TOKEN}` } : {}),
    },
  });

  if (response.status === 404) {
    throw new Error(`No file found at \`${repoPath}\` in the configured repo/branch.`);
  }
  if (!response.ok) {
    throw new Error(`GitHub API responded ${response.status} ${response.statusText}`);
  }

  const data = (await response.json()) as GitHubContentResponse;
  if (data.type !== 'file' || !data.content) {
    throw new Error(`\`${repoPath}\` is not a single file.`);
  }

  return Buffer.from(data.content, data.encoding ?? 'base64').toString('utf-8');
}

// ── Command Handler ───────────────────────────────────────────────────────────

export const onCommand = async ({ chat, args, prefix = '' }: AppCtx): Promise<void> => {
  const [rawName, explicitPath] = args;

  if (!rawName) {
    await chat.replyMessage({
      style: MessageStyle.MARKDOWN,
      message:
        `Please provide a command name to install.\n` +
        `» \`${prefix}installer <command-name> [path/in/repo.ts]\`\n` +
        `_Example: \`${prefix}installer ping\`_`,
    });
    return;
  }

  if (!env.GITHUB_REPO_OWNER || !env.GITHUB_REPO_NAME) {
    await chat.replyMessage({
      style: MessageStyle.MARKDOWN,
      message:
        '⚠️ GitHub is not configured. Set `GITHUB_REPO_OWNER` and `GITHUB_REPO_NAME` ' +
        '(and optionally `GITHUB_TOKEN` for private repos / higher rate limits) in your `.env`.',
    });
    return;
  }

  const commandName = sanitizeCommandName(rawName);
  if (!commandName) {
    await chat.replyMessage({
      style: MessageStyle.MARKDOWN,
      message:
        '⚠️ Invalid command name. Use lowercase letters, numbers, and hyphens only.',
    });
    return;
  }

  const repoPath = explicitPath ?? `packages/cat-bot/src/app/commands/${commandName}.ts`;
  const localPath = resolve(process.cwd(), COMMANDS_DIR, `${commandName}.ts`);

  if (existsSync(localPath)) {
    await chat.replyMessage({
      style: MessageStyle.MARKDOWN,
      message: `⚠️ \`${commandName}.ts\` already exists locally. Remove it first if you want to reinstall.`,
    });
    return;
  }

  try {
    const source = await fetchRepoFile(repoPath);

    await mkdir(dirname(localPath), { recursive: true });
    await writeFile(localPath, source, 'utf-8');

    await chat.replyMessage({
      style: MessageStyle.MARKDOWN,
      message:
        `✅ Installed \`${commandName}.ts\` from ` +
        `\`${env.GITHUB_REPO_OWNER}/${env.GITHUB_REPO_NAME}@${DEFAULT_BRANCH}\`.\n` +
        `Restart the bot (or reload commands) to activate it.`,
    });
    logger.info(`[installer] Installed command "${commandName}" from ${repoPath}`);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await chat.replyMessage({
      style: MessageStyle.MARKDOWN,
      message: `⚠️ **Install failed:** ${message}`,
    });
    logger.error(`[installer] Failed to install "${commandName}" from ${repoPath}`, { error: err });
  }
};
