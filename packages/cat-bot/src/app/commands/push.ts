/**
 * /push — Push a zip of files straight to GitHub (System Admin only)
 *
 * Lets a system admin drop a zip of changed files onto the bot and have it
 * land in the repo, committed and pushed — no manual file-manager clicking.
 *
 * The commit + push go through the GitHub REST API using the deployment's
 * single stored GitHub token + GITHUB_REPO_OWNER / GITHUB_REPO_NAME (see
 * github-contents.lib.ts): every file in the zip lands on the repo's default
 * branch as ONE commit, authored by the token's account. Unlike a local-git
 * flow, this needs no git user.name/email and no push credentials on the host —
 * it just works on Render/Railway. The local checkout is never touched.
 *
 * Flow (single-step, no onReply state):
 *   Admin: [quotes a message carrying a .zip, types] /push Fix the login bug
 *   Bot:   ✅ Pushed 7 file(s) — `a1b2c3d`
 *
 * The command ONLY runs when the user replies to a message that carries a
 * .zip file — the zip is read off the replied-to message's attachments. The
 * text after the command name is used verbatim as the commit message.
 *
 * Unwrap convention:
 *   Zips are expected to already use monorepo-relative paths (e.g.
 *   `packages/cat-bot/src/app/commands/push.ts`) — the way every deliverable
 *   is packaged for this project. Some zip tools still wrap everything in one
 *   extra top-level folder (e.g. a temp working-dir name) that is NOT itself
 *   a real top-level directory in this repo. `unwrapPrefix()` detects that
 *   case — a single common first path segment that does not exist as a real
 *   folder at the repo root — and strips it, exactly the way Lance asks for
 *   every time a deliverable is handed over. A legitimate top-level repo
 *   folder (e.g. `packages/`) is left untouched. The check is best-effort:
 *   when no local checkout is resolvable the wrapper stripping is skipped.
 *
 * Attachment detection note:
 *   Discord and Fluxer attachments always carry a real `filename`, so a
 *   `.zip` name match is reliable there. Telegram is different — its event
 *   normalizer (`extractAttachments` in the Telegram helper.util.ts) only
 *   ever produces `{ type: 'file', ID, url }` for documents; the original
 *   filename is never captured, only the file_id. `findZipAttachment()`
 *   below therefore also checks the *resolved* CDN url's extension (the
 *   Bot API's getFile() response usually preserves it), and — if that still
 *   comes up empty — falls back to the lone generic `type: 'file'`
 *   attachment when there's exactly one, trusting the PK magic-byte check
 *   after download to reject anything that isn't actually a zip.
 *
 * Restricted to SYSTEM_ADMIN and unavailable on Webchat — pushing to the repo
 * is a real commit against the live codebase, not something the in-app chat
 * room should be able to trigger.
 */

import { promises as fsp } from 'node:fs';
import axios from 'axios';
import AdmZip from 'adm-zip';
import type { AppCtx } from '@/engine/types/controller.types.js';
import { Role } from '@/engine/constants/role.constants.js';
import { MessageStyle } from '@/engine/constants/message-style.constants.js';
import { Platforms } from '@/engine/modules/platform/platform.constants.js';
import type { CommandMeta } from '@/engine/types/module-meta.types.js';
import { getRepoRootOrThrow, normalizeRepoPath } from '@/server/lib/local-git.lib.js';
import {
  getGitHubConfig,
  getDefaultBranch,
  pushFilesToGitHub,
  type GitHubConfig,
  type GitHubFileInput,
} from '@/server/lib/github-contents.lib.js';

// ── Attachment shape (same convention as popcat-media.ts / agent-handler.lib.ts) ─

interface RawAttachment {
  type?: string;
  url?: string | null;
  filename?: string | null;
  name?: string | null;
}

const MAX_ZIP_BYTES = 25 * 1024 * 1024; // 25 MB — plenty for a file-diff drop
const MAX_ENTRY_BYTES = 5 * 1024 * 1024; // guards a single runaway file

// ── Helpers ────────────────────────────────────────────────────────────────────

/** True when a name (filename or url path) clearly ends in `.zip`. */
function looksLikeZipName(name: string | null | undefined): boolean {
  if (!name) return false;
  return name.toLowerCase().split('?')[0]!.endsWith('.zip');
}

/**
 * Finds the attachment that is (or is most likely) the .zip the admin meant
 * to push.
 *
 * Discord/Fluxer attachments carry a real `filename`/`name`, so those are
 * matched directly. Telegram documents never carry a filename at all — only
 * `{ type: 'file', ID, url }` survives event normalization — so as a second
 * pass this also checks the resolved CDN url's extension, and if that's
 * still inconclusive, falls back to the lone generic `type: 'file'`
 * attachment when there's exactly one candidate. The PK magic-byte check
 * that runs right after download is the real gatekeeper for "is this
 * actually a zip", so this resolver is intentionally permissive.
 */
function findZipAttachment(attachments: RawAttachment[]): RawAttachment | null {
  if (attachments.length === 0) return null;

  const byName = attachments.find(
    (a) =>
      !!a?.url &&
      (looksLikeZipName(a.filename) || looksLikeZipName(a.name) || looksLikeZipName(a.url)),
  );
  if (byName) return byName;

  // Telegram fallback: no filename anywhere on the event, but exactly one
  // generic document attachment resolved a url — treat it as the candidate.
  const genericFiles = attachments.filter(
    (a) => !!a?.url && (a.type ?? '').toLowerCase() === 'file',
  );
  if (genericFiles.length === 1) return genericFiles[0]!;

  return null;
}

/** True when the reply has an attachment that never resolved a downloadable url. */
function hasUnresolvedAttachment(attachments: RawAttachment[]): boolean {
  return attachments.some((a) => a && !a.url);
}

/**
 * Best-effort real top-level entries at the repo root, used to tell a
 * legitimate repo-relative path (e.g. `packages/...`) apart from an
 * artificial wrapper folder that some zip tools add. Returns null when no
 * local checkout is resolvable — in that case wrapper stripping is skipped.
 */
async function repoRootEntries(): Promise<Set<string> | null> {
  try {
    const root = getRepoRootOrThrow();
    const dirents = await fsp.readdir(root, { withFileTypes: true });
    return new Set(dirents.map((d) => d.name));
  } catch {
    return null;
  }
}

/**
 * Strips a single wrapper folder shared by every entry in the zip, but only
 * when that folder name is NOT itself a real top-level directory in the repo
 * (which would mean it's a genuine monorepo-relative path, not a wrapper).
 */
function unwrapPrefix(entryNames: string[], realTopLevel: Set<string> | null): string | null {
  if (!realTopLevel) return null;
  const firstSegments = new Set(
    entryNames.map((n) => n.split('/')[0]).filter((s): s is string => !!s),
  );
  if (firstSegments.size !== 1) return null;
  const [only] = firstSegments;
  if (!only || realTopLevel.has(only)) return null;
  return only;
}

interface ExtractedZip {
  written: GitHubFileInput[];
  skipped: string[];
}

/**
 * Reads a zip buffer into in-memory file entries, honoring the unwrap
 * convention. Nothing touches the local disk — the files are pushed to
 * GitHub directly.
 */
async function extractZipEntries(buffer: Buffer): Promise<ExtractedZip> {
  const zip = new AdmZip(buffer);
  const zipEntries = zip.getEntries().filter((e) => !e.isDirectory);
  if (zipEntries.length === 0) {
    throw new Error('The zip contains no files.');
  }

  const realTopLevel = await repoRootEntries();
  const prefix = unwrapPrefix(
    zipEntries.map((e) => e.entryName),
    realTopLevel,
  );

  const written: GitHubFileInput[] = [];
  const skipped: string[] = [];

  for (const entry of zipEntries) {
    let relative = entry.entryName.replace(/\\/g, '/');
    if (prefix) relative = relative.slice(prefix.length + 1);
    if (!relative) {
      skipped.push(entry.entryName);
      continue;
    }

    let repoPath: string;
    try {
      repoPath = normalizeRepoPath(relative);
      if (repoPath === '.git' || repoPath.startsWith('.git/')) {
        throw new Error('Cannot modify .git');
      }
    } catch {
      skipped.push(entry.entryName);
      continue;
    }

    const data = entry.getData();
    if (data.length > MAX_ENTRY_BYTES) {
      skipped.push(`${repoPath} (too large)`);
      continue;
    }

    written.push({ path: repoPath, content: data });
  }

  return { written, skipped };
}

// ── Config ────────────────────────────────────────────────────────────────────

export const meta: CommandMeta = {
  name: 'push',
  aliases: ['gitpush'] as string[],
  version: '2.0.0',
  role: Role.SYSTEM_ADMIN,
  author: 'AjiroDesu',
  description:
    'Reply to a .zip message and push it: unzips the replied .zip into the repo and commits + pushes with your message.',
  category: 'System Admin',
  usage: '[message]',
  cooldown: 10,
  hasPrefix: true,
  // Real commits against the live repo — never expose this to the in-app Chat Room.
  platform: [Platforms.Discord, Platforms.Telegram, Platforms.Fluxer],
};

// ── Command Entry Point — single step: reply → unzip → push via GitHub API ────

export const onCommand = async ({ chat, args, event, usage }: AppCtx): Promise<void> => {
  // Rely on the stored GitHub config — without a connected token there is no
  // repo to push to.
  let config: GitHubConfig;
  try {
    config = await getGitHubConfig();
  } catch (err) {
    const message = err instanceof Error ? err.message : 'GitHub is not configured.';
    await chat.replyMessage({ style: MessageStyle.MARKDOWN, message: `❌ ${message}` });
    return;
  }

  const commitMessage = args.join(' ').trim();
  if (!commitMessage) {
    await usage();
    return;
  }

  // The command only works when the user replies to a message carrying a .zip.
  const messageReply = event['messageReply'] as
    | Record<string, unknown>
    | null
    | undefined;
  const replyAttachments = (messageReply?.['attachments'] as RawAttachment[] | undefined) ?? [];
  const zipAttachment = findZipAttachment(replyAttachments);
  if (!zipAttachment?.url) {
    const hint = hasUnresolvedAttachment(replyAttachments)
      ? ' The file attached may be too large to download (Telegram bots can only fetch files up to 20 MB via the Bot API).'
      : '';
    await chat.replyMessage({
      style: MessageStyle.MARKDOWN,
      message:
        `❌ **No .zip found.** This command only works when you reply to a message ` +
        `carrying a \`.zip\` file — reply to one with \`/push <commit message>\`.${hint}`,
    });
    return;
  }

  try {
    const download = await axios.get<ArrayBuffer>(zipAttachment.url, {
      responseType: 'arraybuffer',
      maxContentLength: MAX_ZIP_BYTES,
      maxBodyLength: MAX_ZIP_BYTES,
    });
    const buffer = Buffer.from(download.data);
    if (buffer.length < 4 || buffer.toString('ascii', 0, 2) !== 'PK') {
      throw new Error('That file is not a valid zip archive.');
    }

    const { written, skipped } = await extractZipEntries(buffer);
    if (written.length === 0) {
      await chat.replyMessage({
        style: MessageStyle.MARKDOWN,
        message: '❌ Nothing valid to write — every entry in the zip was skipped.',
      });
      return;
    }

    const branch = await getDefaultBranch(config);
    const { commitSha, commitUrl } = await pushFilesToGitHub(config, written, commitMessage, branch);

    const lines = [
      `✅ **Pushed to GitHub**`,
      `📝 ${written.length} file(s) pushed${skipped.length ? `, ${skipped.length} skipped` : ''} · commit \`${commitSha.slice(0, 7)}\``,
      '```',
      written
        .slice(0, 20)
        .map((f) => f.path)
        .join('\n') + (written.length > 20 ? `\n… +${written.length - 20} more` : ''),
      '```',
    ];
    if (skipped.length) {
      lines.push(`⏭️ Skipped: ${skipped.slice(0, 10).join(', ')}${skipped.length > 10 ? ', …' : ''}`);
    }
    lines.push(`🔗 ${commitUrl}`);

    await chat.replyMessage({ style: MessageStyle.MARKDOWN, message: lines.join('\n') });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    await chat.replyMessage({
      style: MessageStyle.MARKDOWN,
      message: `⚠️ **Push failed:** \`${message}\``,
    });
  }
};
