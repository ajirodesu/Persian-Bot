/**
 * UnifiedApi — abstract base class for all platform wrappers.
 * Command modules call only these methods; platform-specific details stay in each wrapper.
 */

import type { Readable } from 'stream';
import type {
  SendPayload,
  UserInfo,
  ReplyMessageOptions,
  EditMessageOptions,
} from './interfaces/index.js';

export type { PlatformId } from './thread.model.js';
export type {
  MentionEntry,
  NamedStreamAttachment,
  NamedUrlAttachment,
  ButtonItem,
  UserInfo,
  ReplyMessageOptions,
  EditMessageOptions,
  SendPayload,
} from './interfaces/index.js';

import type { UnifiedThreadInfo } from './thread.model.js';
import type { UnifiedUserInfo } from './user.model.js';
import { logger } from '@/engine/modules/logger/logger.lib.js';

export class UnifiedApi {
  platform: string = 'unknown';

  async sendMessage(
    _msg: string | SendPayload,
    _threadID: string,
  ): Promise<string | undefined> {
    logger.debug('[UnifiedApi] sendMessage called', { platform: this.platform, threadID: _threadID });
    throw new Error(`sendMessage not implemented on platform: ${this.platform}`);
  }

  async unsendMessage(_messageID: string): Promise<void> {
    logger.debug('[UnifiedApi] unsendMessage called', { platform: this.platform, messageID: _messageID });
    throw new Error(`unsendMessage is not supported on platform: ${this.platform}`);
  }

  /** Override on platforms with an edit API (Telegram, Discord). */
  async editMessage(
    _messageID: string,
    _options: string | EditMessageOptions,
  ): Promise<void> {
    logger.debug('[UnifiedApi] editMessage called', { platform: this.platform, messageID: _messageID });
    throw new Error(`editMessage is not supported on platform: ${this.platform}`);
  }

  async getUserInfo(_userIds: string[]): Promise<Record<string, UserInfo>> {
    logger.debug('[UnifiedApi] getUserInfo called', { platform: this.platform, count: _userIds.length });
    throw new Error(`getUserInfo not implemented on platform: ${this.platform}`);
  }

  async setGroupName(_threadID: string, _name: string): Promise<void> {
    logger.debug('[UnifiedApi] setGroupName called', { platform: this.platform, threadID: _threadID });
    throw new Error(`setGroupName is not supported on platform: ${this.platform}`);
  }

  /** Accepts Buffer, Readable stream, or URL string. */
  async setGroupImage(
    _threadID: string,
    _imageSource: Buffer | Readable | string,
  ): Promise<void> {
    logger.debug('[UnifiedApi] setGroupImage called', { platform: this.platform, threadID: _threadID });
    throw new Error(`setGroupImage is not supported on platform: ${this.platform}`);
  }

  async reactToMessage(
    _threadID: string,
    _messageID: string,
    _emoji: string,
  ): Promise<void> {
    logger.debug('[UnifiedApi] reactToMessage called', { platform: this.platform, threadID: _threadID, messageID: _messageID, emoji: _emoji });
    throw new Error(`reactToMessage is not supported on platform: ${this.platform}`);
  }

  /** Defaults to silent no-op — not all platforms expose a native typing signal. */
  async sendTypingIndicator(_threadID: string): Promise<void> {
    logger.debug('[UnifiedApi] sendTypingIndicator called', { platform: this.platform, threadID: _threadID });
  }

  /**
   * Streams a "Thinking…" rich-message draft. Telegram-only (Bot API 10.1+).
   * Defaults to silent no-op so callers need not branch on platform.
   * `draftId` must stay the same across successive calls for the same generation.
   */
  async sendThinkingDraft(
    _threadID: string,
    _text: string,
    _draftId: number,
  ): Promise<void> {
    logger.debug('[UnifiedApi] sendThinkingDraft called', { platform: this.platform, threadID: _threadID });
  }

  async removeGroupImage(_threadID: string): Promise<void> {
    logger.debug('[UnifiedApi] removeGroupImage called', { platform: this.platform, threadID: _threadID });
    throw new Error(`removeGroupImage is not supported on platform: ${this.platform}`);
  }

  async addUserToGroup(_threadID: string, _userID: string): Promise<void> {
    logger.debug('[UnifiedApi] addUserToGroup called', { platform: this.platform, threadID: _threadID, userID: _userID });
    throw new Error(`addUserToGroup is not supported on platform: ${this.platform}`);
  }

  async removeUserFromGroup(_threadID: string, _userID: string): Promise<void> {
    logger.debug('[UnifiedApi] removeUserFromGroup called', { platform: this.platform, threadID: _threadID, userID: _userID });
    throw new Error(`removeUserFromGroup is not supported on platform: ${this.platform}`);
  }

  /**
   * Restrict a member from sending messages. `durationMs` is optional — when omitted,
   * restriction is indefinite. Platforms that support native expiry apply it directly.
   */
  async restrictUser(
    _threadID: string,
    _userID: string,
    _durationMs?: number,
  ): Promise<void> {
    logger.debug('[UnifiedApi] restrictUser called', { platform: this.platform, threadID: _threadID, userID: _userID, durationMs: _durationMs });
    throw new Error(`restrictUser is not supported on platform: ${this.platform}`);
  }

  async unrestrictUser(_threadID: string, _userID: string): Promise<void> {
    logger.debug('[UnifiedApi] unrestrictUser called', { platform: this.platform, threadID: _threadID, userID: _userID });
    throw new Error(`unrestrictUser is not supported on platform: ${this.platform}`);
  }

  async setGroupReaction(_threadID: string, _emoji: string): Promise<void> {
    logger.debug('[UnifiedApi] setGroupReaction called', { platform: this.platform, threadID: _threadID, emoji: _emoji });
    throw new Error(`setGroupReaction is not supported on platform: ${this.platform}`);
  }

  async setNickname(
    _threadID: string,
    _userID: string,
    _nickname: string,
  ): Promise<void> {
    logger.debug('[UnifiedApi] setNickname called', { platform: this.platform, threadID: _threadID, userID: _userID });
    throw new Error(`setNickname not implemented on platform: ${this.platform}`);
  }

  async replyMessage(
    _threadID: string,
    _options: ReplyMessageOptions = {},
  ): Promise<unknown> {
    logger.debug('[UnifiedApi] replyMessage called', { platform: this.platform, threadID: _threadID });
    throw new Error(`replyMessage is not supported on platform: ${this.platform}`);
  }

  async getBotID(): Promise<string> {
    logger.debug('[UnifiedApi] getBotID called', { platform: this.platform });
    throw new Error(`getBotID not implemented on platform: ${this.platform}`);
  }

  async getFullThreadInfo(_threadID: string): Promise<UnifiedThreadInfo> {
    logger.debug('[UnifiedApi] getFullThreadInfo called', { platform: this.platform, threadID: _threadID });
    throw new Error(`getFullThreadInfo not implemented on platform: ${this.platform}`);
  }

  async getFullUserInfo(_userID: string): Promise<UnifiedUserInfo> {
    logger.debug('[UnifiedApi] getFullUserInfo called', { platform: this.platform, userID: _userID });
    throw new Error(`getFullUserInfo not implemented on platform: ${this.platform}`);
  }

  /** Returns display name from cache/event data where possible — avoids a REST call. */
  async getUserName(_userID: string): Promise<string> {
    logger.debug('[UnifiedApi] getUserName called', { platform: this.platform, userID: _userID });
    throw new Error(`getUserName not implemented on platform: ${this.platform}`);
  }

  /** Returns thread name from cache/event data where possible — avoids a REST call. */
  async getThreadName(_threadID: string): Promise<string> {
    logger.debug('[UnifiedApi] getThreadName called', { platform: this.platform, threadID: _threadID });
    throw new Error(`getThreadName not implemented on platform: ${this.platform}`);
  }

  /** Returns avatar URL or null when unavailable. */
  async getAvatarUrl(_userID: string): Promise<string | null> {
    logger.debug('[UnifiedApi] getAvatarUrl called', { platform: this.platform, userID: _userID });
    throw new Error(`getAvatarUrl not implemented on platform: ${this.platform}`);
  }

  async getMemberCount(_threadID: string): Promise<number> {
    logger.debug('[UnifiedApi] getMemberCount called', { platform: this.platform, threadID: _threadID });
    throw new Error(`getMemberCount is not supported on platform: ${this.platform}`);
  }

  async leaveThread(_threadID: string): Promise<void> {
    logger.debug('[UnifiedApi] leaveThread called', { platform: this.platform, threadID: _threadID });
    throw new Error(`leaveThread is not supported on platform: ${this.platform}`);
  }
}
