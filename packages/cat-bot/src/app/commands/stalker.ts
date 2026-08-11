/**
 * stalker.ts — Social Profile Stalker (multi-command family, config-driven)
 *
 * Four profile-lookup commands backed by the NexRay stalker API
 * (https://api.nexray.eu.cc/stalker/...). Same architecture as youtube.ts:
 * one STALKER_CONFIGS table declares each command's endpoint + response
 * formatter, and one shared runStalker() dispatches on that config.
 *
 * ── Commands ──────────────────────────────────────────────────────────────
 *   /github <username>       — GitHub profile lookup (aliases: gh)
 *   /threadsstalk <username> — Threads profile lookup (aliases: threads)
 *   /xstalk <username>       — X / Twitter profile lookup (aliases: twitter)
 *   /ytstalk <username>      — YouTube channel lookup (aliases: youtube)
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

// ── Shared response envelope ──────────────────────────────────────────────

interface StalkerResponse<T> {
  status?: boolean;
  error?: string;
  result?: T | null;
}

// ── Per-platform result shapes ────────────────────────────────────────────

interface GithubResult {
  username?: string;
  nickname?: string;
  bio?: string | null;
  id?: number;
  profile_pic?: string;
  url?: string;
  type?: string;
  company?: string | null;
  location?: string | null;
  email?: string | null;
  public_repo?: number;
  public_gists?: number;
  followers?: number;
  following?: number;
  created_at?: string;
  updated_at?: string;
}

interface ThreadsResult {
  id?: string;
  username?: string;
  name?: string;
  bio?: string;
  profile_picture?: string;
  is_verified?: boolean;
  followers?: number;
  links?: unknown[];
}

interface TwitterResult {
  id?: string;
  username?: string;
  name?: string;
  verified?: boolean;
  description?: string;
  location?: string;
  created_at?: string;
  stats?: {
    tweets?: number;
    following?: number;
    followers?: number;
    likes?: number;
    media?: number;
  };
  profile?: {
    avatar?: string;
    banner?: string;
  };
}

interface YoutubeResult {
  channel?: {
    username?: string;
    name?: string | null;
    subscriberCount?: string;
    videoCount?: string;
    avatarUrl?: string;
    channelUrl?: string;
    description?: string;
  };
  latest_videos?: unknown[];
}

// ── Formatting helpers ────────────────────────────────────────────────────

function orNA(value: string | number | null | undefined): string {
  if (value === null || value === undefined || value === '') return 'N/A';
  return String(value);
}

function fmtCount(value: number | undefined): string {
  return value === undefined ? 'N/A' : value.toLocaleString('en-US');
}

function fmtLine(label: string, value: string | number | null | undefined): string {
  return `\n${label}: ${orNA(value)}`;
}

// ── Response formatters ───────────────────────────────────────────────────

function formatGithub(r: GithubResult): string {
  return [
    `🐙 **GitHub Profile — ${orNA(r.username)}**`,
    ...(r.nickname ? fmtLine('👤 Name', r.nickname).split('\n') : []),
    ...(r.bio ? fmtLine('📝 Bio', r.bio).split('\n') : []),
    fmtLine('🆔 ID', r.id),
    ...(r.type ? fmtLine('🧩 Type', r.type).split('\n') : []),
    ...(r.company ? fmtLine('🏢 Company', r.company).split('\n') : []),
    ...(r.location ? fmtLine('📍 Location', r.location).split('\n') : []),
    ...(r.email ? fmtLine('📧 Email', r.email).split('\n') : []),
    fmtLine('📁 Repos', `${r.public_repo ?? 'N/A'} (${r.public_gists ?? 'N/A'} gists)`),
    fmtLine('⭐ Followers', fmtCount(r.followers)),
    fmtLine('👣 Following', fmtCount(r.following)),
    ...(r.url ? fmtLine('🔗 URL', r.url).split('\n') : []),
    ...(r.created_at ? fmtLine('📅 Joined', r.created_at.replace('T', ' ').replace('Z', '')).split('\n') : []),
  ].join('');
}

function formatThreads(r: ThreadsResult): string {
  return [
    `🧵 **Threads Profile — ${orNA(r.username)}**`,
    ...(r.name ? fmtLine('👤 Name', r.name).split('\n') : []),
    ...(r.bio ? fmtLine('📝 Bio', r.bio).split('\n') : []),
    fmtLine('✅ Verified', r.is_verified ? 'Yes' : 'No'),
    fmtLine('👥 Followers', fmtCount(r.followers)),
    fmtLine('🆔 ID', r.id),
  ].join('');
}

function formatTwitter(r: TwitterResult): string {
  const stats = r.stats;
  return [
    `🐦 **X Profile — ${orNA(r.username)}**`,
    ...(r.name ? fmtLine('👤 Name', r.name).split('\n') : []),
    fmtLine('✅ Verified', r.verified ? 'Yes' : 'No'),
    ...(r.description && r.description !== '-' ? fmtLine('📝 Bio', r.description).split('\n') : []),
    ...(r.location && r.location !== '-' ? fmtLine('📍 Location', r.location).split('\n') : []),
    stats
      ? `\n📊 **Stats**: ${fmtCount(stats.tweets)} Tweets · ${fmtCount(stats.following)} Following · ${fmtCount(stats.followers)} Followers · ${fmtCount(stats.likes)} Likes`
      : '',
    ...(r.created_at ? fmtLine('📅 Joined', r.created_at).split('\n') : []),
  ].join('');
}

function formatYoutube(r: YoutubeResult): string {
  const c = r.channel;
  if (!c) return '⚠️ No channel data was returned.';
  return [
    `📺 **YouTube Channel — ${orNA(c.username)}**`,
    ...(c.name ? fmtLine('👤 Name', c.name).split('\n') : []),
    ...(c.subscriberCount ? fmtLine('🔢 Subscribers', c.subscriberCount).split('\n') : []),
    ...(c.videoCount ? fmtLine('🎬 Videos', c.videoCount).split('\n') : []),
    ...(c.description ? fmtLine('📝 Description', c.description).split('\n') : []),
    ...(c.channelUrl ? fmtLine('🔗 Channel', c.channelUrl).split('\n') : []),
  ].join('');
}

// ── Config table ──────────────────────────────────────────────────────────

interface StalkerConfig {
  name: string;
  aliases: string[];
  label: string;
  description: string;
  example: string;
  fetch: (username: string) => Promise<string>;
}

const STALKER_CONFIGS: StalkerConfig[] = [
  {
    name: 'github',
    aliases: ['gh'],
    label: 'GitHub',
    description: 'Stalk a GitHub user profile.',
    example: 'github ajirodesu',
    fetch: async (username) => {
      const { data } = await axios.get<StalkerResponse<GithubResult>>(
        'https://api.nexray.eu.cc/stalker/github',
        { params: { username }, timeout: 15_000 },
      );
      if (!data.status || !data.result) throw new Error(data.error ?? 'User not found.');
      return formatGithub(data.result);
    },
  },
  {
    name: 'threadsstalk',
    aliases: ['threads'],
    label: 'Threads',
    description: 'Stalk a Threads (Instagram) user profile.',
    example: 'threadsstalk zuck',
    fetch: async (username) => {
      const { data } = await axios.get<StalkerResponse<ThreadsResult>>(
        'https://api.nexray.eu.cc/stalker/threads',
        { params: { username }, timeout: 15_000 },
      );
      if (!data.status || !data.result) throw new Error(data.error ?? 'User not found.');
      return formatThreads(data.result);
    },
  },
  {
    name: 'xstalk',
    aliases: ['twitter', 'x'],
    label: 'X / Twitter',
    description: 'Stalk an X (Twitter) user profile.',
    example: 'xstalk lancecochangco',
    fetch: async (username) => {
      const { data } = await axios.get<StalkerResponse<TwitterResult>>(
        'https://api.nexray.eu.cc/stalker/twitter',
        { params: { username }, timeout: 15_000 },
      );
      if (!data.status || !data.result) throw new Error(data.error ?? 'User not found.');
      return formatTwitter(data.result);
    },
  },
  {
    name: 'ytstalk',
    aliases: ['youtube', 'yt'],
    label: 'YouTube',
    description: 'Stalk a YouTube channel profile.',
    example: 'ytstalk pewdiepie',
    fetch: async (username) => {
      const { data } = await axios.get<StalkerResponse<YoutubeResult>>(
        'https://api.nexray.eu.cc/stalker/youtube',
        { params: { username }, timeout: 15_000 },
      );
      if (!data.status || !data.result) throw new Error(data.error ?? 'Channel not found.');
      return formatYoutube(data.result);
    },
  },
];

// ── Shared handler ────────────────────────────────────────────────────────

async function runStalker(ctx: AppCtx, config: StalkerConfig): Promise<void> {
  const { chat, args, usage, prefix } = ctx;

  if (!args.length) {
    await chat.replyMessage({
      style: MessageStyle.MARKDOWN,
      message: [
        `🔎 **${config.label} Profile Stalker**`,
        '',
        `» \`${prefix || '/'}${config.example}\``,
        '',
        `_Look up a ${config.label} profile by username._`,
      ].join('\n'),
    });
    return;
  }

  const username = args[0]!.trim().replace(/^@/, '');

  if (!username) {
    await usage();
    return;
  }

  try {
    const profile = await config.fetch(username);
    await chat.replyMessage({
      style: MessageStyle.MARKDOWN,
      message: profile,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await chat.replyMessage({
      style: MessageStyle.MARKDOWN,
      message: `⚠️ Could not fetch the **${config.label}** profile for \`${username}\`: _${message}_`,
    });
  }
}

// ── Command entry generation ──────────────────────────────────────────────

interface CommandEntry {
  meta: CommandMeta;
  onCommand: (ctx: AppCtx) => Promise<void>;
}

export const commands: CommandEntry[] = STALKER_CONFIGS.map((config) => ({
  meta: {
    name: config.name,
    aliases: config.aliases,
    version: '1.0.0',
    role: Role.ANYONE,
    author: 'AjiroDesu',
    description: config.description,
    category: 'Utility',
    usage: '<username>',
    cooldown: 5,
    hasPrefix: true,
    platform: [Platforms.Discord, Platforms.Telegram],
    options: [
      {
        type: OptionType.string,
        name: 'username',
        description: `${config.label} username to look up`,
        required: true,
      },
    ],
  },
  onCommand: async (ctx: AppCtx) => runStalker(ctx, config),
}));
