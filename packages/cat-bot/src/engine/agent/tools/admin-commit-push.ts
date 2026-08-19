/**
 * AI Agent — admin_commit_push tool
 *
 * SYSTEM ADMIN ONLY. Saves the admin's source edits directly to GitHub: stages
 * every working-tree change, commits with an automatically generated
 * conventional-commit message (or an explicit `message`), then pushes the
 * current branch through the GitHub REST API (the deployment's single stored
 * GitHub token) — the same path the /push command and the dashboard Git tab
 * use, so no git credentials are needed on the host. When the working tree is
 * clean but the branch still has unpushed commits, the tool pushes those
 * instead, so a push that failed once can be retried with the same call.
 */

import type { ToolMeta, ToolContext } from '../agent-tool.types.js';
import {
  requireSystemAdmin,
  generateCommitMessage,
} from '../lib/admin-source-tools.lib.js';
import { getStoredGitHubConfig } from '@/engine/repos/github-config.repo.js';
import {
  getGitStatus,
  stagePaths,
  commitStaged,
  pushCurrent,
} from '@/server/lib/local-git.lib.js';

// ============================================================================
// TOOL DEFINITION
// ============================================================================

export const meta: ToolMeta = {
  name: 'admin_commit_push',
  description:
    'SYSTEM ADMIN ONLY — commit and push ALL pending source changes to the ' +
    'GitHub repository. Stages every working-tree change, commits, then pushes ' +
    'the current branch through the GitHub API (no git credentials needed). ' +
    'When `message` is omitted a conventional-commit message is generated ' +
    'automatically from the changed files (e.g. "feat(packages/cat-bot): add ' +
    'ping.ts"). Call this after admin_add_command / admin_edit_command to ' +
    'persist the AI\u2019s changes directly. When there are no changes but unpushed ' +
    'commits exist, it pushes those commits instead (a failed push can be ' +
    'retried with this same tool).',
  parameters: {
    type: 'object',
    properties: {
      message: {
        type: 'string',
        description:
          'Optional explicit commit message. When omitted, an appropriate ' +
          'conventional-commit message is generated automatically from the ' +
          'changed files.',
      },
    },
    required: [],
  },
  adminOnly: true,
};

// ============================================================================
// TOOL RUN
// ============================================================================

export const initialize = async (
  { message }: { message?: string },
  ctx: ToolContext,
): Promise<string> => {
  const denial = await requireSystemAdmin(ctx);
  if (denial) return denial;
  try {
    const status = await getGitStatus();

    // Clean tree but unpushed commits → plain push (retry path).
    if (status.changes.length === 0) {
      if (status.ahead > 0) {
        const pushSummary = await pushCurrent();
        return (
          `Working tree is clean; pushed the ${status.ahead} unpushed commit${status.ahead === 1 ? '' : 's'}.\n` +
          pushSummary
        );
      }
      return 'Nothing to commit — the working tree is clean and there are no unpushed commits.';
    }

    const explicit = String(message ?? '').trim();
    const commitMessage =
      explicit !== '' ? explicit : generateCommitMessage(status.changes);

    // Author the local commit with the stored GitHub identity when connected,
    // so the bot's commits carry the account that owns the deployment token.
    const stored = await getStoredGitHubConfig();
    const commitIdentity = stored
      ? {
          name: stored.name ?? stored.login,
          email: stored.email ?? `${stored.login}@users.noreply.github.com`,
        }
      : undefined;

    await stagePaths([]);
    const commit = await commitStaged(commitMessage, commitIdentity);

    let pushSummary: string;
    try {
      pushSummary = await pushCurrent();
    } catch (err) {
      return (
        `Committed ${commit.sha.slice(0, 7)} locally, but the push to GitHub failed: ` +
        `${err instanceof Error ? err.message : String(err)}. ` +
        'The commit is saved in this checkout — run admin_commit_push again ' +
        '(or use the dashboard Files > Git tab) once the issue is resolved.'
      );
    }

    return (
      `Committed ${commit.sha.slice(0, 7)} and pushed.\n` +
      `Commit message:\n${commitMessage}\n\n` +
      pushSummary
    );
  } catch (err) {
    return err instanceof Error ? err.message : String(err);
  }
};