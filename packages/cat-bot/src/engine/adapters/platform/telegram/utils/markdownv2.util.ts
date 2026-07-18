/**
 * Telegram — MarkdownV2 Escaping & Validation Utilities
 *
 * Official Bot API 9.6 spec (core.telegram.org/bots/api#markdownv2-style, April 2026):
 *
 *   In ALL places — including inside bold, italic, and other formatting spans —
 *   these 18 characters MUST be preceded by '\':
 *     _ * [ ] ( ) ~ ` > # + - = | { } . !
 *   '\' itself must also be escaped as '\\'.
 *
 * ── The critical rule that the previous implementation missed ─────────────────
 * "In all other places" in the spec does NOT mean "outside formatting spans".
 * It means "anywhere that is not a pre/code block". So ( ) . ! inside *bold* STILL
 * need escaping — only the formatting MARKER chars themselves (the `*` delimiters)
 * are kept as-is. Everything else in the span content is treated like plain text.
 *
 * ── Architecture of sanitizeMarkdownV2 ───────────────────────────────────────
 * State machine — char-by-char — four cases:
 *   1. Existing \X escape → copy verbatim, advance 2
 *   2. Formatting span opener (`, ```, *, __, _, ~, ||, [) → keep marker,
 *      call escapeInner() on content, keep closing marker
 *   3. No matching closing marker → treat opener as bare reserved char → escape it
 *   4. Plain char → escape if reserved, else copy
 *
 * escapeInner(content, exceptChar):
 *   Escapes all reserved chars EXCEPT the span's own marker character. The marker
 *   char appears as both opener and closer; escaping it inside the content would
 *   prematurely terminate the span. Existing \X sequences inside content are
 *   preserved verbatim (idempotency guarantee).
 *
 * Supported formatting patterns (Telegram MarkdownV2, Bot API 9.6):
 *   *bold*        _italic_    __underline__    ~strikethrough~
 *   ||spoiler||   `inline`    ```block```      [text](url)   >blockquote
 *
 * CommonMark **bold** (double asterisk) is auto-converted to *bold* because
 * command modules in this codebase use the more familiar CommonMark syntax.
 *
 * LLM/CommonMark preprocessing:
 *   # Header / ## Header → *Header*  (Telegram has no native header element)
 *   Setext headers (underlined with === or ---) → *Header*
 *   Horizontal rules (---, ***, ___) → em-dash separator line
 *   Unordered list markers (-, *, +) → Unicode bullet • (avoids reserved-char escaping)
 *   > blockquote at line-start → kept verbatim (Telegram MarkdownV2 blockquote)
 *
 * Three exports — same surface as before, no import changes needed in callers:
 *   escapeMarkdownV2   — full escape for literal plain text (no formatting)
 *   sanitizeMarkdownV2 — smart converter: markers kept, content escaped, **→*
 *   validateMarkdownV2 — true iff sanitizeMarkdownV2 would not change the text
 */

/** All 18 reserved characters outside formatting entities (Bot API MarkdownV2-style). */
const RESERVED = new Set<string>([
  '_',
  '*',
  '[',
  ']',
  '(',
  ')',
  '~',
  '`',
  '>',
  '#',
  '+',
  '-',
  '=',
  '|',
  '{',
  '}',
  '.',
  '!',
]);

// ── escapeMarkdownV2 ──────────────────────────────────────────────────────────

/**
 * Full escape — every reserved character AND '\' is escaped so the text renders
 * as literal plain text with zero formatting applied.
 *
 * Use for raw user-supplied strings (usernames, file paths, error messages)
 * that must appear verbatim. Never use when intentional formatting is present —
 * it would escape the formatting markers too.
 *
 * Escapes '\' first to avoid double-escaping chars added in the second pass.
 */
export function escapeMarkdownV2(text: string): string {
  let result = '';
  for (const ch of text) {
    if (ch === '\\' || RESERVED.has(ch)) {
      result += '\\' + ch;
    } else {
      result += ch;
    }
  }
  return result;
}

// ── Internal helpers ──────────────────────────────────────────────────────────

/**
 * Converts CommonMark **double-asterisk bold** → Telegram MarkdownV2 *single-asterisk bold*.
 *
 * Command modules use **bold** (CommonMark) because it is widely recognised in editors
 * and documentation. Telegram MarkdownV2 uses a single asterisk. Without this conversion,
 * the double asterisks would be treated as two bare reserved '*' chars and escaped to
 * \*\*bold\*\*, producing literal asterisks with no formatting.
 *
 * Non-greedy [^*\n]+? prevents consuming adjacent **spans** on one line.
 */
function convertCommonMarkBold(text: string): string {
  return text.replace(/\*\*([^*\n]+?)\*\*/g, '*$1*');
}

/**
 * Preprocesses CommonMark / LLM-output markdown into forms that
 * sanitizeMarkdownV2 can preserve as Telegram MarkdownV2 formatting.
 *
 * Conversions applied (line-by-line, in order):
 *   1. <br> / <br/> / <br /> HTML tags → newline
 *   2. Markdown table separator rows (|---|---| etc.) → dropped entirely
 *   3. Markdown table data rows (| cell | cell |) → bullet list items
 *   4. Setext headers (=== / ---) → bold text
 *   5. ATX headers (# / ## / ###) → bold text  (Telegram has no native header)
 *   6. Horizontal rules (---, ***, ___) → em-dash separator
 *   7. Unordered list markers (-, *, +) → Unicode bullet  (avoids escaping -)
 *
 * Blockquotes (>) are intentionally NOT transformed here; the state machine
 * detects them at line-start and keeps the > as a Telegram MarkdownV2 blockquote
 * marker instead of escaping it.
 */
function preprocessMarkdown(text: string): string {
  // Replace <br>, <br/>, <br /> with newlines before splitting
  const normalized = text.replace(/<br\s*\/?>/gi, '\n');

  const lines = normalized.split('\n');
  const out: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;

    // Table separator row: |---|---| or |:---|:---:| — drop silently
    if (/^\s*\|[\s|:\-]+\|\s*$/.test(line)) {
      continue;
    }

    // Table data row: | cell | cell | — convert to bullet list
    if (/^\s*\|(.+\|)+\s*$/.test(line)) {
      const cells = line
        .split('|')
        .map((c) => c.trim())
        .filter((c) => c.length > 0);
      if (cells.length > 0) {
        out.push('\u2022 ' + cells.join(' \u2014 '));
      }
      continue;
    }

    // Setext-style header: next line is all = signs
    if (
      i + 1 < lines.length &&
      /^[=]{2,}\s*$/.test(lines[i + 1]!) &&
      line.trim().length > 0
    ) {
      out.push(`*${line.trim()}*`);
      i++; // skip the underline row
      continue;
    }

    // Setext-style header: next line is all - signs (but current line is not itself a rule)
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

    // ATX header: # H1 / ## H2 / ### H3 etc.
    const headerMatch = /^(#{1,6})\s+(.+)$/.exec(line);
    if (headerMatch) {
      out.push(`*${headerMatch[2]!.trim()}*`);
      continue;
    }

    // Horizontal rule (---, ***, ___) — replace with a visible separator
    if (/^(\s*[-*_]){3,}\s*$/.test(line)) {
      out.push('\u2014\u2014\u2014\u2014\u2014');
      continue;
    }

    // Unordered list: leading -, *, or + followed by space (Unicode bullet avoids reserved - char)
    const ulMatch = /^(\s*)[-*+]\s+(.*)$/.exec(line);
    if (ulMatch) {
      out.push(`${ulMatch[1]!}\u2022 ${ulMatch[2]!}`);
      continue;
    }

    out.push(line);
  }

  return out.join('\n');
}

/**
 * Scans forward from `start` and returns the index of the first unescaped
 * occurrence of `marker`. Returns -1 when:
 *   - a newline is crossed and `crossNewline` is false (inline spans can't span lines)
 *   - end of string is reached without finding the marker
 *
 * Skips existing \X escape sequences (they do not close the span).
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
    // Existing \X escape — the escaped char cannot be a span closer
    if (ch === '\\' && i + 1 < text.length) {
      i += 2;
      continue;
    }
    // Inline formatting cannot cross newlines
    if (!crossNewline && ch === '\n') return -1;
    if (ch === marker) return i;
    i++;
  }
  return -1;
}

/**
 * Escapes all MarkdownV2 reserved characters inside a formatting span's CONTENT —
 * i.e., everything between the opening and closing marker characters.
 *
 * Why `exceptChar` exists: the span's own marker character (e.g. `*` for bold) must
 * NOT be escaped inside the content. Escaping it would not prematurely close the span
 * in the Bot API parser, but it would break the visual render because the parser would
 * see `\*` (escaped literal asterisk) instead of the structural marker it expects at
 * the boundary. Command modules never embed a literal `*` inside `*bold*` text, so this
 * edge case is safely ignored — the marker char is simply kept as-is.
 *
 * Existing \X escape sequences are preserved verbatim — running this function twice on
 * already-sanitized content returns the same string (idempotency guarantee).
 *
 * Example:
 *   escapeInner('Load avg (1/5/15 min):', '*')
 *   => 'Load avg \(1/5/15 min\):'    ( ( and ) escaped; : not reserved; * untouched )
 */
function escapeInner(content: string, exceptChar: string): string {
  let result = '';
  let i = 0;
  while (i < content.length) {
    const ch = content[i]!;

    // Preserve existing \X escape sequences — idempotency: never re-escape \( or \. etc.
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

    // Keep the span's own marker char — it is the structural delimiter, not content
    if (ch === exceptChar) {
      result += ch;
      i++;
      continue;
    }

    // Escape bare '\' (not forming a valid \X sequence above)
    if (ch === '\\') {
      result += '\\\\';
      i++;
      continue;
    }

    // Escape any other reserved character
    if (RESERVED.has(ch)) {
      result += '\\' + ch;
    } else {
      result += ch;
    }
    i++;
  }
  return result;
}

// ── sanitizeMarkdownV2 ────────────────────────────────────────────────────────

/**
 * Converts command-module Markdown output into valid Telegram MarkdownV2.
 *
 * The state machine processes the text character-by-character, alternating between
 * formatting-span recognition and plain-text escaping. The central contract:
 *
 *   FORMATTING MARKERS (*, _, __, ~, ||, `, ```) → kept verbatim (they ARE the syntax)
 *   BLOCKQUOTE MARKER (> at line-start) → kept verbatim (Telegram MarkdownV2 blockquote)
 *   SPAN CONTENT (everything between markers) → escapeInner() (Bot API requires all
 *     18 reserved chars escaped here too, including ( ) . !)
 *   PLAIN TEXT (outside any span) → all 18 reserved chars + '\' escaped
 *   EXISTING \X SEQUENCES → copied verbatim in all contexts (idempotency)
 *
 * Step 1: preprocessMarkdown — converts LLM/CommonMark constructs (headers, list
 *         bullets, horizontal rules) to Telegram-compatible equivalents.
 * Step 2: convertCommonMarkBold — **bold** → *bold* so the single-asterisk form is
 *         recognised as a formatting span in step 3.
 * Step 3: state machine — processes spans in priority order (``` before `, __ before _,
 *         || before bare |) to avoid partial matches. Tracks atLineStart to detect
 *         blockquote markers.
 *
 * Idempotent: running on already-sanitized MarkdownV2 text returns the same string.
 */
export function sanitizeMarkdownV2(text: string): string {
  // Step 1: Preprocess LLM/CommonMark markdown, then normalise **bold** → *bold*
  const src = convertCommonMarkBold(preprocessMarkdown(text));

  let result = '';
  let i = 0;
  // Track whether we are at the very start of a line so > can be kept as a
  // Telegram MarkdownV2 blockquote marker rather than escaped as \>.
  let atLineStart = true;

  while (i < src.length) {
    const ch = src[i]!;

    // ── Newline — reset line-start tracker ───────────────────────────────────
    if (ch === '\n') {
      result += '\n';
      atLineStart = true;
      i++;
      continue;
    }

    // ── Preserve existing \X escape sequences (idempotency) ──────────────────
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

    // ── Blockquote: > at line-start ───────────────────────────────────────────
    // Telegram MarkdownV2 treats > at the start of a line as a blockquote marker.
    // Keep it verbatim instead of escaping. Consume an optional trailing space too
    // (standard CommonMark blockquote style: "> text").
    // atLineStart is intentionally left true so a second > on the same prefix
    // (nested blockquotes like ">> text") is also recognised.
    if (ch === '>' && atLineStart) {
      result += '>';
      if (src[i + 1] === ' ') {
        result += ' ';
        i += 2;
      } else {
        i++;
      }
      continue;
    }

    // ── Triple-backtick code block: ```...``` ─────────────────────────────────
    // Must be checked BEFORE single backtick to avoid partial match.
    if (src.startsWith('```', i)) {
      const closeIdx = src.indexOf('```', i + 3);
      if (closeIdx !== -1) {
        // Inside code blocks: only ` and \ need escaping (Bot API pre-block rules)
        const inner = src.slice(i + 3, closeIdx);
        result += '```' + inner.replace(/[`\\]/g, (m) => '\\' + m) + '```';
        i = closeIdx + 3;
        atLineStart = false;
        continue;
      }
      // No closing ```: treat first ` as bare reserved char
      result += '\\`';
      atLineStart = false;
      i++;
      continue;
    }

    // ── Single-backtick inline code: `...` ───────────────────────────────────
    if (ch === '`') {
      const closeIdx = findClosingMarker(src, i + 1, '`', false);
      if (closeIdx !== -1 && closeIdx > i + 1) {
        // Inside inline code: only ` and \ need escaping (Bot API code-entity rules)
        const inner = src.slice(i + 1, closeIdx);
        result += '`' + inner.replace(/[`\\]/g, (m) => '\\' + m) + '`';
        i = closeIdx + 1;
        atLineStart = false;
        continue;
      }
      // No closing ` on this line: bare backtick → escape
      result += '\\`';
      atLineStart = false;
      i++;
      continue;
    }

    // ── Bold: *...* ───────────────────────────────────────────────────────────
    // convertCommonMarkBold has already converted **x** → *x* above.
    // Non-empty span only: closeIdx must be > i+1 (at least one char of content).
    if (ch === '*') {
      const closeIdx = findClosingMarker(src, i + 1, '*', false);
      if (closeIdx !== -1 && closeIdx > i + 1) {
        const inner = src.slice(i + 1, closeIdx);
        result += '*' + escapeInner(inner, '*') + '*';
        i = closeIdx + 1;
        atLineStart = false;
        continue;
      }
      // No matching closing * on this line → bare asterisk → escape
      result += '\\*';
      atLineStart = false;
      i++;
      continue;
    }

    // ── Underline: __...__ (MUST be checked before single underscore) ─────────
    if (ch === '_' && src[i + 1] === '_') {
      const closeIdx = src.indexOf('__', i + 2);
      if (closeIdx !== -1 && closeIdx > i + 2) {
        const inner = src.slice(i + 2, closeIdx);
        result += '__' + escapeInner(inner, '_') + '__';
        i = closeIdx + 2;
        atLineStart = false;
        continue;
      }
    }

    // ── Italic: _..._ ────────────────────────────────────────────────────────
    if (ch === '_') {
      const closeIdx = findClosingMarker(src, i + 1, '_', false);
      // Reject if closing position would form __ (ambiguous with underline end)
      if (closeIdx !== -1 && closeIdx > i + 1 && src[closeIdx + 1] !== '_') {
        const inner = src.slice(i + 1, closeIdx);
        result += '_' + escapeInner(inner, '_') + '_';
        i = closeIdx + 1;
        atLineStart = false;
        continue;
      }
      // Bare underscore → escape
      result += '\\_';
      atLineStart = false;
      i++;
      continue;
    }

    // ── Strikethrough: ~...~ ─────────────────────────────────────────────────
    if (ch === '~') {
      const closeIdx = findClosingMarker(src, i + 1, '~', false);
      if (closeIdx !== -1 && closeIdx > i + 1) {
        const inner = src.slice(i + 1, closeIdx);
        result += '~' + escapeInner(inner, '~') + '~';
        i = closeIdx + 1;
        atLineStart = false;
        continue;
      }
      result += '\\~';
      atLineStart = false;
      i++;
      continue;
    }

    // ── Spoiler: ||...|| (MUST be checked before bare |) ─────────────────────
    if (ch === '|' && src[i + 1] === '|') {
      const closeIdx = src.indexOf('||', i + 2);
      if (closeIdx !== -1 && closeIdx > i + 2) {
        const inner = src.slice(i + 2, closeIdx);
        result += '||' + escapeInner(inner, '|') + '||';
        i = closeIdx + 2;
        atLineStart = false;
        continue;
      }
    }

    // ── Inline link: [text](url) ─────────────────────────────────────────────
    // URL portion is kept verbatim — Telegram parses it as a raw URI without
    // MarkdownV2 escaping rules applied (the ( ) delimiters are structural here).
    if (ch === '[') {
      const textClose = src.indexOf(']', i + 1);
      if (textClose !== -1 && src[textClose + 1] === '(') {
        const urlClose = src.indexOf(')', textClose + 2);
        if (urlClose !== -1) {
          const linkText = src.slice(i + 1, textClose);
          const url = src.slice(textClose + 2, urlClose);
          result += '[' + escapeInner(linkText, ']') + '](' + url + ')';
          i = urlClose + 1;
          atLineStart = false;
          continue;
        }
      }
    }

    // ── Plain character ───────────────────────────────────────────────────────
    // Bare '\' (no valid \X pair above) — escape it
    if (ch === '\\') {
      result += '\\\\';
      atLineStart = false;
      i++;
      continue;
    }
    // Any of the 18 reserved chars in plain text — escape
    if (RESERVED.has(ch)) {
      result += '\\' + ch;
    } else {
      result += ch;
    }
    atLineStart = false;
    i++;
  }

  return result;
}

// ── validateMarkdownV2 ────────────────────────────────────────────────────────

/**
 * Returns true if the text is already valid Telegram MarkdownV2 — i.e.,
 * sanitizeMarkdownV2() would not modify it.
 *
 * Used as a quick-exit check: if the caller has already produced well-formed
 * MarkdownV2 (all reserved chars properly escaped, no **bold** to convert),
 * there is no need to re-process. The equality check is exact — any difference,
 * including the **→* conversion, returns false.
 *
 * Because sanitizeMarkdownV2 is idempotent, this correctly returns true for
 * any text produced by a prior call to sanitizeMarkdownV2.
 */
export function validateMarkdownV2(text: string): boolean {
  return sanitizeMarkdownV2(text) === text;
}
