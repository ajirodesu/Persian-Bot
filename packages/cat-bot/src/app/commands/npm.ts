/**
 * npm.ts — /npm — npm Package Lookup
 *
 * Fetches a package's public metadata from the official npm registry
 * (https://registry.npmjs.org). Adapted from mrepol742/project-canis into
 * Cat-Bot's native module contract (meta + onCommand), replacing the
 * previous popcat-api-backed /npm command (which lived inside
 * popcat-search.ts).
 *
 *   /npm express
 *   Bot: 📦 **express** `v5.2.1`
 *        ─────────────────
 *        Fast, unopinionated, minimalist web framework
 *        ─────────────────
 *        👤 Author · TJ Holowaychuk
 *        ...
 *        🔗 View on npm
 *
 * Author: AjiroDesu
 */

import axios from 'axios';
import type { AppCtx } from '@/engine/types/controller.types.js';
import { Role } from '@/engine/constants/role.constants.js';
import { MessageStyle } from '@/engine/constants/message-style.constants.js';
import { Platforms } from '@/engine/modules/platform/platform.constants.js';
import { OptionType } from '@/engine/modules/command/command-option.constants.js';
import type { CommandMeta } from '@/engine/types/module-meta.types.js';

/** Horizontal rule — matches the HR used in help.ts. */
const HR = '─────────────────';
/** Separator between a field label and its value. */
const SEP = ' · ';

// ── API contract ───────────────────────────────────────────────────────────

interface NpmRegistryResponse {
  name?: string;
  error?: string;
  'dist-tags'?: { latest?: string };
  versions?: Record<string, NpmVersion>;
  time?: Record<string, string>;
}

interface NpmVersion {
  version?: string;
  description?: string;
  author?: { name?: string } | string | null;
  homepage?: string;
  repository?: { url?: string } | string | null;
  license?: string | { type?: string };
}

// ── Formatting helpers ────────────────────────────────────────────────────

function orNA(value: string | number | null | undefined): string {
  if (value === null || value === undefined || value === '') return 'N/A';
  return String(value);
}

function row(label: string, value: string | number | null | undefined): string {
  return `${label}${SEP}${orNA(value)}`;
}

/** Extracts a human-readable author name from the registry's flexible shapes. */
function authorName(author: NpmVersion['author']): string {
  if (typeof author === 'string') return author;
  return author?.name ?? '';
}

/** Extracts a human-readable license string from the registry's flexible shapes. */
function licenseName(license: NpmVersion['license']): string {
  if (typeof license === 'string') return license;
  return license?.type ?? '';
}

/** Cleans "git+https://…" → "https://…" and strips a trailing ".git". */
function cleanRepoUrl(url: string): string {
  return url.replace(/^git\+/, '').replace(/\.git$/, '');
}

/** Human-readable date: "2025-12-01T20:49:43.268Z" → "Dec 1, 2025". */
function fmtDate(value: string | undefined): string {
  if (!value) return 'N/A';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

// ── Fetcher ───────────────────────────────────────────────────────────────

async function fetchPackage(
  name: string,
): Promise<{ data: NpmRegistryResponse; versionData: NpmVersion }> {
  const { data } = await axios.get<NpmRegistryResponse>(
    `https://registry.npmjs.org/${encodeURIComponent(name)}`,
    { timeout: 15_000 },
  );

  if (!data || data.error || !data['dist-tags']?.latest) {
    throw new Error(`No package found for "${name}".`);
  }

  const latest = data['dist-tags'].latest;
  const versionData = data.versions?.[latest];

  if (!versionData) {
    throw new Error(`No data found for package "${name}".`);
  }

  return { data, versionData };
}

// ── Config ────────────────────────────────────────────────────────────────

export const meta: CommandMeta = {
  name: 'npm',
  aliases: ['npmsearch'] as string[],
  version: '1.0.0',
  role: Role.ANYONE,
  author: 'AjiroDesu',
  description: 'Search for npm package information.',
  category: 'search',
  usage: '<package-name>',
  cooldown: 8,
  hasPrefix: true,
  platform: [Platforms.Discord, Platforms.Telegram, Platforms.Fluxer],
  options: [
    {
      type: OptionType.string,
      name: 'package',
      description: 'npm package name to look up',
      required: true,
    },
  ],
};

// ── Command Handler ───────────────────────────────────────────────────────

export const onCommand = async (ctx: AppCtx): Promise<void> => {
  const { chat, args, usage } = ctx;

  const query = args.join(' ').trim();

  if (!query) {
    await usage();
    return;
  }

  if (query.includes(' ')) {
    await chat.replyMessage({
      style: MessageStyle.MARKDOWN,
      message: 'Please provide a single package name without spaces.',
    });
    return;
  }

  try {
    const { data, versionData } = await fetchPackage(query);

    const name = orNA(data.name);
    const version = orNA(versionData.version);
    const description = versionData.description?.trim() || '';
    const author = authorName(versionData.author);
    const homepage = versionData.homepage;
    const repository = versionData.repository;
    const repoUrl =
      typeof repository === 'string' ? repository : (repository?.url ?? '');
    const license = licenseName(versionData.license);
    const lastPublished = data.time?.[data['dist-tags']!.latest!];

    const lines: string[] = [
      `📦 **${name}**${SEP}\`v${version}\``,
      HR,
    ];

    if (description) {
      lines.push(description);
      lines.push(HR);
    }

    lines.push(
      ...(author ? [row('👤 **Author**', author)] : []),
      ...(license ? [row('📄 **License**', license)] : []),
      ...(homepage ? [row('🌐 **Homepage**', homepage)] : []),
      ...(repoUrl ? [row('🔗 **Repository**', cleanRepoUrl(repoUrl))] : []),
      row('📅 **Last Published**', fmtDate(lastPublished)),
    );

    lines.push(HR);
    lines.push(`🔗 [View on npm](https://www.npmjs.com/package/${encodeURIComponent(name)})`);

    await chat.replyMessage({
      style: MessageStyle.MARKDOWN,
      message: lines.join('\n'),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await chat.replyMessage({
      style: MessageStyle.MARKDOWN,
      message: `⚠️ ${message}`,
    });
  }
};