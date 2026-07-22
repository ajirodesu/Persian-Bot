/**
 * Bot Session Config DTOs — Commands & Events Toggle API
 *
 * Shared type contracts between the server controller and client.
 * Kept separate from bot.dto.ts because these types model operational
 * runtime toggles rather than identity/credential configuration.
 */

export interface BotCommandItemDto {
  commandName: string;
  isEnable: boolean;
  version?: string;
  description?: string;
  usage?: string;
  role?: number;
  aliases?: string[];
  cooldown?: number;
  author?: string;
  /**
   * Whether this command is exempt from session-wide "Bot Admin Only" mode —
   * mirrors `/ignoreonlyad` membership. Powers the "Ignore Admin-Only" switch
   * shown next to each command's enable/disable switch on the Commands page.
   */
  ignoresAdminOnly: boolean;
}

export interface GetBotCommandsResponseDto {
  commands: BotCommandItemDto[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export interface BotEventItemDto {
  eventName: string;
  isEnable: boolean;
  version?: string;
  description?: string;
  author?: string;
}

export interface GetBotEventsResponseDto {
  events: BotEventItemDto[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

/** PUT body for both command and event toggles */
export interface ToggleEnabledRequestDto {
  isEnable: boolean;
}

/** GET/PUT response+body for the session-wide "Bot Admin Only" switch. */
export interface AdminOnlyStateDto {
  enabled: boolean;
}

/** PUT body for a command's "Ignore Admin-Only" switch. */
export interface ToggleIgnoreAdminOnlyRequestDto {
  ignored: boolean;
}
