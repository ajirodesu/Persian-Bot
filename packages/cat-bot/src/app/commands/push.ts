/**
 * /push — Push a zip of files straight to GitHub (System Admin only)
 *
 * Lets a system admin drop a zip of changed files onto the bot and have it
 * land in the repo, staged, committed, and pushed — no manual file-manager
 * clicking. Built on top of the same local git checkout the Admin File
 * Manager / Git tab already operates on (see local-git.lib.ts,
 * local-file-manager.lib.ts) — this command does not talk to the GitHub API
 * directly, it writes to the working tree and runs `git add/commit/push`,
 * exactly like a human using the Git tab would.
 *
 * Flow (onReply — see examples/commands/example_reply.ts):
 *   Admin: /push
 *   Bot:   📦 Reply with a .zip of the files to push.
 *   Admin: [quotes the bot's message, attaches a .zip file]
 *   Bot:   ✅ Pushed 7 file(s) — `a1b2c3d`
 *
 * Unwrap convention:
 *   Zips are expected to already use monorepo-relative paths (e.g.
 *   `packages/cat-bot/src/app/commands/push.ts`) — the way every deliverable
 *   is packaged for this project. Some zip tools still wrap everything in one
 *   extra top-level folder (e.g. a temp working-dir name) that is NOT itself
 *   a real top-level directory in this repo. `resolveEntryPath()` detects
 *   that case — a single common first path segment that does not exist as a
 *   real folder at the repo root — and strips it, exactly the way Lance asks
 *   for every time a deliverable is handed over. A legitimate top-level repo
 *   folder (e.g. `packages/`) is left untouched.
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
import { dirname, join } from 'node:path';
import axios from 'axios';
import AdmZip from 'adm-zip';
import type { AppCtx } from '@/engine/types/controller.types.js';
import { Role } from '@/engine/constants/role.constants.js';
import { MessageStyle } from '@/engine/constants/message-style.constants.js';
import { Platforms } from '@/engine/modules/platform/platform.constants.js';
import type { CommandMeta } from '@/engine/types/module-meta.types.js';
import {
  getRepoRootOrThrow,
  normalizeRepoPath,
  stagePaths,
  commitStaged,
  pushCurrent,
  RepoFileManagerError,
} from '@/server/lib/local-git.lib.js';

// ── Attachment shape (same convention as popcat-media.ts / agent-handler.lib.ts) ─

interface RawAttachment {
  type?: string;
  url?: string | null;
  filename?: string | null;
  name?: string | null;
}

const STATE = {
  awaiting_zip: 'awaiting_zip',
} as const;

const MAX_ZIP_BYTES = 25 * 1024 * 1024; // 25 MB — plenty for a file-diff drop
const MAX_ENTRY_BYTES = 5 * 1024 * 1024; // guards a single runaway file

// ── Helpers ────────────────────────────────────────────────────────────────────

/** True when a name (filename or url path) clearly ends in `.zip`. */
function looksLikeZipName(name: string | null | undefined): boolean {
  if (!name) return false;
  return name.toLowerCase().split('?')[0]!.endsWith('.zip');
}

/**
 * Finds the attachment on the triggering reply that is (or is most likely)
 * the .zip the admin meant to push.
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
function findZipAttachment(event: Record<string, unknown>): RawAttachment | null {
  const attachments = (event['attachments'] as RawAttachment[] | undefined) ?? [];
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
function hasUnresolvedAttachment(event: Record<string, unknown>): boolean {
  const attachments = (event['attachments'] as RawAttachment[] | undefined) ?? [];
  return attachments.some((a) => a && !a.url);
}

/**
 * Real top-level entries at the repo root, used to tell a legitimate
 * repo-relative path (e.g. `packages/...`) apart from an artificial wrapper
 * folder that some zip tools add.
 */
async function repoRootEntries(): Promise<Set<string>> {
  const root = getRepoRootOrThrow();
  const dirents = await fsp.readdir(root, { withFileTypes: true });
  return new Set(dirents.map((d) => d.name));
}

/**
 * Strips a single wrapper folder shared by every entry in the zip, but only
 * when that folder name is NOT itself a real top-level directory in the repo
 * (which would mean it's a genuine monorepo-relative path, not a wrapper).
 */
function unwrapPrefix(entryNames: string[], realTopLevel: Set<string>): string | null {
  const firstSegments = new Set(
    entryNames.map((n) => n.split('/')[0]).filter((s): s is string => !!s),
  );
  if (firstSegments.size !== 1) return null;
  const [only] = firstSegments;
  if (!only || realTopLevel.has(only)) return null;
  return only;
}

interface PushSummary {
  written: string[];
  skipped: string[];
}

/** Extracts a zip buffer into the repo working tree, honoring the unwrap convention. */
async function extractZipToRepo(buffer: Buffer): Promise<PushSummary> {
  const zip = new AdmZip(buffer);
  const zipEntries = zip.getEntries().filter((e) => !e.isDirectory);
  if (zipEntries.length === 0) {
    throw new RepoFileManagerError(400, 'The zip contains no files.');
  }

  const realTopLevel = await repoRootEntries();
  const prefix = unwrapPrefix(
    zipEntries.map((e) => e.entryName),
    realTopLevel,
  );

  const written: string[] = [];
  const skipped: string[] = [];
  const root = getRepoRootOrThrow();

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
        throw new RepoFileManagerError(400, 'Cannot modify .git');
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

    const absTarget = join(root, ...repoPath.split('/'));
    await fsp.mkdir(dirname(absTarget), { recursive: true });
    await fsp.writeFile(absTarget, data);
    written.push(repoPath);
  }

  return { written, skipped };
}

// ── Config ────────────────────────────────────────────────────────────────────

export const meta: CommandMeta = {
  name: 'push',
  aliases: ['gitpush'] as string[],
  version: '1.0.1',
  role: Role.SYSTEM_ADMIN,
  author: 'AjiroDesu',
  description: 'Unzip a replied .zip straight into the repo and commit + push it.',
  category: 'System Admin',
  usage: '',
  cooldown: 10,
  hasPrefix: true,
  // Real commits against the live repo — never expose this to the in-app Chat Room.
  platform: [Platforms.Discord, Platforms.Telegram, Platforms.Fluxer],
};

// ── Command Entry Point — step 1: ask for the zip ──────────────────────────────

export const onCommand = async ({ chat, state }: AppCtx): Promise<void> => {
  // Fail fast if there's no git checkout configured — no point collecting a
  // zip the command can't do anything with.
  try {
    getRepoRootOrThrow();
  } catch (err) {
    const error = err as { message?: string };
    await chat.replyMessage({
      style: MessageStyle.MARKDOWN,
      message: `❌ ${error.message ?? 'No git repository is configured for pushing.'}`,
    });
    return;
  }

  const messageID = await chat.replyMessage({
    style: MessageStyle.MARKDOWN,
    message: [
      '📦 **Push files to GitHub**',
      'Reply to this message with a **.zip** of the files to push.',
      '',
      '_Paths inside the zip should already be monorepo-relative (e.g._',
      '_`packages/cat-bot/src/app/commands/foo.ts`). A single wrapper folder_',
      '_around everything is stripped automatically._',
    ].join('\n'),
  });

  if (!messageID) {
    await chat.replyMessage({
      style: MessageStyle.MARKDOWN,
      message: '❌ Push unavailable: this platform did not return a message ID from replyMessage().',
    });
    return;
  }

  state.create({
    id: state.generateID({ id: String(messageID) }),
    state: STATE.awaiting_zip,
    context: {},
  });
};

// ── Reply Handler — step 2: unzip, commit, push ─────────────────────────────────

export const onReply = {
  [STATE.awaiting_zip]: async ({ chat, session, state, event, db }: AppCtx): Promise<void> => {
    state.delete(session.id);

    const zipAttachment = findZipAttachment(event);
    if (!zipAttachment?.url) {
      const hint = hasUnresolvedAttachment(event)
        ? ' The file attached may be too large to download (Telegram bots can only fetch files up to 20 MB via the Bot API).'
        : '';
      await chat.replyMessage({
        style: MessageStyle.MARKDOWN,
        message: `❌ No \`.zip\` file found on that reply — run \`/push\` again and attach one.${hint}`,
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
        throw new RepoFileManagerError(400, 'That file is not a valid zip archive.');
      }

      const { written, skipped } = await extractZipToRepo(buffer);
      if (written.length === 0) {
        await chat.replyMessage({
          style: MessageStyle.MARKDOWN,
          message: '❌ Nothing valid to write — every entry in the zip was skipped.',
        });
        return;
      }

      await stagePaths(written);

      const senderID = event['senderID'] as string | undefined;
      const adminName = senderID ? await db.users.getName(senderID).catch(() => senderID) : 'system admin';
      const commitMessage = `push: ${written.length} file(s) via /push by ${adminName}`;

      let sha: string;
      try {
        ({ sha } = await commitStaged(commitMessage));
      } catch (err) {
        if (err instanceof RepoFileManagerError && /nothing staged/i.test(err.message)) {
          await chat.replyMessage({
            style: MessageStyle.MARKDOWN,
            message: `ℹ️ Extracted ${written.length} file(s), but the content exactly matches what's already committed — nothing to push.`,
          });
          return;
        }
        throw err;
      }

      let pushOutput = '';
      let pushError: string | null = null;
      try {
        pushOutput = await pushCurrent();
      } catch (err) {
        pushError = (err as { message?: string }).message ?? 'push failed';
      }

      const lines = [
        pushError ? '⚠️ **Committed, but push failed**' : '✅ **Pushed to GitHub**',
        `📝 ${written.length} file(s) written${skipped.length ? `, ${skipped.length} skipped` : ''} · commit \`${sha || '(unknown)'}\``,
        '```',
        written.slice(0, 20).join('\n') + (written.length > 20 ? `\n… +${written.length - 20} more` : ''),
        '```',
      ];
      if (skipped.length) {
        lines.push(`⏭️ Skipped: ${skipped.slice(0, 10).join(', ')}${skipped.length > 10 ? ', …' : ''}`);
      }
      if (pushError) {
        lines.push(`⚠️ \`${pushError}\` — the commit is local; push manually from the Git tab.`);
      } else if (pushOutput) {
        lines.push(`\n_${pushOutput}_`);
      }

      await chat.replyMessage({ style: MessageStyle.MARKDOWN, message: lines.join('\n') });
    } catch (err) {
      const error = err as { message?: string };
      await chat.replyMessage({
        style: MessageStyle.MARKDOWN,
        message: `⚠️ **Push failed:** \`${error.message ?? 'Unknown error'}\``,
      });
    }
  },
};