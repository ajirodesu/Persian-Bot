/**
 * Typing Indicator Lib — dynamic "bot is typing" signal for the lifetime of a command.
 *
 * Native indicators (Discord ~10s, Telegram ~5s) auto-expire and must be re-issued.
 * withTypingIndicator fires immediately, refreshes on an interval, and tears down the
 * moment the wrapped promise settles — so the indicator tracks real processing time.
 *
 * In-flight guard prevents overlapping sendTypingIndicator calls from stacking up.
 *
 * Instant stop on send: ctx.chat.reply/replyMessage call stopTypingIndicator(threadID)
 * the moment a message is delivered, tearing down the interval before a next refresh tick
 * could resurrect it after the user has already seen the reply.
 */
import type {
  UnifiedApi,
  TypingAction,
  NamedStreamAttachment,
  NamedUrlAttachment,
} from '@/engine/adapters/models/api.model.js';
import { logger } from '@/engine/modules/logger/logger.lib.js';

// Below Telegram's ~5s expiry so the indicator never visibly drops during processing.
const TYPING_REFRESH_INTERVAL_MS = 4000;

// Keyed by threadID. Lets ctx.chat.reply/replyMessage tear down any active indicator
// without needing a direct reference to the controller that started it.
const activeStoppers = new Map<string, Set<() => void>>();
// Keyed by threadID. Lets ctx.chat.reply/replyMessage SWITCH the live indicator's
// content action (typing → uploading photo/video/audio) right before the media is sent.
const activeActionSwitches = new Map<string, Set<(action: TypingAction) => void>>();

function registerStopper(threadID: string, stop: () => void): () => void {
  if (!threadID) return () => {};
  let stoppers = activeStoppers.get(threadID);
  if (!stoppers) { stoppers = new Set(); activeStoppers.set(threadID, stoppers); }
  stoppers.add(stop);
  return () => {
    const set = activeStoppers.get(threadID);
    if (!set) return;
    set.delete(stop);
    if (set.size === 0) activeStoppers.delete(threadID);
  };
}

function registerActionSwitch(
  threadID: string,
  setAction: (action: TypingAction) => void,
): () => void {
  if (!threadID) return () => {};
  let switches = activeActionSwitches.get(threadID);
  if (!switches) { switches = new Set(); activeActionSwitches.set(threadID, switches); }
  switches.add(setAction);
  return () => {
    const set = activeActionSwitches.get(threadID);
    if (!set) return;
    set.delete(setAction);
    if (set.size === 0) activeActionSwitches.delete(threadID);
  };
}

/**
 * Registers a stop callback under threadID so stopTypingIndicator() can tear it down.
 * Exported so rich-message draft senders can plug their own refresh into the same mechanism.
 */
export function registerTypingStopper(threadID: string, stop: () => void): () => void {
  return registerStopper(threadID, stop);
}

/** Immediately halts every typing/thinking indicator active on threadID. No-op if none. */
export function stopTypingIndicator(threadID: string): void {
  if (!threadID) return;
  const stoppers = activeStoppers.get(threadID);
  if (!stoppers || stoppers.size === 0) return;
  for (const stop of stoppers) stop();
  activeStoppers.delete(threadID);
  activeActionSwitches.delete(threadID);
}

/**
 * Switches the live typing indicator on `threadID` to a new content action
 * (e.g. 'typing' → 'video') and fires the new action immediately so the
 * platform notice updates without waiting for the next refresh tick.
 *
 * Called by ctx.chat.reply/replyMessage right before media is delivered, so the
 * indicator reflects what the bot is ACTUALLY doing — Telegram shows "sending
 * photo…"/"sending video…" instead of a generic "typing…" during the upload.
 * No-op when no indicator is currently active on the thread (the reply path
 * tears the indicator down after each send, which is the desired behaviour).
 */
export function switchTypingIndicator(
  threadID: string,
  action: TypingAction,
): void {
  if (!threadID) return;
  const switches = activeActionSwitches.get(threadID);
  if (!switches || switches.size === 0) return;
  for (const setAction of switches) setAction(action);
}

/**
 * Runs `fn` while keeping a typing indicator alive on `threadID` for its entire duration.
 * Indicator failures are logged and swallowed — they must never delay command execution.
 * Torn down early either by `fn` settling, or by stopTypingIndicator(threadID) on message send.
 */
export async function withTypingIndicator<T>(
  api: UnifiedApi,
  threadID: string,
  fn: () => Promise<T>,
  action: TypingAction = 'typing',
): Promise<T> {
  if (!threadID) return fn();

  let inFlight = false;
  let stopped = false;
  // Mutable so switchTypingIndicator() can pivot the notice (typing → sending
  // photo/video/audio) the moment the command starts delivering media.
  let currentAction = action;

  const trigger = (): void => {
    if (stopped || inFlight) return;
    inFlight = true;
    void api.sendTypingIndicator(threadID, currentAction)
      .then(() => { inFlight = false; })
      .catch((err: unknown) => {
        inFlight = false;
        logger.debug('[typing-indicator] sendTypingIndicator failed', { platform: api.platform, threadID, action: currentAction, error: err });
      });
  };

  const stop = (): void => {
    if (stopped) return;
    stopped = true;
    clearInterval(interval);
  };

  // Fired by switchTypingIndicator(threadID, next): swap the action and send it
  // right away so the platform notice updates immediately, not on the next tick.
  // The in-flight guard may skip the immediate send (previous signal still in
  // flight) — the next refresh tick then carries the new action.
  const setAction = (next: TypingAction): void => {
    if (stopped || next === currentAction) return;
    currentAction = next;
    trigger();
  };

  const unregister = registerStopper(threadID, stop);
  const unregisterSwitch = registerActionSwitch(threadID, setAction);
  trigger();
  const interval: ReturnType<typeof setInterval> = setInterval(trigger, TYPING_REFRESH_INTERVAL_MS);

  try {
    return await fn();
  } finally {
    stop();
    unregister();
    unregisterSwitch();
  }
}

// ── Media-type → indicator action ─────────────────────────────────────────────
// Mirrors the webchat api's actionFromAttachments so every platform's indicator
// reflects the content actually being delivered. Priority when a reply carries
// several attachments: video > audio > photo > document.

const IMAGE_EXTENSIONS = new Set([
  'jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'avif', 'heic', 'heif',
  'svg', 'tiff', 'tif', 'ico',
]);
const VIDEO_EXTENSIONS = new Set([
  'mp4', 'mov', 'avi', 'webm', 'mkv', 'flv', 'wmv', 'm4v', 'mpeg', 'mpg',
]);
const AUDIO_EXTENSIONS = new Set([
  'mp3', 'aac', 'ogg', 'oga', 'opus', 'wav', 'flac', 'weba', 'wma', 'amr',
  'm4a', 'm4b', 'mka', 'mid', 'midi', 'caf', 'dts', 'mp2', 'ac3', 'eac3',
]);

/** Maps a filename/URL tail to a media category; null when no extension is present. */
function mediaTypeFromFilename(name: string): 'photo' | 'video' | 'audio' | null {
  const clean = name.split('?')[0]!.split('#')[0]!;
  const ext = clean.split('.').pop()?.toLowerCase() ?? '';
  if (!ext || !/^[a-z0-9]+$/.test(ext)) return null;
  if (IMAGE_EXTENSIONS.has(ext)) return 'photo';
  if (VIDEO_EXTENSIONS.has(ext)) return 'video';
  if (AUDIO_EXTENSIONS.has(ext)) return 'audio';
  return null;
}

/**
 * Derives the typing-indicator action from the attachments about to be sent.
 * Returns null for text-only replies (the default 'typing' notice stays correct).
 */
export function actionFromAttachments(
  attachment: NamedStreamAttachment[],
  attachment_url: NamedUrlAttachment[],
): TypingAction | null {
  // Rank: 0 = none, 1 = document (has a name but unknown/other extension),
  // 2 = photo, 3 = audio, 4 = video. Highest wins, mirroring the webchat order.
  let rank = 0;
  const names = [...attachment.map((a) => a.name), ...attachment_url.map((a) => a.name)];
  if (names.length === 0) return null;
  for (const name of names) {
    const type = mediaTypeFromFilename(name);
    if (type === 'video') rank = Math.max(rank, 4);
    else if (type === 'audio') rank = Math.max(rank, 3);
    else if (type === 'photo') rank = Math.max(rank, 2);
    else rank = Math.max(rank, 1);
  }
  if (rank === 0) return null;
  if (rank === 4) return 'video';
  if (rank === 3) return 'audio';
  if (rank === 2) return 'photo';
  return 'document';
}
