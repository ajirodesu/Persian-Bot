/**
 * Author: AjiroDesu
 *
 * Shared chat-room types + defaults, extracted so below-fold UI
 * (lightbox, settings modals) can live in lazily-loaded modules without
 * circular imports back into the page bundle.
 */

export interface BotButton {
  id: string
  label: string
  style?: string
}

export interface ChatAttachment {
  type: 'image' | 'video' | 'audio' | 'file'
  url?: string
  name?: string
  localUrl?: string
  file?: File
  /** Explicit MIME type sent by the server — used by <audio> to pick the right decoder. */
  mime?: string
}

export const DEFAULT_PREFIX = '/'
export const DEFAULT_NICKNAME = 'Cat-Bot'
