/**
 * Telegram MarkdownV2 Escaping & Conversion Utilities
 *
 * Bot API 9.6: these 18 characters must be escaped with '\' everywhere outside
 * pre/code blocks: _ * [ ] ( ) ~ ` > # + - = | { } . !
 * '\' itself must also be escaped as '\\'.
 *
 * Exports:
 *   sanitizeMarkdownV2 — smart converter: keeps markers, escapes content, **→*
 *
 * sanitizeMarkdownV2 pipeline:
 *   1. preprocessMarkdown  — converts CommonMark/LLM constructs to Telegram equivalents
 *   2. convertCommonMarkBold — **bold** → *bold*
 *   3. State machine — char-by-char span recognition and escaping
 *
 * Idempotent: running on already-sanitized text returns the same string.
 */

/** All 18 reserved characters (Bot API MarkdownV2-style). */
const RESERVED = new Set<string>([
  '_', '*', '[', ']', '(', ')', '~', '`',
  '>', '#', '+', '-', '=', '|', '{', '}', '.', '!',
]);

// ── Internal helpers ──────────────────────────────────────────────────────────

/** Converts CommonMark **double-asterisk bold** → Telegram MarkdownV2 *single-asterisk bold*. */
function convertCommonMarkBold(text: string): string {
  return text.replace(/\*\*([^*\n]+?)\*\*/g, '*$1*');
}

/**
 * Preprocesses CommonMark/LLM markdown into Telegram-compatible equivalents:
 *   <br> tags → newline
 *   Table separator rows → dropped
 *   Table data rows → bullet list items
 *   Setext headers (=== / ---) → *bold*
 *   ATX headers (#, ##, …) → *bold*
 *   Horizontal rules (---, ***, ___) → em-dash separator
 *   Unordered list markers (-, *, +) → Unicode bullet •
 * Blockquotes (>) are intentionally left for the state machine to handle.
 */
function preprocessMarkdown(text: string): string {
  const normalized = text.replace(/<br\s*\/?>/gi, '\n');
  const lines = normalized.split('\n');
  const out: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;

    // Table separator row — drop silently
    if (/^\s*\|[\s|:-]+\|\s*$/.test(line)) continue;

    // Table data row — convert to bullet list
    if (/^\s*\|(.+\|)+\s*$/.test(line)) {
      const cells = line.split('|').map((c) => c.trim()).filter((c) => c.length > 0);
      if (cells.length > 0) out.push('\u2022 ' + cells.join(' \u2014 '));
      continue;
    }

    // Setext h1 (=== underline)
    if (i + 1 < lines.length && /^[=]{2,}\s*$/.test(lines[i + 1]!) && line.trim().length > 0) {
      out.push(`*${line.trim()}*`);
      i++;
      continue;
    }

    // Setext h2 (--- underline, not itself a rule)
    if (
      i + 1 < lines.length &&
      /^[-]{2,}\s*$/.test(lines[i + 1]!) &&
      line.trim().length > 0 &&
      !/^[-*_]{3,}\s*$/.test(line)
    ) {
      out.push(`*${line.trim()}*`);
      i++;
      continue;
    }

    // ATX header
    const headerMatch = /^(#{1,6})\s+(.+)$/.exec(line);
    if (headerMatch) { out.push(`*${headerMatch[2]!.trim()}*`); continue; }

    // Horizontal rule
    if (/^(\s*[-*_]){3,}\s*$/.test(line)) { out.push('\u2014\u2014\u2014\u2014\u2014'); continue; }

    // Unordered list
    const ulMatch = /^(\s*)[-*+]\s+(.*)$/.exec(line);
    if (ulMatch) { out.push(`${ulMatch[1]!}\u2022 ${ulMatch[2]!}`); continue; }

    out.push(line);
  }

  return out.join('\n');
}

/**
 * Scans forward from `start` for the first unescaped occurrence of `marker`.
 * Returns -1 if a newline is crossed (when crossNewline=false) or EOS is reached.
 */
function findClosingMarker(
  text: string,
  start: number,
  marker: string,
  crossNewline = false,
): number {
  let i = start;
  while (i < text.length) {
    const ch = text[i]!;
    if (ch === '\\' && i + 1 < text.length) { i += 2; continue; }
    if (!crossNewline && ch === '\n') return -1;
    if (ch === marker) return i;
    i++;
  }
  return -1;
}

/**
 * Escapes all reserved chars inside a formatting span's content, except the span's
 * own marker char (escaping it would break the structural delimiter). Preserves
 * existing \X sequences for idempotency.
 */
function escapeInner(content: string, exceptChar: string): string {
  let result = '';
  let i = 0;
  while (i < content.length) {
    const ch = content[i]!;
    // Preserve existing \X escape sequences
    if (
      ch === '\\' &&
      i + 1 < content.length &&
      content[i + 1]!.charCodeAt(0) >= 1 &&
      content[i + 1]!.charCodeAt(0) <= 126
    ) {
      result += '\\' + content[i + 1]!;
      i += 2;
      continue;
    }
    if (ch === exceptChar) { result += ch; i++; continue; }
    if (ch === '\\') { result += '\\\\'; i++; continue; }
    if (RESERVED.has(ch)) result += '\\' + ch;
    else result += ch;
    i++;
  }
  return result;
}

// ── sanitizeMarkdownV2 ────────────────────────────────────────────────────────

/**
 * Converts command-module Markdown into valid Telegram MarkdownV2.
 *
 * Formatting markers (*, _, __, ~, ||, `, ```) are kept verbatim.
 * > at line-start is kept as a Telegram blockquote marker.
 * Span content is passed through escapeInner().
 * Plain text chars are escaped if reserved.
 * Existing \X sequences are preserved everywhere (idempotent).
 *
 * Span priority order: ``` before `, __ before _, || before |.
 */
export function sanitizeMarkdownV2(text: string): string {
  const src = convertCommonMarkBold(preprocessMarkdown(text));
  let result = '';
  let i = 0;
  let atLineStart = true;

  while (i < src.length) {
    const ch = src[i]!;

    if (ch === '\n') { result += '\n'; atLineStart = true; i++; continue; }

    // Preserve existing \X sequences
    if (
      ch === '\\' &&
      i + 1 < src.length &&
      src[i + 1]!.charCodeAt(0) >= 1 &&
      src[i + 1]!.charCodeAt(0) <= 126
    ) {
      result += '\\' + src[i + 1]!;
      atLineStart = false;
      i += 2;
      continue;
    }

    // Blockquote: > at line-start — keep verbatim (Telegram MarkdownV2 blockquote)
    if (ch === '>' && atLineStart) {
      result += '>';
      if (src[i + 1] === ' ') { result += ' '; i += 2; } else { i++; }
      continue;
    }

    // Triple-backtick code block — must be checked before single backtick
    if (src.startsWith('```', i)) {
      const closeIdx = src.indexOf('```', i + 3);
      if (closeIdx !== -1) {
        const inner = src.slice(i + 3, closeIdx);
        result += '```' + inner.replace(/[`\\]/g, (m) => '\\' + m) + '```';
        i = closeIdx + 3;
        atLineStart = false;
        continue;
      }
      result += '\\`'; atLineStart = false; i++; continue;
    }

    // Single-backtick inline code
    if (ch === '`') {
      const closeIdx = findClosingMarker(src, i + 1, '`', false);
      if (closeIdx !== -1 && closeIdx > i + 1) {
        const inner = src.slice(i + 1, closeIdx);
        result += '`' + inner.replace(/[`\\]/g, (m) => '\\' + m) + '`';
        i = closeIdx + 1; atLineStart = false; continue;
      }
      result += '\\`'; atLineStart = false; i++; continue;
    }

    // Bold: *...* (convertCommonMarkBold has already normalised **x** → *x*)
    if (ch === '*') {
      const closeIdx = findClosingMarker(src, i + 1, '*', false);
      if (closeIdx !== -1 && closeIdx > i + 1) {
        result += '*' + escapeInner(src.slice(i + 1, closeIdx), '*') + '*';
        i = closeIdx + 1; atLineStart = false; continue;
      }
      result += '\\*'; atLineStart = false; i++; continue;
    }

    // Underline: __...__ (must be checked before single _)
    if (ch === '_' && src[i + 1] === '_') {
      const closeIdx = src.indexOf('__', i + 2);
      if (closeIdx !== -1 && closeIdx > i + 2) {
        result += '__' + escapeInner(src.slice(i + 2, closeIdx), '_') + '__';
        i = closeIdx + 2; atLineStart = false; continue;
      }
    }

    // Italic: _..._
    if (ch === '_') {
      const closeIdx = findClosingMarker(src, i + 1, '_', false);
      if (closeIdx !== -1 && closeIdx > i + 1 && src[closeIdx + 1] !== '_') {
        result += '_' + escapeInner(src.slice(i + 1, closeIdx), '_') + '_';
        i = closeIdx + 1; atLineStart = false; continue;
      }
      result += '\\_'; atLineStart = false; i++; continue;
    }

    // Strikethrough: ~...~
    if (ch === '~') {
      const closeIdx = findClosingMarker(src, i + 1, '~', false);
      if (closeIdx !== -1 && closeIdx > i + 1) {
        result += '~' + escapeInner(src.slice(i + 1, closeIdx), '~') + '~';
        i = closeIdx + 1; atLineStart = false; continue;
      }
      result += '\\~'; atLineStart = false; i++; continue;
    }

    // Spoiler: ||...|| (must be checked before bare |)
    if (ch === '|' && src[i + 1] === '|') {
      const closeIdx = src.indexOf('||', i + 2);
      if (closeIdx !== -1 && closeIdx > i + 2) {
        result += '||' + escapeInner(src.slice(i + 2, closeIdx), '|') + '||';
        i = closeIdx + 2; atLineStart = false; continue;
      }
    }

    // Inline link: [text](url) — URL portion kept verbatim (raw URI, no escaping)
    if (ch === '[') {
      const textClose = src.indexOf(']', i + 1);
      if (textClose !== -1 && src[textClose + 1] === '(') {
        const urlClose = src.indexOf(')', textClose + 2);
        if (urlClose !== -1) {
          result += '[' + escapeInner(src.slice(i + 1, textClose), ']') + '](' + src.slice(textClose + 2, urlClose) + ')';
          i = urlClose + 1; atLineStart = false; continue;
        }
      }
    }

    // Plain character — escape bare '\' and any reserved char
    if (ch === '\\') { result += '\\\\'; atLineStart = false; i++; continue; }
    if (RESERVED.has(ch)) result += '\\' + ch;
    else result += ch;
    atLineStart = false;
    i++;
  }

  return result;
}
