/**
 * Message Style Registry
 *
 * Controls how message text is interpreted and rendered by each platform adapter.
 *
 *   TEXT     — Raw plain text. Platform-specific markdown syntax is escaped so it
 *              displays literally (no unintended bold/italic/etc. rendering).
 *              On Discord: escapeMarkdown is applied.
 *              On Telegram: no parse_mode is set.
 *              On FB Messenger/Page: text is sent as-is.
 *
 *   MARKDOWN — Formatted text. Each platform uses its native formatting mechanism.
 *              On Discord: text passes through as-is (Discord renders markdown natively).
 *              On Telegram: parse_mode 'MarkdownV2' is applied. Callers are responsible
 *                           for escaping MarkdownV2 reserved characters.
 *              On FB Messenger/Page: mdToText() converts Markdown to styled Unicode
 *                           characters since neither platform supports native markdown.
 *
 *   RICH_MARKDOWN — Telegram Bot API 10.1+ Rich Messages (InputRichMessage.markdown),
 *              sent via sendRichMessage instead of sendMessage. Rich Markdown is
 *              GFM-compatible plus Telegram extensions: tables, task lists, footnotes,
 *              LaTeX, headings, collapsible <details>, maps, collages/slideshows, and
 *              inline media blocks — none of which MarkdownV2 can express.
 *              On Discord/FB (no Rich Messages concept): falls back to native markdown
 *              rendering, same as MARKDOWN — the extra syntax renders as literal text,
 *              which is an acceptable degrade since neither platform parses it anyway.
 *
 *   RICH_HTML  — Telegram Bot API 10.1+ Rich Messages (InputRichMessage.html), sent via
 *              sendRichMessage. Same capability set as RICH_MARKDOWN, authored in the
 *              Rich HTML tag dialect (<tg-map>, <tg-spoiler>, <table>, <details>, etc.)
 *              instead of Markdown syntax.
 *              On Discord/FB: falls back to native markdown rendering, same as MARKDOWN.
 *
 * When style is omitted, platform default behavior is preserved (backward compatible):
 *   Discord   → renders markdown (same as MARKDOWN)
 *   Telegram  → no parse_mode (same as TEXT)
 *   FB        → raw text (same as TEXT)
 */

export const MessageStyle = {
  TEXT: 'text',
  MARKDOWN: 'markdown',
  /** Telegram-only: InputRichMessage authored as Rich Markdown. See header comment above. */
  RICH_MARKDOWN: 'rich_markdown',
  /** Telegram-only: InputRichMessage authored as Rich HTML. See header comment above. */
  RICH_HTML: 'rich_html',
} as const;

export type MessageStyleValue =
  (typeof MessageStyle)[keyof typeof MessageStyle];
