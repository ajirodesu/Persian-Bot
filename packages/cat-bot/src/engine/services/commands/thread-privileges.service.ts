/**
 * Thread Privileges — shared moderation authorization checks.
 *
 * Several thread-scoped moderation commands (antispam, autotrans, badwords,
 * download, rules, warn) gate their settings subcommands behind the same rule:
 * thread admins, bot admins, and system admins are allowed. Keeping the check
 * here ensures every command makes the same decision and handles the
 * undocumented adminIDs shape identically.
 */

import { isBotAdmin } from '@/engine/repos/credentials.repo.js';
import { isSystemAdmin } from '@/engine/repos/system-admin.repo.js';
import type { AppCtx } from '@/engine/types/controller.types.js';

/** Best-effort thread-admin check via thread.getInfo(). */
export async function isThreadAdmin(
  thread: AppCtx['thread'],
  senderID: string,
): Promise<boolean> {
  try {
    const info = (await thread.getInfo()) as unknown as Record<string, unknown>;
    const adminIDs = info['adminIDs'] as
      Array<string | { uid: string }> | undefined;
    if (!Array.isArray(adminIDs)) return false;
    return adminIDs.some(
      (admin) => (typeof admin === 'string' ? admin : admin.uid) === senderID,
    );
  } catch {
    return false;
  }
}

/**
 * Returns true when the sender is a thread admin, bot admin, or system admin.
 * Bot and system admins inherit moderation privileges even when they are not
 * group/thread admins.
 */
export async function isPrivilegedUser(
  thread: AppCtx['thread'],
  native: AppCtx['native'],
  senderID: string,
): Promise<boolean> {
  if (await isSystemAdmin(senderID)) return true;

  const { userId, platform, sessionId } = native;
  if (userId && platform && sessionId) {
    if (await isBotAdmin(userId, platform, sessionId, senderID)) return true;
  }

  return isThreadAdmin(thread, senderID);
}
