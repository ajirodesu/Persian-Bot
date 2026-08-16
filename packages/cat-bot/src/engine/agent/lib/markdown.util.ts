/**
 * AI Agent — Markdown Detection
 *
 * Decides whether a generated response should be delivered with
 * MessageStyle.MARKDOWN (formatted) or MessageStyle.TEXT (plain). The model is
 * prompted to use Markdown, but a plain-text reply (or one with only stray
 * special characters) must NOT go through Telegram's MarkdownV2 parser — that
 * would either reject the message (unescaped reserved chars) or render literal
 * markers wrong. Detecting real Markdown structure keeps both cases safe:
 * only text that actually uses supported Markdown syntax is treated as
 * Markdown.
 */

const MARKDOWN_PATTERNS: RegExp[] = [
  /\*\*[^*\n]+\*\*/, // bold **text**
  /\*[^*\n]+\*/, // italic *text*
  /(^|\s)_[^_\s\n][^_\n]*_(?=\s|$|[.,!?;:])/, // italic _text_
  /__[^_\n]+__/, // bold __text__
  /~~[^~\n]+~~/, // strikethrough
  /```[\s\S]*?```/, // fenced code block
  /`[^`\n]+`/, // inline code
  /^#{1,6}\s/m, // ATX headings
  /^\s*[-*+]\s/m, // unordered lists
  /^\s*\d+[.)]\s/m, // ordered lists
  /\[[^\]\n]+\]\([^)\n]+\)/, // links [text](url)
  /^\s*>\s?/m, // blockquote
  /^\s*\|.*\|\s*$/m, // table rows
  /^\s*-{3,}\s*$/m, // horizontal rules
];

/** True when `text` contains supported Markdown formatting syntax. */
export function containsMarkdown(text: string): boolean {
  if (!text) return false;
  return MARKDOWN_PATTERNS.some((re) => re.test(text));
}