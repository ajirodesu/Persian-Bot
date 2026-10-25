/**
 * Stalker Service — shared implementation for the social-profile lookup family.
 *
 * Four commands are backed by the NexRay stalker API. Each config supplies the
 * endpoint-specific fetch + formatter; the shared handler resolves the username,
 * downloads the avatar when available, and renders the profile card.
 */

import axios from 'axios';
import type { NamedStreamAttachment } from '@/engine/adapters/models/interfaces/index.js';
import { MessageStyle } from '@/engine/constants/message-style.constants.js';
import { isNetworkError, withRetry } from '@/engine/lib/retry.lib.js';
import { logger } from '@/engine/modules/logger/logger.lib.js';
import type { AppCtx } from '@/engine/types/controller.types.js';

interface StalkerResponse<T> {
  status?: boolean;
  error?: string;
  result?: T | null;
}

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
  hd_profile_picture?: string;
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

const DIVIDER = '─────────────────';
const SEP = ' · ';

function orNA(value: string | number | null | undefined): string {
  if (value === null || value === undefined || value === '') return 'N/A';
  return String(value);
}

function fmtCount(value: number | undefined): string {
  return value === undefined ? 'N/A' : value.toLocaleString('en-US');
}

function fmtCompact(value: number | undefined): string {
  if (value === undefined) return 'N/A';
  const abs = Math.abs(value);
  const units: Array<[number, string]> = [
    [1e9, 'B'],
    [1e6, 'M'],
    [1e3, 'K'],
  ];
  for (const [base, suffix] of units) {
    if (abs >= base) {
      const scaled = value / base;
      return `${scaled >= 100 ? Math.round(scaled) : scaled.toFixed(1)}${suffix}`;
    }
  }
  return value.toLocaleString('en-US');
}

function fmtDate(value: string | undefined): string {
  if (!value) return 'N/A';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

function handle(value: string | null | undefined): string {
  const name = orNA(value);
  return name === 'N/A' ? name : `@${name.replace(/^@+/, '')}`;
}

function row(label: string, value: string | number | null | undefined): string {
  return `${label}${SEP}${orNA(value)}`;
}

function lineWhen(cond: unknown, ...parts: unknown[]): string[] {
  return cond ? [parts.join(' ')] : [];
}

const AVATAR_HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  Accept: 'image/avif,image/webp,image/*,*/*;q=0.8',
};

const MAX_AVATAR_BYTES = 10 * 1024 * 1024; // 10 MB

async function downloadAvatar(url: string): Promise<Buffer | null> {
  try {
    return await withRetry(
      async () => {
        const res = await axios.get<ArrayBuffer>(url, {
          timeout: 15_000,
          headers: AVATAR_HEADERS,
          responseType: 'arraybuffer',
          maxContentLength: MAX_AVATAR_BYTES,
          maxBodyLength: MAX_AVATAR_BYTES,
          validateStatus: (status) => status >= 200 && status < 300,
        });
        const buf = Buffer.from(res.data);
        return buf.length === 0 ? null : buf;
      },
      {
        maxAttempts: 3,
        initialDelayMs: 500,
        maxDelayMs: 2_000,
        shouldRetry: (err) => isNetworkError(err),
      },
    );
  } catch (err) {
    logger.warn(
      `[stalker] avatar download failed: ${err instanceof Error ? err.message : String(err)}`,
    );
    return null;
  }
}

function formatGithub(r: GithubResult): string {
  const lines: string[] = [
    `🐙 **GitHub Profile**${SEP}\`${handle(r.username)}\``,
    DIVIDER,
    ...lineWhen(r.nickname, row('👤 **Name**', r.nickname)),
    ...lineWhen(r.bio, row('📝 **Bio**', r.bio)),
    row('🆔 **ID**', r.id),
    ...lineWhen(r.company, row('🏢 **Company**', r.company)),
    ...lineWhen(r.location, row('📍 **Location**', r.location)),
    ...lineWhen(r.email, row('📧 **Email**', r.email)),
    row(
      '📦 **Repos**',
      `${fmtCount(r.public_repo)} · ${fmtCount(r.public_gists)} Gists`,
    ),
    DIVIDER,
    row('⭐ **Followers**', fmtCompact(r.followers)),
    row('👣 **Following**', fmtCompact(r.following)),
    DIVIDER,
  ];

  if (r.created_at) {
    lines.push(row('📅 **Joined**', fmtDate(r.created_at)));
    lines.push(DIVIDER);
  }
  if (r.url) {
    lines.push(`🔗 [Visit GitHub Profile](${r.url})`);
  }

  return lines.join('\n');
}

function formatThreads(r: ThreadsResult): string {
  const lines: string[] = [
    `🧵 **Threads Profile**${SEP}\`${handle(r.username)}\``,
    DIVIDER,
    ...lineWhen(r.name, row('👤 **Name**', r.name)),
    ...lineWhen(r.bio, row('📝 **Bio**', r.bio)),
    row('✅ **Verified**', r.is_verified ? 'Yes 🟢' : 'No 🔴'),
    row('👥 **Followers**', fmtCompact(r.followers)),
    row('🆔 **ID**', r.id),
    DIVIDER,
  ];

  return lines.join('\n');
}

function formatTwitter(r: TwitterResult): string {
  const lines: string[] = [
    `🐦 **X Profile**${SEP}\`${handle(r.username)}\``,
    DIVIDER,
    ...lineWhen(r.name, row('👤 **Name**', r.name)),
    row('✅ **Verified**', r.verified ? 'Yes 🟢' : 'No 🔴'),
    ...lineWhen(
      r.description && r.description !== '-',
      row('📝 **Bio**', r.description),
    ),
    ...lineWhen(
      r.location && r.location !== '-',
      row('📍 **Location**', r.location),
    ),
    DIVIDER,
  ];

  const stats = r.stats;
  if (stats) {
    lines.push('📊 **Stats**');
    lines.push(
      row('✍️ **Posts**', fmtCompact(stats.tweets)),
      row('👥 **Followers**', fmtCompact(stats.followers)),
      row('🔁 **Following**', fmtCompact(stats.following)),
      row('❤️ **Likes**', fmtCompact(stats.likes)),
    );
    lines.push(DIVIDER);
  }

  if (r.created_at) {
    lines.push(row('📅 **Joined**', fmtDate(r.created_at)));
    lines.push(DIVIDER);
  }
  lines.push(`🔗 [Visit X Profile](https://x.com/${orNA(r.username)})`);

  return lines.join('\n');
}

function formatYoutube(r: YoutubeResult): string {
  const c = r.channel;
  if (!c) return '⚠️ No channel data was returned.';

  const lines: string[] = [
    `📺 **YouTube Channel**${SEP}\`${handle(c.username)}\``,
    DIVIDER,
    ...lineWhen(c.name, row('👤 **Name**', c.name)),
    ...lineWhen(
      c.subscriberCount,
      row('🔢 **Subscribers**', c.subscriberCount),
    ),
    ...lineWhen(c.videoCount, row('🎬 **Videos**', c.videoCount)),
  ];

  const description = c.description;
  if (description) {
    lines.push(DIVIDER);
    lines.push(row('📝 **Description**', description));
  }

  if (c.channelUrl) {
    lines.push(DIVIDER);
    lines.push(`🔗 [Visit YouTube Channel](${c.channelUrl})`);
  }

  return lines.join('\n');
}

interface StalkerResult {
  message: string;
  avatarUrl?: string;
}

function stalkerResult(
  message: string,
  avatarUrl: string | undefined,
): StalkerResult {
  return avatarUrl ? { message, avatarUrl } : { message };
}

export interface StalkerConfig {
  name: string;
  label: string;
  example: string;
  fetch: (username: string) => Promise<StalkerResult>;
}

/** Runs the shared profile-lookup flow for a family config. */
export async function runStalker(
  ctx: AppCtx,
  config: StalkerConfig,
): Promise<void> {
  const { chat, args, usage, prefix } = ctx;

  if (!args.length) {
    await chat.replyMessage({
      style: MessageStyle.MARKDOWN,
      message: [
        `🔎 **${config.label} Profile Stalker**`,
        DIVIDER,
        `» \`${prefix || '/'}${config.example}\``,
        '',
        `_Look up a ${config.label} profile by username. Pass the username (with or without @) as the first argument._`,
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
    const { message, avatarUrl } = await config.fetch(username);

    let attachment: NamedStreamAttachment[] | undefined;
    if (avatarUrl) {
      const buffer = await downloadAvatar(avatarUrl);
      if (buffer) attachment = [{ name: 'avatar.jpg', stream: buffer }];
    }

    await chat.replyMessage({
      style: MessageStyle.MARKDOWN,
      message,
      ...(attachment ? { attachment } : {}),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await chat.replyMessage({
      style: MessageStyle.MARKDOWN,
      message: `⚠️ Could not fetch the **${config.label}** profile for \`${username}\`: _${message}_`,
    });
  }
}

export const githubStalkerConfig: StalkerConfig = {
  name: 'github',
  label: 'GitHub',
  example: 'github ajirodesu',
  fetch: async (username) => {
    const { data } = await axios.get<StalkerResponse<GithubResult>>(
      'https://api.nexray.eu.cc/stalker/github',
      { params: { username }, timeout: 15_000 },
    );
    if (!data.status || !data.result)
      throw new Error(data.error ?? 'User not found.');
    return stalkerResult(formatGithub(data.result), data.result.profile_pic);
  },
};

export const threadsStalkerConfig: StalkerConfig = {
  name: 'threadsstalk',
  label: 'Threads',
  example: 'threadsstalk zuck',
  fetch: async (username) => {
    const { data } = await axios.get<StalkerResponse<ThreadsResult>>(
      'https://api.nexray.eu.cc/stalker/threads',
      { params: { username }, timeout: 15_000 },
    );
    if (!data.status || !data.result)
      throw new Error(data.error ?? 'User not found.');
    return stalkerResult(
      formatThreads(data.result),
      data.result.hd_profile_picture || data.result.profile_picture,
    );
  },
};

export const xStalkerConfig: StalkerConfig = {
  name: 'xstalk',
  label: 'X / Twitter',
  example: 'xstalk lancecochangco',
  fetch: async (username) => {
    const { data } = await axios.get<StalkerResponse<TwitterResult>>(
      'https://api.nexray.eu.cc/stalker/twitter',
      { params: { username }, timeout: 15_000 },
    );
    if (!data.status || !data.result)
      throw new Error(data.error ?? 'User not found.');
    return stalkerResult(
      formatTwitter(data.result),
      data.result.profile?.avatar,
    );
  },
};

export const ytStalkerConfig: StalkerConfig = {
  name: 'ytstalk',
  label: 'YouTube',
  example: 'ytstalk pewdiepie',
  fetch: async (username) => {
    const { data } = await axios.get<StalkerResponse<YoutubeResult>>(
      'https://api.nexray.eu.cc/stalker/youtube',
      { params: { username }, timeout: 15_000 },
    );
    if (!data.status || !data.result)
      throw new Error(data.error ?? 'Channel not found.');
    return stalkerResult(
      formatYoutube(data.result),
      data.result.channel?.avatarUrl,
    );
  },
};
