/**
 * update.ts — /update — Sync your forked repository with the main Cat-Bot repo
 *
 * Lets a system admin running a FORK of the project pull the latest features,
 * improvements, and fixes from the main repository (ajirodesu/Persian-Bot) into
 * their own fork — without overwriting their custom commands, APIs, config, or
 * any other locally-modified files.
 *
 * Flow:
 *   1. /update            → the bot checks your fork against upstream, computes
 *                           a full three-way merge plan, and shows a summary:
 *                           what will be updated / added / removed, what will
 *                           be preserved (your changes), and any conflicts.
 *   2. Confirmation       → you MUST confirm you've made a backup first:
 *                           [✅ Proceed]  — apply the update
 *                           [✖️ Cancel]  — abort, no changes
 *   3. Result             → a pre-update backup branch is created, the changes
 *                           land as ONE commit on your fork, and a final summary
 *                           reports what was updated, preserved, and which
 *                           conflicts need manual resolution.
 *
 * The update engine lives in server/lib/fork-update.lib.ts and works entirely
 * through the GitHub API — no local git checkout or push credentials needed, so
 * it runs on Render / Railway out of the box. Environment variables, secrets,
 * credentials, and database data live outside the git tree and are never
 * touched; protected config files (.env, .env.*, private keys) are never
 * overwritten even if they are tracked.
 *
 * Restricted to SYSTEM_ADMIN — this writes to the live fork.
 */

import type { AppCtx } from '@/engine/types/controller.types.js';
import { Role } from '@/engine/constants/role.constants.js';
import { ButtonStyle } from '@/engine/constants/button-style.constants.js';
import { MessageStyle } from '@/engine/constants/message-style.constants.js';
import { Platforms } from '@/engine/modules/platform/platform.constants.js';
import { hasNativeButtons } from '@/engine/utils/ui-capabilities.util.js';
import { logger } from '@/engine/modules/logger/logger.lib.js';
import type { CommandMeta } from '@/engine/types/module-meta.types.js';
import {
  GitHubApiError,
  getGitHubConfig,
  type GitHubConfig,
} from '@/server/lib/github-contents.lib.js';
import {
  applyForkUpdate,
  planForkUpdate,
  UPSTREAM_FULL,
  type ApplyForkUpdateResult,
  type ForkPlanItem,
  type ForkUpdatePlan,
} from '@/server/lib/fork-update.lib.js';

// ── Button IDs (local keys — resolveButtons() prefixes them with "update:") ──

const BUTTON_ID = {
  proceed: 'proceed',
  cancel: 'cancel',
} as const;

// ── Config ────────────────────────────────────────────────────────────────────

export const meta: CommandMeta = {
  name: 'update',
  aliases: ['updatefork', 'sync'] as string[],
  version: '1.0.0',
  role: Role.SYSTEM_ADMIN,
  author: 'AjiroDesu',
  description:
    'Updates your forked repository with the latest changes from the main Cat-Bot repository, preserving your custom modifications.',
  category: 'system',
  usage: '',
  cooldown: 30,
  hasPrefix: true,
  // Requires native buttons for the Cancel/Proceed confirmation, and writes to
  // the live repo — never expose it to the in-app Chat Room.
  platform: [Platforms.Discord, Platforms.Telegram, Platforms.Webchat],
};

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Cuts long lists to a readable length for chat message limits. */
function formatFileList(items: ForkPlanItem[], cap = 12): string {
  if (items.length === 0) return '_(none)_';
  const shown = items
    .slice(0, cap)
    .map((i) => `- \`${i.path}\``);
  if (items.length > cap) {
    shown.push(`- _… and ${items.length - cap} more_`);
  }
  return shown.join('\n');
}

/** Per-action counts for a list of plan items. */
function groupActions(items: ForkPlanItem[]): {
  added: number;
  updated: number;
  deleted: number;
} {
  let added = 0;
  let updated = 0;
  let deleted = 0;
  for (const item of items) {
    if (item.action === 'add') added += 1;
    else if (item.action === 'update') updated += 1;
    else if (item.action === 'delete') deleted += 1;
  }
  return { added, updated, deleted };
}

/** Describes what will happen to a changed file ("added", "updated", "removed"). */
function changeVerb(action: ForkPlanItem['action']): string {
  if (action === 'add') return 'new';
  if (action === 'update') return 'updated';
  if (action === 'delete') return 'removed';
  return action;
}

/** Summary shown to the user BEFORE anything is changed. */
function buildConfirmationMessage(plan: ForkUpdatePlan): string {
  const { changes, preserved, conflicts } = plan;
  const { added, updated, deleted } = groupActions(changes);
  const parts: string[] = [];

  parts.push(`🔄 **Fork update available**`);
  parts.push(
    `Your fork \`${plan.fork.owner}/${plan.fork.repo}\` is behind \`${UPSTREAM_FULL}\` (\`${plan.upstreamBranch}\`).`,
  );

  parts.push(
    '',
    `📥 **To update — ${changes.length} file(s)** (${[
      added > 0 ? `${added} new` : null,
      updated > 0 ? `${updated} updated` : null,
      deleted > 0 ? `${deleted} removed` : null,
    ]
      .filter((x): x is string => x !== null)
      .join(', ')}):`,
    changes.length > 0
      ? changes
          .slice(0, 12)
          .map((i) => `- \`${i.path}\` (${changeVerb(i.action)})`)
          .join('\n') + (changes.length > 12 ? `\n- _… and ${changes.length - 12} more_` : '')
      : '_(nothing)_',
  );

  parts.push(
    '',
    `🛡️ **Preserved — your changes kept — ${preserved.length} file(s):**`,
    formatFileList(preserved),
  );

  parts.push(
    '',
    `⚠️ **Conflicts — kept as yours, resolve manually — ${conflicts.length} file(s):**`,
    formatFileList(conflicts),
  );

  parts.push(
    '',
    '⚠️ **IMPORTANT:** Create a backup of your current code and data before continuing.',
    '_The update will also create a restore-point branch automatically, but you should still back up your environment variables, database, credentials, and any configuration stored outside the repository._',
    '',
    'Do you want to proceed?',
  );

  return parts.join('\n');
}

/** Final summary shown AFTER the update has been applied. */
function buildCompletionMessage(
  plan: ForkUpdatePlan,
  result: ApplyForkUpdateResult,
): string {
  const { added, updated, deleted } = groupActions(plan.changes);
  const parts: string[] = [];

  parts.push(`✅ **Your fork has been updated.**`);
  parts.push(
    `Your fork \`${plan.fork.owner}/${plan.fork.repo}\` has been updated with the latest changes from \`${UPSTREAM_FULL}\` (\`${plan.upstreamBranch}\`).`,
  );

  parts.push(
    '',
    `📥 **Updated — ${plan.changes.length} file(s)** · commit \`${result.commitSha.slice(0, 7)}\` (` +
      [
        added > 0 ? `${added} new` : null,
        updated > 0 ? `${updated} updated` : null,
        deleted > 0 ? `${deleted} removed` : null,
      ]
        .filter((x): x is string => x !== null)
        .join(', ') +
      '):',
    plan.changes.length > 0
      ? plan.changes
          .slice(0, 12)
          .map((i) => `- \`${i.path}\` (${changeVerb(i.action)})`)
          .join('\n') + (plan.changes.length > 12 ? `\n- _… and ${plan.changes.length - 12} more_` : '')
      : '_(nothing)_',
  );

  parts.push(
    '',
    `🛡️ **Preserved — your modifications kept — ${plan.preserved.length} file(s):**`,
    formatFileList(plan.preserved),
  );

  if (plan.conflicts.length > 0) {
    parts.push(
      '',
      `⚠️ **Conflicts — need manual resolution — ${plan.conflicts.length} file(s):**`,
      formatFileList(plan.conflicts),
      '_Your version was kept in each case; review these files and resolve them by hand when ready._',
    );
  }

  parts.push(
    '',
    `🔗 Commit: ${result.commitUrl}`,
    `🔄 Restore point: backup branch \`${result.backupBranch}\` (points at your pre-update state).`,
  );

  return parts.join('\n');
}

// ── Button handlers ───────────────────────────────────────────────────────────

export const button = {
  [BUTTON_ID.proceed]: {
    label: '✅ Proceed',
    style: ButtonStyle.SUCCESS,
    onClick: async ({ chat, event, button: btn }: AppCtx): Promise<void> => {
      const messageId = event['messageID'] as string;
      // Clean up the stored context so stale re-clicks cannot re-trigger.
      btn.deleteContext(messageId);

      await chat.editMessage({
        style: MessageStyle.MARKDOWN,
        message_id_to_edit: messageId,
        message:
          '⏳ **Checking for updates and applying…**\n_This can take a minute — your fork is only modified after the check succeeds._',
      });

      let config: GitHubConfig;
      try {
        config = await getGitHubConfig();
      } catch (err) {
        const message =
          err instanceof Error ? err.message : 'GitHub is not configured.';
        await chat.editMessage({
          style: MessageStyle.MARKDOWN,
          message_id_to_edit: messageId,
          message: `❌ ${message}`,
        });
        return;
      }

      try {
        const plan = await planForkUpdate(config);
        if (plan.upToDate) {
          await chat.editMessage({
            style: MessageStyle.MARKDOWN,
            message_id_to_edit: messageId,
            message:
              '✅ **Your fork is already up to date.** No changes were needed.',
          });
          return;
        }
        const result = await applyForkUpdate(config, plan);
        await chat.editMessage({
          style: MessageStyle.MARKDOWN,
          message_id_to_edit: messageId,
          message: buildCompletionMessage(plan, result),
        });
        logger.info(
          `[update] Fork ${config.owner}/${config.repo} synced with ${UPSTREAM_FULL} (${result.commitSha})`,
        );
      } catch (err) {
        const message =
          err instanceof Error ? err.message : 'Unknown error';
        await chat.editMessage({
          style: MessageStyle.MARKDOWN,
          message_id_to_edit: messageId,
          message: `❌ **Update failed.** ${message}`,
        });
        logger.error('[update] Update failed', { error: err });
      }
    },
  },

  [BUTTON_ID.cancel]: {
    label: '✖️ Cancel',
    style: ButtonStyle.SECONDARY,
    onClick: async ({ chat, event, button: btn }: AppCtx): Promise<void> => {
      btn.deleteContext(event['messageID'] as string);
      await chat.editMessage({
        style: MessageStyle.MARKDOWN,
        message_id_to_edit: event['messageID'] as string,
        message: '↩️ **Update cancelled.** No changes were made to your fork.',
      });
    },
  },
};

// ── Command handler ───────────────────────────────────────────────────────────

export const onCommand = async ({
  chat,
  button: btn,
  native,
}: AppCtx): Promise<void> => {
  if (!hasNativeButtons(native.platform)) {
    await chat.replyMessage({
      style: MessageStyle.MARKDOWN,
      message:
        '❌ The update command needs interactive buttons for the Cancel / Proceed confirmation — use it on **Discord**, **Telegram**, or **Webchat**.',
    });
    return;
  }

  let config: GitHubConfig;
  try {
    config = await getGitHubConfig();
  } catch (err) {
    const message =
      err instanceof Error ? err.message : 'GitHub is not configured.';
    await chat.replyMessage({
      style: MessageStyle.MARKDOWN,
      message: `❌ ${message}`,
    });
    return;
  }

  let plan: ForkUpdatePlan;
  try {
    plan = await planForkUpdate(config);
  } catch (err) {
    const message =
      err instanceof GitHubApiError
        ? err.message
        : err instanceof Error
          ? err.message
          : 'Unknown error';
    await chat.replyMessage({
      style: MessageStyle.MARKDOWN,
      message: `❌ **Update check failed.** ${message}`,
    });
    return;
  }

  if (plan.upToDate) {
    await chat.replyMessage({
      style: MessageStyle.MARKDOWN,
      message: `✅ **Your fork is already up to date.** No changes to apply from \`${UPSTREAM_FULL}\`.`,
    });
    return;
  }

  const proceedId = btn.generateID({ id: BUTTON_ID.proceed, public: true });
  const cancelId = btn.generateID({ id: BUTTON_ID.cancel, public: true });
  btn.createContext({ id: proceedId, context: { confirmed: true } });
  btn.createContext({ id: cancelId, context: { confirmed: false } });

  await chat.replyMessage({
    style: MessageStyle.MARKDOWN,
    message: buildConfirmationMessage(plan),
    button: [proceedId, cancelId],
  });
};
