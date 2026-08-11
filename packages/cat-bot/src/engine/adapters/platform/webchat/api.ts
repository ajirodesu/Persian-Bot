/**
 * WebChat Platform Adapter
 *
 * Platform adapter for the web chat room. Captures all bot outputs (messages,
 * edits, deletes, buttons, attachments) and streams them to the connected
 * Socket.IO client.
 *
 * Each connected socket gets its own WebChatApi instance, wired to the per-
 * session in-memory store through a session provider injected by the socket
 * handler (server/socket/chat-room.socket.ts). Extracting the class here keeps
 * the socket file a thin transport layer, consistent with how the Discord and
 * Telegram adapters live under engine/adapters/platform/<platform>/.
 */

import type { Readable } from 'stream';
import type { Socket } from 'socket.io';
import { UnifiedApi } from '@/engine/adapters/models/api.model.js';
import type {
  TypingAction,
  SendPayload,
  ReplyMessageOptions,
  EditMessageOptions,
  ButtonItem,
} from '@/engine/adapters/models/api.model.js';
import { logger } from '@/engine/modules/logger/logger.lib.js';
import { MessageStyle } from '@/engine/constants/message-style.constants.js';
import { Platforms } from '@/engine/modules/platform/platform.constants.js';

// ── Wire types ───────────────────────────────────────────────────────────────

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

/**
 * The minimal view of a chat-room session the adapter needs — the socket
 * handler's StoredSession satisfies this structurally, so it passes its own
 * `getSession` (or the sessions Map) straight in with no extra plumbing.
 */
export interface WebchatSession {
  messages: ChatMessage[];
  userId: string;
  userName: string;
  username: string;
  avatarUrl: string | null;
}

/** Resolves (creating if needed) the mutable session for a given sessionId. */
export type WebchatSessionProvider = (sessionId: string) => WebchatSession;

function generateId(): string {
  return `msg-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

// ── WebChatApi ────────────────────────────────────────────────────────────────

/**
 * Platform adapter for the web chat room.
 * Captures all bot outputs and forwards them to the connected socket client.
 */
export class WebChatApi extends UnifiedApi {
  override platform = Platforms.Webchat;
  private socket: Socket;
  private sessionId: string;
  private sessionProvider: WebchatSessionProvider;

  constructor(
    socket: Socket,
    sessionId: string,
    sessionProvider: WebchatSessionProvider,
  ) {
    super();
    this.socket = socket;
    this.sessionId = sessionId;
    this.sessionProvider = sessionProvider;
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

  /**
   * Derives the "sending X" action from the attachments about to be delivered,
   * so the web chat's notice is accurate (a video → "sending a video", a
   * document → "sending a document"). Returns null for text-only messages,
   * where the plain "typing…" notice stays correct.
   */
  private static actionFromAttachments(
    attachments: ChatAttachment[],
  ): TypingAction | null {
    if (attachments.length === 0) return null;
    if (attachments.some((a) => a.type === 'video')) return 'video';
    if (attachments.some((a) => a.type === 'audio')) return 'audio';
    if (attachments.some((a) => a.type === 'image')) return 'photo';
    return 'document';
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
          logger.warn('[webchat-api] Failed to encode stream attachment', { name, err });
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
    const session = this.sessionProvider(this.sessionId);
    session.messages.push(msg);
    this.socket.emit('chatroom:bot_message', msg);
  }

  /**
   * Pushes the bot's live "sending" status to the web chat client so it can
   * render an accurate notice ("Wataru is typing…", "Wataru is sending a
   * video") while the bot is working. The refresh loop re-emits on an
   * interval; the client clears the notice when the reply lands.
   */
  override async sendTypingIndicator(
    threadID: string,
    action: TypingAction = 'typing',
  ): Promise<void> {
    this.socket.emit('chatroom:typing', { threadID, action });
  }

  override async sendMessage(
    msg: string | SendPayload,
    _threadID: string,
  ): Promise<string | undefined> {
    const text = this.resolveText(msg);
    const attachments =
      typeof msg !== 'string' ? await this.resolveAttachments(msg) : [];
    const mediaAction = WebChatApi.actionFromAttachments(attachments);
    if (mediaAction) await this.sendTypingIndicator(_threadID, mediaAction);
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
    const mediaAction = WebChatApi.actionFromAttachments(attachments);
    if (mediaAction) await this.sendTypingIndicator(_threadID, mediaAction);
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
    const session = this.sessionProvider(this.sessionId);

    let text: string;
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
    const session = this.sessionProvider(this.sessionId);
    const idx = session.messages.findIndex((m) => m.id === messageID);
    if (idx !== -1) {
      session.messages.splice(idx, 1);
    }
    this.socket.emit('chatroom:bot_delete', { id: messageID });
  }

  override async getUserInfo(
    _userIds: string[],
  ): Promise<Record<string, { name: string }>> {
    const session = this.sessionProvider(this.sessionId);
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
   * user and no bot_users_session row is ever created.
   */
  override async getFullUserInfo(
    userID: string,
  ): Promise<import('@/engine/adapters/models/user.model.js').UnifiedUserInfo> {
    const session = this.sessionProvider(this.sessionId);
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
   * Full unified thread profile — required by ctx.thread.getThreadInfo(), the
   * Discord/Telegram-style sync pipeline before upserting bot_threads rows.
   * Each account gets exactly one stable thread (their private 1:1 chat with
   * the bot). The account is always the admin of their own conversation, which
   * seeds the thread admin cache so Role.THREAD_ADMIN commands work.
   */
  override async getFullThreadInfo(
    threadID: string,
  ): Promise<import('@/engine/adapters/models/thread.model.js').UnifiedThreadInfo> {
    const session = this.sessionProvider(this.sessionId);
    return {
      platform: this.platform,
      threadID,
      name: 'Cat-Bot Chat',
      isGroup: false,
      memberCount: 2,
      participantIDs: session.userId ? [session.userId] : [],
      adminIDs: session.userId ? [session.userId] : [],
      avatarUrl: null,
      serverID: null,
    };
  }

  override async getBotID(): Promise<string> {
    return 'cat-bot';
  }

  override async getUserName(userID: string): Promise<string> {
    const session = this.sessionProvider(this.sessionId);
    if (userID === session.userId) return session.userName;
    return userID;
  }

  override async getThreadName(_threadID: string): Promise<string> {
    return 'Cat-Bot Chat';
  }

  override async getMemberCount(_threadID: string): Promise<number> {
    return 2;
  }
}