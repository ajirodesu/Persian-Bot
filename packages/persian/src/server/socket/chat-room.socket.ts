/**
 * Chat Room Socket Handler
 *
 * Provides a real-time web-based chat interface that routes messages through
 * the full Persian engine (handleMessage, handleButtonAction, all handlers).
 *
 * Each connected socket gets its own WebChatApi instance that captures all
 * bot outputs and streams them back to the client in real-time.
 *
 * Sessions are keyed by stable sessionId (from localStorage) — NOT socket.id —
 * so history survives page navigation, refreshes, and reconnects.
 * Sessions are never deleted on disconnect or exit; only cleared on explicit
 * chatroom:clear. A max-session cap prevents unbounded memory growth.
 */

import type { Readable } from 'stream';
import type { Server as SocketIOServer, Socket } from 'socket.io';
import { UnifiedApi } from '@/engine/adapters/models/api.model.js';
import type {
  SendPayload,
  ReplyMessageOptions,
  EditMessageOptions,
  ButtonItem,
} from '@/engine/adapters/models/api.model.js';
import { handleMessage } from '@/engine/controllers/handlers/message.handler.js';
import { handleButtonAction } from '@/engine/controllers/dispatchers/button.dispatcher.js';
import type { CommandMap, EventModuleMap, NativeContext } from '@/engine/types/controller.types.js';
import { commandRegistry } from '@/engine/lib/module-registry.lib.js';
import { logger } from '@/engine/modules/logger/logger.lib.js';
import { MessageStyle } from '@/engine/constants/message-style.constants.js';
import { Platforms } from '@/engine/modules/platform/platform.constants.js';
import {
  upsertUser,
  upsertUserSession,
} from '@/engine/repos/users.repo.js';
import {
  upsertThread,
  upsertThreadSession,
} from '@/engine/repos/threads.repo.js';
import { toBotUserData } from '@/engine/models/users.model.js';
import { toBotThreadData } from '@/engine/models/threads.model.js';
import { createCollectionManager } from '@/engine/lib/db-collection.lib.js';

// ── Types ────────────────────────────────────────────────────────────────────

export interface ChatMessage {
  id: string;
  type: 'user' | 'bot';
  text: string;
  timestamp: number;
  style?: string;
  replyTo?: string | null;
  buttons?: BotButton[][];
  attachments?: ChatAttachment[];
}

export interface BotButton {
  id: string;
  label: string;
  style?: string;
}

export interface ChatAttachment {
  type: 'image' | 'video' | 'audio' | 'file';
  url?: string;
  name?: string;
  /** Explicit MIME type — used by the <audio> renderer to pick the right decoder. */
  mime?: string;
}

interface StoredSession {
  messages: ChatMessage[];
  prefix: string;
  botNickname: string;
  /** Stable identity key for this chat — the logged-in account's real userId when
   *  available, falling back to the anonymous webchat session id otherwise. All
   *  economy/session-scoped commands (balance, daily, button ownership, etc.) key
   *  off this value, so it MUST stay consistent between chatroom:message and
   *  chatroom:button_click for the same person. */
  userId: string;
  /** Full display name — the account's login name (Better Auth `user.name`). */
  userName: string;
  /** Handle derived from userName (e.g. "Ken Iwato" → "keniwato"). */
  username: string;
  /** Account avatar/profile picture URL (Better Auth `user.image`), if any. */
  avatarUrl: string | null;
  lastSeen: number;
}

// ── Session Store ─────────────────────────────────────────────────────────────
// Keyed by stable sessionId (from client localStorage), not ephemeral socket.id.

const MAX_SESSIONS = 500;
const sessions = new Map<string, StoredSession>();

function getSession(sessionId: string): StoredSession {
  let session = sessions.get(sessionId);
  if (!session) {
    // Evict oldest session if cap reached
    if (sessions.size >= MAX_SESSIONS) {
      let oldestKey = '';
      let oldestTime = Infinity;
      for (const [key, s] of sessions) {
        if (s.lastSeen < oldestTime) {
          oldestTime = s.lastSeen;
          oldestKey = key;
        }
      }
      if (oldestKey) sessions.delete(oldestKey);
    }
    session = {
      messages: [],
      prefix: '/',
      botNickname: 'Persian',
      userId: 'web-user',
      userName: 'You',
      username: 'webuser',
      avatarUrl: null,
      lastSeen: Date.now(),
    };
    sessions.set(sessionId, session);
  } else {
    session.lastSeen = Date.now();
  }
  return session;
}

function generateId(): string {
  return `msg-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

/**
 * Derives a username handle from a full display name, mirroring the convention
 * used across the platform: "Ken Iwato" → "keniwato". Lowercases, strips every
 * character that is not a-z/0-9, and falls back to "user" if nothing remains
 * (e.g. a name made up entirely of emoji/symbols).
 */
function deriveUsername(fullName: string): string {
  const handle = (fullName || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '') // strip diacritics so "José" → "jose"
    .replace(/[^a-z0-9]/g, '');
  return handle || 'user';
}

// ── DB persistence (parity with Discord/Telegram) ──────────────────────────────
//
// Discord/Telegram each persist data under a "bot session" scope of
// (ownerUserId, platform, sessionId) — see createDiscordListener's config.userId/
// sessionId. The web chat room has no separate bot deployment; the logged-in
// ACCOUNT itself is both the owner and the only participant, so every account
// gets one fixed, permanent scope: (accountId, 'webchat', WEBCHAT_SESSION_ID).
// This is what lets /balance, /daily, and any other command's session data
// (bot_users_session.data) survive process restarts exactly like it does for
// Discord/Telegram — the row lives in the configured DATABASE_TYPE adapter
// (mongodb/neondb), not in this file's in-memory Map.
const WEBCHAT_SESSION_ID = 'webchat';

/** One stable thread per account (their private chat with the bot) regardless
 *  of how many browser tabs/devices/localStorage sessionIds they use. */
function webchatThreadId(accountUserId: string): string {
  return `webchat-${accountUserId}`;
}

/**
 * Registers the account as a bot_users / bot_threads participant and stamps
 * bot_users_session / bot_threads_session rows into the chosen DB adapter —
 * the exact same two-step (sync user, then thread) that on-chat.middleware
 * runs for every Discord/Telegram message. Without this, setUserSessionData/
 * setThreadSessionData silently no-op forever because the parent session row
 * never exists (see users.repo "Silently skips when the record is absent").
 *
 * Safe to call on every join — both upserts are idempotent — and failures are
 * logged, never thrown, so a DB hiccup never breaks the chat room itself.
 */
async function ensureWebchatIdentitySynced(
  api: WebChatApi,
  accountUserId: string,
): Promise<void> {
  if (!accountUserId || accountUserId === 'web-user') return; // not logged in — nothing to persist
  try {
    const userInfo = await api.getFullUserInfo(accountUserId);
    await upsertUser(toBotUserData(userInfo));
    await upsertUserSession(
      accountUserId,
      Platforms.Webchat,
      WEBCHAT_SESSION_ID,
      accountUserId,
    );

    const threadId = webchatThreadId(accountUserId);
    const threadInfo = await api.getFullThreadInfo(threadId);
    await upsertThread(toBotThreadData(threadInfo));
    await upsertThreadSession(
      accountUserId,
      Platforms.Webchat,
      WEBCHAT_SESSION_ID,
      threadId,
    );
  } catch (err: unknown) {
    logger.warn('⚠️ [chat-room] Failed to sync webchat identity to DB — continuing', {
      error: err,
      accountUserId,
    });
  }
}

interface PersistedWebchatSettings {
  prefix: string | undefined;
  botNickname: string | undefined;
}

/** Reads the account's persisted prefix/nickname from bot_users_session.data —
 *  survives restarts since it lives in the real DB, not this file's in-memory Map. */
async function loadPersistedWebchatSettings(
  accountUserId: string,
): Promise<PersistedWebchatSettings | null> {
  if (!accountUserId || accountUserId === 'web-user') return null;
  try {
    const collManager = createCollectionManager(
      accountUserId,
      Platforms.Webchat,
      WEBCHAT_SESSION_ID,
    );
    const userColl = collManager(accountUserId);
    if (!(await userColl.isCollectionExist('webchat_settings'))) return null;
    const settings = await userColl.getCollection('webchat_settings');
    const prefix = (await settings.get('prefix')) as string | undefined;
    const botNickname = (await settings.get('botNickname')) as
      | string
      | undefined;
    return { prefix, botNickname };
  } catch (err: unknown) {
    logger.warn('⚠️ [chat-room] Failed to load persisted webchat settings', {
      error: err,
      accountUserId,
    });
    return null;
  }
}

/** Writes prefix/nickname back to bot_users_session.data so they outlive a
 *  server restart instead of only living in this file's in-memory sessions Map. */
async function persistWebchatSettings(
  accountUserId: string,
  patch: Partial<PersistedWebchatSettings>,
): Promise<void> {
  if (!accountUserId || accountUserId === 'web-user') return;
  try {
    const collManager = createCollectionManager(
      accountUserId,
      Platforms.Webchat,
      WEBCHAT_SESSION_ID,
    );
    const userColl = collManager(accountUserId);
    if (!(await userColl.isCollectionExist('webchat_settings'))) {
      await userColl.createCollection('webchat_settings');
    }
    const settings = await userColl.getCollection('webchat_settings');
    if (patch.prefix !== undefined) await settings.set('prefix', patch.prefix);
    if (patch.botNickname !== undefined) {
      await settings.set('botNickname', patch.botNickname);
    }
  } catch (err: unknown) {
    logger.warn('⚠️ [chat-room] Failed to persist webchat settings', {
      error: err,
      accountUserId,
    });
  }
}

// ── WebChatApi ────────────────────────────────────────────────────────────────

/**
 * Platform adapter for the web chat room.
 * Captures all bot outputs and forwards them to the connected socket client.
 */
class WebChatApi extends UnifiedApi {
  override platform = Platforms.Webchat;
  private socket: Socket;
  private sessionId: string;

  constructor(socket: Socket, sessionId: string) {
    super();
    this.socket = socket;
    this.sessionId = sessionId;
  }

  private resolveText(msg: string | SendPayload | undefined): string {
    if (!msg) return '';
    if (typeof msg === 'string') return msg;
    return msg.message ?? msg.body ?? '';
  }

  /**
   * Derives the `ChatAttachment` type from a filename extension.
   * Covers every mainstream audio container/codec so the webchat renderer picks
   * the right element (<audio> vs <video> vs generic file pill) regardless of
   * which command produced the file.
   */
  private static extToType(name: string): ChatAttachment['type'] {
    const ext = name.split('.').pop()?.split('?')[0]?.toLowerCase() ?? '';
    if (['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg', 'bmp', 'avif', 'heic', 'heif', 'ico', 'tiff', 'tif'].includes(ext)) return 'image';
    if (['mp4', 'mov', 'avi', 'webm', 'mkv', 'flv', 'wmv', 'm4v', 'mpeg', 'mpg', '3gpp', '3g2'].includes(ext)) return 'video';
    if ([
      // Lossy / compressed
      'mp3', 'aac', 'ogg', 'oga', 'opus', 'weba', 'wma', 'amr', 'ra', 'rm', 'spx',
      // Lossless
      'wav', 'flac', 'aiff', 'aif', 'alac', 'ape', 'au', 'dsd',
      // Container / other
      'm4a', 'm4b', 'mka', 'mid', 'midi', 'caf', 'dts', 'mp2', 'ac3', 'eac3',
    ].includes(ext)) return 'audio';
    return 'file';
  }

  /**
   * Maps an audio file extension to the correct MIME type for data: URLs.
   * The browser's <audio> element uses the MIME type to pick a decoder.
   */
  private static extToMime(ext: string): string {
    const map: Record<string, string> = {
      mp3: 'audio/mpeg', mp2: 'audio/mpeg',
      aac: 'audio/aac', ac3: 'audio/ac3', eac3: 'audio/eac3',
      ogg: 'audio/ogg', oga: 'audio/ogg', opus: 'audio/ogg',
      wav: 'audio/wav',
      flac: 'audio/flac',
      weba: 'audio/webm',
      wma: 'audio/x-ms-wma',
      amr: 'audio/amr',
      ra: 'audio/x-realaudio', rm: 'audio/x-realaudio',
      spx: 'audio/x-speex',
      aiff: 'audio/x-aiff', aif: 'audio/x-aiff',
      au: 'audio/basic',
      m4a: 'audio/mp4', m4b: 'audio/mp4', alac: 'audio/mp4',
      mka: 'audio/x-matroska',
      mid: 'audio/midi', midi: 'audio/midi',
      caf: 'audio/x-caf',
      dts: 'audio/vnd.dts',
      ape: 'audio/x-ape',
      // image
      jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png',
      gif: 'image/gif', webp: 'image/webp', svg: 'image/svg+xml',
      bmp: 'image/bmp', avif: 'image/avif', heic: 'image/heic', heif: 'image/heif',
      ico: 'image/x-icon', tiff: 'image/tiff', tif: 'image/tiff',
      // video
      mp4: 'video/mp4', mov: 'video/quicktime', avi: 'video/x-msvideo',
      webm: 'video/webm', mkv: 'video/x-matroska', flv: 'video/x-flv',
      wmv: 'video/x-ms-wmv', m4v: 'video/mp4', mpeg: 'video/mpeg', mpg: 'video/mpeg',
    };
    return map[ext] ?? 'application/octet-stream';
  }

  /** Drains a Readable into a Buffer. */
  private static async streamToBuffer(stream: Readable): Promise<Buffer> {
    return new Promise<Buffer>((resolve, reject) => {
      const chunks: Buffer[] = [];
      stream.on('data', (chunk: Buffer | string) =>
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)),
      );
      stream.on('end', () => resolve(Buffer.concat(chunks)));
      stream.on('error', reject);
    });
  }

  /**
   * Resolves all attachments from options into wire-safe ChatAttachment entries.
   *
   * Handles both delivery paths:
   *   • attachment[]      — NamedStreamAttachment (Buffer or Readable) from commands like
   *                         /play and /say. Converted to base64 data: URLs so socket.io
   *                         can carry them without a separate HTTP download step.
   *   • attachment_url[]  — NamedUrlAttachment (remote URL). Passed through as-is; the
   *                         frontend fetches the resource directly from the URL.
   *
   * Extension detection covers every mainstream audio format so the <audio> element
   * renders correctly regardless of codec or container.
   */
  private async resolveAttachments(
    options: ReplyMessageOptions | EditMessageOptions | SendPayload,
  ): Promise<ChatAttachment[]> {
    const attachments: ChatAttachment[] = [];

    // ── Stream / Buffer attachments (/play, /say, etc.) ──────────────────────
    const streamArr = 'attachment' in options ? options.attachment : undefined;
    if (Array.isArray(streamArr) && streamArr.length > 0) {
      for (const item of streamArr as Array<{ name: string; stream: Readable | Buffer }>) {
        const name = item.name ?? 'audio';
        const ext = name.split('.').pop()?.toLowerCase() ?? '';
        const mime = WebChatApi.extToMime(ext) || 'application/octet-stream';
        const type = WebChatApi.extToType(name);
        try {
          const buf = Buffer.isBuffer(item.stream)
            ? item.stream
            : await WebChatApi.streamToBuffer(item.stream as Readable);
          const dataUrl = `data:${mime};base64,${buf.toString('base64')}`;
          attachments.push({ type, url: dataUrl, name, mime });
        } catch (err) {
          logger.warn('[chat-room] Failed to encode stream attachment', { name, err });
        }
      }
    }

    // ── URL attachments (attachment_url[]) ────────────────────────────────────
    const urlArr = 'attachment_url' in options ? options.attachment_url : undefined;
    if (Array.isArray(urlArr)) {
      for (const item of urlArr) {
        const name = item.name ?? '';
        const url = item.url ?? '';
        const type = WebChatApi.extToType(name);
        const ext = name.split('.').pop()?.toLowerCase() ?? '';
        const mime = WebChatApi.extToMime(ext);
        attachments.push({ type, url, name, mime });
      }
    }

    return attachments;
  }

  private resolveButtons(
    buttons: ButtonItem[][] | undefined,
  ): BotButton[][] | undefined {
    if (!buttons || buttons.length === 0) return undefined;
    return buttons.map((row) =>
      row.map((btn): BotButton => {
        const b: BotButton = { id: btn.id, label: btn.label };
        if (btn.style != null) b.style = String(btn.style);
        return b;
      }),
    );
  }

  private buildMsg(
    text: string,
    opts: {
      style?: string;
      buttons?: BotButton[][];
      attachments?: ChatAttachment[];
      replyTo?: string | null;
      messageId?: string;
    },
  ): ChatMessage {
    const msg: ChatMessage = {
      id: opts.messageId ?? generateId(),
      type: 'bot',
      text,
      timestamp: Date.now(),
    };
    if (opts.style != null) msg.style = opts.style;
    if (opts.replyTo != null) msg.replyTo = opts.replyTo;
    if (opts.buttons != null) msg.buttons = opts.buttons;
    if (opts.attachments != null && opts.attachments.length > 0) {
      msg.attachments = opts.attachments;
    }
    return msg;
  }

  private storeAndEmit(msg: ChatMessage): void {
    const session = getSession(this.sessionId);
    session.messages.push(msg);
    this.socket.emit('chatroom:bot_message', msg);
  }

  override async sendMessage(
    msg: string | SendPayload,
    _threadID: string,
  ): Promise<string | undefined> {
    const text = this.resolveText(msg);
    const attachments =
      typeof msg !== 'string' ? await this.resolveAttachments(msg) : [];
    const built = this.buildMsg(text, { attachments });
    this.storeAndEmit(built);
    return built.id;
  }

  override async replyMessage(
    _threadID: string,
    options: ReplyMessageOptions = {},
  ): Promise<unknown> {
    const raw = options.message;
    const text = this.resolveText(
      typeof raw === 'string' ? raw : (raw as SendPayload | undefined),
    );
    const style =
      options.style === MessageStyle.MARKDOWN ? 'markdown' : undefined;
    const buttons = this.resolveButtons(options.button);
    const attachments = await this.resolveAttachments(options);
    const built = this.buildMsg(text, {
      ...(style !== undefined && { style }),
      ...(buttons !== undefined && { buttons }),
      ...(attachments.length > 0 && { attachments }),
    });
    this.storeAndEmit(built);
    return built.id;
  }

  override async editMessage(
    messageID: string,
    options: string | EditMessageOptions,
  ): Promise<void> {
    const session = getSession(this.sessionId);

    let text = '';
    let style: string | undefined;
    let buttons: BotButton[][] | undefined;
    let attachments: ChatAttachment[] | undefined;
    let targetId = messageID;

    if (typeof options === 'string') {
      text = options;
    } else {
      const raw = options.message;
      text = this.resolveText(
        typeof raw === 'string' ? raw : (raw as SendPayload | undefined),
      );
      if (options.style === MessageStyle.MARKDOWN) style = 'markdown';
      buttons = this.resolveButtons(options.button);
      attachments = await this.resolveAttachments(options);
      if (options.message_id_to_edit) {
        targetId = options.message_id_to_edit;
      }
    }

    const existing = session.messages.find((m) => m.id === targetId);
    if (existing) {
      existing.text = text;
      if (style !== undefined) existing.style = style;
      if (buttons !== undefined) existing.buttons = buttons;
      if (attachments !== undefined && attachments.length > 0) {
        existing.attachments = attachments;
      }
    } else {
      const built = this.buildMsg(text, {
        ...(style !== undefined && { style }),
        ...(buttons !== undefined && { buttons }),
        ...(attachments !== undefined && attachments.length > 0 && { attachments }),
      });
      this.storeAndEmit(built);
      return;
    }

    const editPayload: Record<string, unknown> = { id: targetId, text };
    if (style !== undefined) editPayload['style'] = style;
    if (buttons !== undefined) editPayload['buttons'] = buttons;
    if (attachments !== undefined) editPayload['attachments'] = attachments;
    this.socket.emit('chatroom:bot_edit', editPayload);
  }

  override async unsendMessage(messageID: string): Promise<void> {
    const session = getSession(this.sessionId);
    const idx = session.messages.findIndex((m) => m.id === messageID);
    if (idx !== -1) {
      session.messages.splice(idx, 1);
    }
    this.socket.emit('chatroom:bot_delete', { id: messageID });
  }

  override async getUserInfo(
    _userIds: string[],
  ): Promise<Record<string, { name: string }>> {
    const session = getSession(this.sessionId);
    return Object.fromEntries(
      _userIds.map((id) => [
        id,
        {
          name:
            id === session.userId
              ? session.userName
              : id,
        },
      ]),
    );
  }

  /**
   * Full unified user profile — required by ctx.user.getInfo() which is what
   * users.service.syncUser() calls before upserting bot_users / bot_users_session.
   * Without this override (the UnifiedApi base throws "not implemented"), the
   * Discord/Telegram-style DB sync pipeline silently fails for every webchat
   * user and no bot_users_session row is ever created — which is why economy
   * data (/daily, /balance, custom command data) never actually persisted.
   */
  override async getFullUserInfo(
    userID: string,
  ): Promise<import('@/engine/adapters/models/user.model.js').UnifiedUserInfo> {
    const session = getSession(this.sessionId);
    const isSelf = userID === session.userId;
    return {
      platform: this.platform,
      id: userID,
      name: isSelf ? session.userName || 'You' : userID,
      firstName: null,
      username: isSelf ? session.username : null,
      avatarUrl: isSelf ? (session.avatarUrl ?? null) : null,
    };
  }

  /**
   * Full unified thread profile — required by ctx.thread.getInfo(), called by
   * threads.service.syncThreadAndParticipants() before upserting bot_threads /
   * bot_threads_session. Each account gets exactly one stable thread (their
   * private 1:1 chat with the bot) regardless of how many devices/tabs they
   * use — see webchatThreadId().
   */
  override async getFullThreadInfo(
    threadID: string,
  ): Promise<import('@/engine/adapters/models/thread.model.js').UnifiedThreadInfo> {
    const session = getSession(this.sessionId);
    return {
      platform: this.platform,
      threadID,
      name: 'Persian Chat',
      isGroup: false,
      memberCount: 2,
      participantIDs: session.userId ? [session.userId] : [],
      // The webchat chat room is the user's own private 1:1 thread — they are
      // always the admin of their own conversation. Populating adminIDs here
      // seeds the thread admin cache (threads.repo isThreadAdmin) so Role.THREAD_ADMIN
      // commands work correctly. Without this the cache always resolves to false
      // and every THREAD_ADMIN-gated command is silently denied.
      adminIDs: session.userId ? [session.userId] : [],
      avatarUrl: null,
      serverID: null,
    };
  }

  override async getBotID(): Promise<string> {
    return 'persian';
  }

  override async getUserName(userID: string): Promise<string> {
    const session = getSession(this.sessionId);
    if (userID === session.userId) return session.userName;
    return userID;
  }

  override async getThreadName(_threadID: string): Promise<string> {
    return 'Persian Chat';
  }

  override async getMemberCount(_threadID: string): Promise<number> {
    return 2;
  }
}

// ── Socket Handler Registration ───────────────────────────────────────────────

export function registerChatRoomHandlers(io: SocketIOServer): void {
  io.on('connection', (socket) => {
    // sessionId is set when the client emits chatroom:join
    let activeSessionId = '';

    function getCommands(): CommandMap {
      return commandRegistry as unknown as CommandMap;
    }

    function getEventModules(): EventModuleMap {
      return new Map();
    }

    function getNative(): NativeContext {
      // Previously this intentionally omitted userId/sessionId because passing
      // empty/fake values would make every DB-backed feature fail (the on-chat
      // sync middleware requires platform+threadID+userId+sessionId ALL present
      // before it'll upsert bot_users/bot_threads — see chatPassthrough). But
      // omitting them meant that sync NEVER ran for webchat at all: no
      // bot_users_session row was ever created, so every command's persisted
      // data (economy, /daily, custom command state via db.users.collection)
      // silently no-op'd forever — not just "after a restart", always.
      //
      // Now that WebChatApi implements getFullUserInfo/getFullThreadInfo (so the
      // sync pipeline has something real to write), we supply the SAME identity
      // used everywhere else in this file: the logged-in account's real id as
      // userId, and the fixed WEBCHAT_SESSION_ID as sessionId — exactly mirroring
      // how a Discord/Telegram bot session is scoped to (ownerUserId, sessionId).
      // This makes the web bot's database behave identically to Discord/Telegram:
      // real rows, in the same chosen DATABASE_TYPE adapter, surviving restarts.
      //
      // webchatNickname is forwarded to ai.ts onChat so the user's custom bot
      // nickname triggers the AI assistant exactly like Discord/Telegram.
      const session = activeSessionId ? sessions.get(activeSessionId) : undefined;
      const hasRealAccount = !!session?.userId && session.userId !== 'web-user';
      return {
        platform: Platforms.Webchat,
        ...(hasRealAccount
          ? { userId: session!.userId, sessionId: WEBCHAT_SESSION_ID }
          : {}),
        ...(session?.botNickname ? { webchatNickname: session.botNickname } : {}),
      };
    }

    // ── chatroom:join ──────────────────────────────────────────────────────
    socket.on(
      'chatroom:join',
      (data: {
        sessionId: string;
        prefix?: string;
        botNickname?: string;
        userId?: string;
        userName?: string;
        username?: string;
        avatarUrl?: string;
        messages?: ChatMessage[];
      }) => {
        activeSessionId = data.sessionId;
        const session = getSession(activeSessionId);
        const isColdSession = session.messages.length === 0;

        // Rehydrate a cold session (server restarted, in-memory `sessions` Map
        // wiped) with the message history the client already has in
        // localStorage. Without this, session.messages stays empty while the
        // client still shows old bot messages with buttons attached — clicking
        // one of those buttons targets a messageID editMessage() can't find,
        // so it silently falls back to sending a brand-new message instead of
        // editing the original. Only trust this on a cold session: once the
        // server has its own history, client-submitted messages are ignored.
        if (
          isColdSession &&
          Array.isArray(data.messages) &&
          data.messages.length > 0
        ) {
          session.messages = data.messages.filter(
            (m): m is ChatMessage =>
              !!m && typeof m.id === 'string' && typeof m.text === 'string',
          );
        }

        // Always sync display preferences — they can change any time.
        // userId is the account's REAL id (Better Auth user.id) when the visitor
        // is logged in — this is the identity economy commands, button-ownership
        // scoping, and per-session command toggles all key off. Falling back to
        // the previously-stored value keeps anonymous sessions stable across
        // reconnects instead of silently resetting to 'web-user' each time.
        if (data.botNickname) session.botNickname = data.botNickname;
        if (data.userId) session.userId = data.userId;
        if (data.userName) session.userName = data.userName;
        if (data.avatarUrl) session.avatarUrl = data.avatarUrl;
        // Prefer the client-derived handle (kept in sync with the account's full
        // name) but always have a safe server-side fallback so a stale/old client
        // build still gets a usable username.
        session.username = data.username || deriveUsername(session.userName);

        // Only set prefix from client if session is brand new
        if (isColdSession && data.prefix) session.prefix = data.prefix;

        const webChatApi = new WebChatApi(socket, activeSessionId);

        // Register this account into bot_users/bot_threads (and their _session
        // rows) in the chosen DATABASE_TYPE adapter — same pipeline Discord and
        // Telegram run on every message — so /balance, /daily, and any other
        // command's persisted data actually survives a server restart instead
        // of silently no-op'ing because the parent session row never existed.
        void ensureWebchatIdentitySynced(webChatApi, session.userId).then(
          async () => {
            // On a cold session (server restarted / first visit on this device),
            // restore prefix/nickname from the DB if the client didn't already
            // supply them — the in-memory Map above is wiped on every restart,
            // but bot_users_session.data is not.
            if (isColdSession) {
              const persisted = await loadPersistedWebchatSettings(
                session.userId,
              );
              if (persisted?.prefix && !data.prefix) {
                session.prefix = persisted.prefix;
                // History was already emitted with the in-memory default prefix
                // before this DB read resolved — push the restored value so the
                // client's command parsing/placeholder text reflects it too.
                socket.emit('chatroom:prefix_updated', { prefix: session.prefix });
              }
              if (persisted?.botNickname && !data.botNickname) {
                session.botNickname = persisted.botNickname;
              }
            }
            // Keep the DB copy in sync with whatever the client just sent so the
            // next restart restores the latest values, not stale ones.
            void persistWebchatSettings(session.userId, {
              prefix: session.prefix,
              botNickname: session.botNickname,
            });
          },
        ).catch((err: unknown) => {
          logger.warn('⚠️ [chat-room] Post-sync settings restore failed', {
            error: err,
          });
        });

        socket.emit('chatroom:history', {
          messages: session.messages,
          prefix: session.prefix,
        });
        logger.debug(`[chat-room] Socket ${socket.id} joined session ${activeSessionId}`, {
          userId: session.userId,
          username: session.username,
        });
      },
    );

    // ── chatroom:message ───────────────────────────────────────────────────
    socket.on(
      'chatroom:message',
      (data: {
        id: string;
        text: string;
        sessionId: string;
        attachments?: ChatAttachment[];
      }) => {
        const sid = data.sessionId || activeSessionId;
        const session = getSession(sid);
        const { id, text, attachments } = data;
        const prefix = session.prefix;

        const userMsg: ChatMessage = {
          id,
          type: 'user',
          text,
          timestamp: Date.now(),
        };
        if (attachments && attachments.length > 0) userMsg.attachments = attachments;
        session.messages.push(userMsg);

        const event: Record<string, unknown> = {
          type: 'message',
          senderID: session.userId,
          message: text,
          threadID: webchatThreadId(session.userId),
          messageID: id,
          // Forward real attachments (image/video/audio/file with a usable url —
          // either a data: URL from an uploaded photo or an http(s) URL) to the
          // engine instead of hardcoding an empty array, so commands that read
          // event.attachments (vision/AI commands, file-aware commands) can see
          // what the user actually sent from the web chat room.
          attachments: attachments ?? [],
          mentions: {},
          timestamp: Date.now(),
          isGroup: false,
        };

        const webChatApi = new WebChatApi(socket, sid);
        const native = getNative();
        const commands = getCommands();
        const eventModules = getEventModules();

        void handleMessage(
          webChatApi,
          event,
          commands,
          eventModules,
          prefix,
          native,
        ).catch((err: unknown) => {
          logger.error('[chat-room] handleMessage error', { error: err });
          socket.emit('chatroom:error', {
            message: 'An error occurred processing your message.',
          });
        });
      },
    );

    // ── chatroom:reply ─────────────────────────────────────────────────────
    socket.on(
      'chatroom:reply',
      (data: {
        id: string;
        text: string;
        sessionId: string;
        replyToId: string;
        replyToText: string;
        replyToType: string;
        attachments?: ChatAttachment[];
      }) => {
        const sid = data.sessionId || activeSessionId;
        const session = getSession(sid);
        const { id, text, replyToId, replyToText, attachments } = data;
        const prefix = session.prefix;

        const userMsg: ChatMessage = {
          id,
          type: 'user',
          text,
          timestamp: Date.now(),
          replyTo: replyToId,
        };
        if (attachments && attachments.length > 0) userMsg.attachments = attachments;
        session.messages.push(userMsg);

        const replyEvent: Record<string, unknown> = {
          type: 'message_reply',
          senderID: session.userId,
          message: text,
          threadID: webchatThreadId(session.userId),
          messageID: id,
          attachments: attachments ?? [],
          mentions: {},
          timestamp: Date.now(),
          isGroup: false,
          args: text.trim().split(/\s+/).filter(Boolean),
          messageReply: {
            messageID: replyToId,
            senderID: 'persian',
            message: replyToText,
            threadID: webchatThreadId(session.userId),
            attachments: [],
            mentions: {},
            timestamp: Date.now(),
            args: [],
            isGroup: false,
          },
        };

        const webChatApi = new WebChatApi(socket, sid);
        const native = getNative();
        const commands = getCommands();
        const eventModules = getEventModules();

        void handleMessage(
          webChatApi,
          replyEvent,
          commands,
          eventModules,
          prefix,
          native,
        ).catch((err: unknown) => {
          logger.error('[chat-room] handleReply error', { error: err });
        });
      },
    );

    // ── chatroom:button_click ──────────────────────────────────────────────
    socket.on(
      'chatroom:button_click',
      (data: {
        buttonId: string;
        messageId: string;
        sessionId: string;
      }) => {
        const sid = data.sessionId || activeSessionId;
        const { buttonId, messageId } = data;
        const session = getSession(sid);

        // BUGFIX: senderID was previously hardcoded to the literal string
        // 'web-user' here, while the buttons themselves are scoped with the
        // REAL sender id (session.userId) at creation time — see button.generateID
        // + enforceButtonScope, which rejects any click whose event.senderID does
        // not match the id the button was scoped to. That mismatch silently
        // swallowed every scoped button click (help's ◀ Prev / Next ▶, balance's
        // 📅 Daily Status, etc.) — clicking did nothing. Using session.userId here
        // keeps the identity consistent between the message that created the
        // button and the click that triggers it.
        const buttonEvent: Record<string, unknown> = {
          type: 'button_action',
          platform: Platforms.Webchat,
          threadID: webchatThreadId(session.userId),
          senderID: session.userId,
          messageID: messageId,
          buttonId,
          timestamp: Date.now(),
        };

        const webChatApi = new WebChatApi(socket, sid);
        const native = getNative();
        const commands = getCommands();

        void handleButtonAction(
          webChatApi,
          buttonEvent,
          commands,
          native,
        ).catch((err: unknown) => {
          logger.error('[chat-room] handleButtonAction error', { error: err });
        });
      },
    );

    // ── chatroom:delete_message ────────────────────────────────────────────
    socket.on('chatroom:delete_message', (data: { id: string }) => {
      if (!activeSessionId) return;
      const session = getSession(activeSessionId);
      const idx = session.messages.findIndex((m) => m.id === data.id);
      if (idx !== -1) session.messages.splice(idx, 1);
      socket.emit('chatroom:message_deleted', { id: data.id });
    });

    // ── chatroom:clear ─────────────────────────────────────────────────────
    socket.on('chatroom:clear', () => {
      if (!activeSessionId) return;
      const session = getSession(activeSessionId);
      session.messages = [];
      socket.emit('chatroom:cleared');
    });

    // ── chatroom:set_prefix ────────────────────────────────────────────────
    socket.on('chatroom:set_prefix', (data: { prefix: string }) => {
      if (!activeSessionId) return;
      const session = getSession(activeSessionId);
      const newPrefix = (data.prefix ?? '/').trim().slice(0, 10) || '/';
      session.prefix = newPrefix;
      socket.emit('chatroom:prefix_updated', { prefix: newPrefix });
      // Persist so the prefix survives a server restart, same as Discord/Telegram's
      // BotSession.prefix — not just held in this process's in-memory Map.
      void persistWebchatSettings(session.userId, { prefix: newPrefix });
    });

    // ── chatroom:exit ──────────────────────────────────────────────────────
    // Session is intentionally preserved — user is just navigating away.
    socket.on('chatroom:exit', () => {
      logger.debug(`[chat-room] Socket ${socket.id} exited (session preserved)`);
    });

    // ── disconnect ─────────────────────────────────────────────────────────
    // Session is preserved so history survives reconnects/page refreshes.
    socket.on('disconnect', () => {
      logger.debug(`[chat-room] Socket ${socket.id} disconnected (session preserved)`);
    });
  });
}
