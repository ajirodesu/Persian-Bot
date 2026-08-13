/**
 * Fluxer — Unsupported Operation Stubs
 *
 * All operations that cannot be performed on Fluxer are grouped here to reduce
 * file clutter and provide a single location for unsupported method documentation.
 *
 * Fluxer Bot API limitations:
 *   - addUserToGroup: requires bot-managed invites / OAuth scopes — a regular bot
 *                     token has no member-invite endpoint, so this is unsupported.
 *   - setGroupReaction: Fluxer guilds do not have a thread-level default emoji concept.
 *   - setGroupImage / removeGroupImage: guild icon changes require Administrator /
 *                     are not available to regular bot tokens — unsupported.
 *
 * Command modules that call these should catch the thrown error and surface a
 * user-friendly message rather than letting the rejection bubble to the handler.
 */

/**
 * Unsupported: Fluxer bots cannot add arbitrary users to a guild — users must
 * join via an invite link.
 */
export async function addUserToGroup(): Promise<never> {
  throw new Error(
    'addUserToGroup is not supported on Fluxer — users must join via an invite link.',
  );
}

/**
 * Unsupported: Fluxer guilds do not have a thread-level default emoji — no equivalent concept.
 */
export async function setGroupReaction(): Promise<never> {
  throw new Error('setGroupReaction is not supported on Fluxer.');
}

/**
 * Unsupported: Fluxer bots cannot change a guild icon — users must update it via
 * the client, or the bot needs guild-owner admin rights.
 */
export async function setGroupImage(): Promise<never> {
  throw new Error('setGroupImage is not supported on Fluxer.');
}

/**
 * Unsupported: Fluxer bots cannot remove a guild icon — users must update it via
 * the client, or the bot needs guild-owner admin rights.
 */
export async function removeGroupImage(): Promise<never> {
  throw new Error('removeGroupImage is not supported on Fluxer.');
}