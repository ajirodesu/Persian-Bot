/**
 * Reaction-Emoji Repo — session-wide command-success reaction emoji.
 *
 * Single source of truth for the value the command dispatcher reacts with
 * after a successful command. Both the web dashboard (bot-session-config
 * controller's reaction-emoji endpoints) and the dispatcher read/write the
 * SAME fields through these functions, so dashboard edits apply live to the
 * very next command with no restart and no env reload.
 *
 * Schema (db.bot → 'session_settings' collection):
 *   reactionEmoji  string  — emoji validated for the session's platform
 */
import { createBotCollectionManager } from '@/engine/lib/db-collection.lib.js';
import {
  DEFAULT_COMMAND_REACT_EMOJI,
  isValidReactionEmoji,
} from '@/engine/constants/reaction-emoji.constants.js';

const SETTINGS_COLLECTION = 'session_settings';
const REACTION_EMOJI_KEY = 'reactionEmoji';

/** Bootstraps the shared session_settings collection on first use — mirrors admin-only.repo.ts. */
async function getSessionSettingsHandle(
  userId: string,
  platform: string,
  sessionId: string,
) {
  const coll = createBotCollectionManager(userId, platform, sessionId);
  if (!(await coll.isCollectionExist(SETTINGS_COLLECTION))) {
    await coll.createCollection(SETTINGS_COLLECTION);
    const h = await coll.getCollection(SETTINGS_COLLECTION);
    await h.set('adminOnlyEnabled', false);
    await h.set('adminOnlyHideNoti', false);
    await h.set('adminOnlyIgnoreList', []);
    return h;
  }
  return coll.getCollection(SETTINGS_COLLECTION);
}

/**
 * Returns the emoji the bot should react with on a successfully executed
 * command for this session, or the default when none has been configured.
 * Reads through createBotCollectionManager → getBotSessionData, which is
 * LRU-cached (session.repo.ts), so the hot command path makes zero DB reads
 * once the session blob is warm.
 */
export async function getSessionReactionEmoji(
  userId: string,
  platform: string,
  sessionId: string,
): Promise<string> {
  const handle = await getSessionSettingsHandle(userId, platform, sessionId);
  const emoji = (await handle.get(REACTION_EMOJI_KEY)) as string | null;
  return emoji || DEFAULT_COMMAND_REACT_EMOJI;
}

/**
 * Persists the session-wide reaction emoji. Validates against the session's
 * platform (Telegram accepts only its documented set; Discord accepts unicode
 * or custom-emoji references) and rejects invalid values with an Error the
 * controller surfaces as a 400. The write flows through setBotSessionData,
 * which refreshes the session-data LRU entry — immediate live effect.
 */
export async function setSessionReactionEmoji(
  userId: string,
  platform: string,
  sessionId: string,
  emoji: string,
): Promise<void> {
  const trimmed = emoji.trim();
  if (!isValidReactionEmoji(platform, trimmed)) {
    throw new Error(
      `Invalid reaction emoji for platform "${platform}". ` +
        (platform === 'telegram'
          ? 'Choose an emoji from the supported Telegram set.'
          : 'Use a standard unicode emoji or a custom Discord emoji reference.'),
    );
  }
  const handle = await getSessionSettingsHandle(userId, platform, sessionId);
  await handle.set(REACTION_EMOJI_KEY, trimmed);
}
