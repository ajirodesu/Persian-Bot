/**
 * /fork — Fork Cat-Bot on GitHub
 *
 * Presents the Cat-Bot source repository as a polished, share-ready card:
 * live GitHub stats (stars, forks, watchers, open issues, language, license,
 * last commit), the official social-preview banner as an attachment, and a
 * short step-by-step guide for forking + cloning the project.
 *
 * Stats are fetched live from the public GitHub REST API on every invocation
 * (no auth token required — well within the unauthenticated rate limit for a
 * single-repo lookup). If the API is unreachable or rate-limited, the card
 * degrades gracefully to a static fallback so the command never hard-fails.
 */

import type { AppCtx } from '@/engine/types/controller.types.js';
import { Role } from '@/engine/constants/role.constants.js';
import { MessageStyle } from '@/engine/constants/message-style.constants.js';
import type { CommandMeta } from '@/engine/types/module-config.types.js';

// ── Command Config ────────────────────────────────────────────────────────────

export const meta: CommandMeta = {
  name: 'fork',
  aliases: ['sourcecode', 'repo', 'source'] as string[],
  version: '1.0.0',
  role: Role.ANYONE,
  author: 'AjiroDesu',
  description: 'Shows the Cat-Bot source repository and how to fork it.',
  category: 'Info',
  usage: '',
  cooldown: 10,
  hasPrefix: true,
};

// ── Constants ────────────────────────────────────────────────────────────────

const REPO_OWNER = 'ajirodesu';
const REPO_NAME = 'Persian-Bot';
const REPO_URL = `https://github.com/${REPO_OWNER}/${REPO_NAME}`;
const REPO_API_URL = `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}`;
const BANNER_URL = `https://opengraph.githubassets.com/1/${REPO_OWNER}/${REPO_NAME}`;

interface GitHubRepo {
  full_name: string;
  description: string | null;
  html_url: string;
  stargazers_count: number;
  forks_count: number;
  subscribers_count: number;
  open_issues_count: number;
  language: string | null;
  license: { name: string } | null;
  default_branch: string;
  pushed_at: string;
  archived: boolean;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Compacts large counts (1234 → "1.2k", 1_200_000 → "1.2M"). */
function formatCount(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1).replace(/\.0$/, '')}k`;
  return String(n);
}

/** Renders an ISO timestamp as a coarse "time ago" string. */
function timeAgo(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diffMs / 60_000);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months}mo ago`;
  return `${Math.floor(months / 12)}y ago`;
}

/** Builds the markdown card body from live repo data. */
function buildLiveCard(repo: GitHubRepo): string {
  const description =
    repo.description?.trim() ||
    'A multi-platform (Discord, Telegram, Webchat) bot engine with canvas-based image generation, an AI agent, and a full-stack dashboard.';

  return [
    `🍴 **Fork Cat-Bot**`,
    ``,
    `${description}`,
    ``,
    `**— Repository Stats —**`,
    `⭐ **Stars:** ${formatCount(repo.stargazers_count)}`,
    `🍴 **Forks:** ${formatCount(repo.forks_count)}`,
    `👁️ **Watchers:** ${formatCount(repo.subscribers_count)}`,
    `🐛 **Open Issues:** ${formatCount(repo.open_issues_count)}`,
    `🧠 **Language:** ${repo.language ?? 'TypeScript'}`,
    `📄 **License:** ${repo.license?.name ?? 'Not specified'}`,
    `🌿 **Default Branch:** \`${repo.default_branch}\``,
    `🕒 **Last Push:** ${timeAgo(repo.pushed_at)}`,
    ``,
    `**— How to Fork —**`,
    `1️⃣ Open the repository link below.`,
    `2️⃣ Click the **Fork** button in the top-right corner of GitHub.`,
    `3️⃣ Choose your account/organization as the destination.`,
    `4️⃣ Clone your fork: \`git clone https://github.com/<your-username>/${REPO_NAME}.git\``,
    `5️⃣ Track upstream: \`git remote add upstream ${REPO_URL}.git\``,
    ``,
    `🔗 **Repository:** ${REPO_URL}`,
    ``,
    `💡 _Enjoying Cat-Bot? A star on the repo helps others discover it!_`,
  ].join('\n');
}

/** Static fallback card used when the GitHub API call fails. */
function buildFallbackCard(): string {
  return [
    `🍴 **Fork Cat-Bot**`,
    ``,
    `A multi-platform (Discord, Telegram, Webchat) bot engine with canvas-based image generation, an AI agent, and a full-stack dashboard.`,
    ``,
    `**— How to Fork —**`,
    `1️⃣ Open the repository link below.`,
    `2️⃣ Click the **Fork** button in the top-right corner of GitHub.`,
    `3️⃣ Choose your account/organization as the destination.`,
    `4️⃣ Clone your fork: \`git clone https://github.com/<your-username>/${REPO_NAME}.git\``,
    `5️⃣ Track upstream: \`git remote add upstream ${REPO_URL}.git\``,
    ``,
    `🔗 **Repository:** ${REPO_URL}`,
    ``,
    `⚠️ _Live stats are temporarily unavailable — showing repository info only._`,
  ].join('\n');
}

async function buildForkCard(): Promise<string> {
  try {
    const response = await fetch(REPO_API_URL, {
      headers: { Accept: 'application/vnd.github+json' },
    });
    if (!response.ok) throw new Error(`GitHub API responded ${response.status}`);
    const repo = (await response.json()) as GitHubRepo;
    return buildLiveCard(repo);
  } catch {
    return buildFallbackCard();
  }
}

// ── Command Handler ───────────────────────────────────────────────────────────

export const onCommand = async (ctx: AppCtx): Promise<void> => {
  const { chat } = ctx;

  try {
    const message = await buildForkCard();
    const basePayload = { style: MessageStyle.MARKDOWN, message };

    try {
      // Best-effort: attach the live GitHub social-preview banner. This image
      // is generated on-the-fly by opengraph.githubassets.com and occasionally
      // rate-limits (429) or times out — that shouldn't break the command.
      await chat.replyMessage({
        ...basePayload,
        attachment_url: [{ name: 'cat-bot-fork-banner.png', url: BANNER_URL }],
      });
    } catch {
      // Retry without the banner attachment — text-only degrade.
      await chat.replyMessage(basePayload);
    }
  } catch (err) {
    const error = err as { message?: string };
    await chat.replyMessage({
      style: MessageStyle.MARKDOWN,
      message: `⚠️ **Error:** ${error.message ?? 'Unknown error'}`,
    });
  }
};