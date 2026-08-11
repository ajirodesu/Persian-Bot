/**
 * syntax-highlight.lib — dependency-free syntax highlighter for the Files tab.
 *
 * Adapted from the fenced-code tokenizer in chat-room.tsx, but hardened for
 * the code editor use-case: it accepts RAW source text, HTML-escapes it first,
 * then tokenizes the escaped stream. Tokenizer output is a string of
 * `<span class="tok-*">` HTML intended for use with dangerouslySetInnerHTML.
 *
 * The token CSS classes (.tok-keyword, .tok-string, ...) are themed in the
 * CodeEditor component that renders this output — the same VS Code "Dark+"
 * inspired palette the chat room uses.
 *
 * Supported languages mirror the server's FileEntry.language field:
 * typescript, javascript, json, markdown, yaml, css, html, text.
 */

// ── Language configs ──────────────────────────────────────────────────────────

interface LangConfig {
  keywords: Set<string>
  lineComment?: string
  blockComment?: [string, string]
}

const JS_KEYWORDS = new Set([
  'const',
  'let',
  'var',
  'function',
  'return',
  'if',
  'else',
  'for',
  'while',
  'do',
  'switch',
  'case',
  'default',
  'break',
  'continue',
  'class',
  'extends',
  'super',
  'new',
  'this',
  'import',
  'export',
  'from',
  'as',
  'try',
  'catch',
  'finally',
  'throw',
  'typeof',
  'instanceof',
  'in',
  'of',
  'async',
  'await',
  'yield',
  'static',
  'get',
  'set',
  'void',
  'delete',
  'null',
  'undefined',
  'true',
  'false',
  'interface',
  'type',
  'enum',
  'implements',
  'public',
  'private',
  'protected',
  'readonly',
  'namespace',
  'declare',
  'abstract',
  'keyof',
  'never',
  'unknown',
  'any',
  'satisfies',
])

const BASH_KEYWORDS = new Set([
  'if',
  'then',
  'else',
  'elif',
  'fi',
  'for',
  'while',
  'do',
  'done',
  'case',
  'esac',
  'function',
  'return',
  'break',
  'continue',
  'export',
  'local',
  'readonly',
  'shift',
  'echo',
  'exit',
  'in',
  'select',
  'until',
  'time',
  'test',
])

const GENERIC_KEYWORDS = new Set([...JS_KEYWORDS, ...BASH_KEYWORDS])

function getLangConfig(lang: string): LangConfig {
  const l = (lang || '').toLowerCase()
  if (
    [
      'js',
      'jsx',
      'ts',
      'tsx',
      'javascript',
      'typescript',
      'mjs',
      'cjs',
      'mts',
      'cts',
    ].includes(l)
  ) {
    return {
      keywords: JS_KEYWORDS,
      lineComment: '//',
      blockComment: ['/*', '*/'],
    }
  }
  if (['sh', 'bash', 'shell', 'zsh'].includes(l)) {
    return { keywords: BASH_KEYWORDS, lineComment: '#' }
  }
  if (['yml', 'yaml'].includes(l)) {
    return { keywords: new Set(['true', 'false', 'null']), lineComment: '#' }
  }
  if (l === 'markdown' || l === 'md' || l === 'text' || l === 'txt') {
    return { keywords: new Set() }
  }
  // Unknown/unspecified language — best-effort union of common keywords.
  return {
    keywords: GENERIC_KEYWORDS,
    lineComment: '//',
    blockComment: ['/*', '*/'],
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/** HTML-escapes raw source so injected code can never break out of the DOM. */
export function escapeHtml(code: string): string {
  return code
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/** Consumes one already-escaped HTML entity (e.g. "&lt;") starting at `i`. */
function consumeEntity(code: string, i: number): string | null {
  if (code[i] !== '&') return null
  const semi = code.indexOf(';', i)
  if (semi === -1 || semi - i > 6) return null
  return code.slice(i, semi + 1)
}

// ── Tokenizers (operate on escaped text; treat entities as opaque) ───────────

/** General single-pass tokenizer for JS/TS/bash/sql/yaml-style languages. */
function highlightGeneric(code: string, cfg: LangConfig): string {
  const { keywords, lineComment, blockComment } = cfg
  let out = ''
  let i = 0
  const n = code.length
  while (i < n) {
    if (blockComment && code.startsWith(blockComment[0], i)) {
      const end = code.indexOf(blockComment[1], i + blockComment[0].length)
      const stop = end === -1 ? n : end + blockComment[1].length
      out += `<span class="tok-comment">${code.slice(i, stop)}</span>`
      i = stop
      continue
    }
    if (lineComment && code.startsWith(lineComment, i)) {
      let end = code.indexOf('\n', i)
      if (end === -1) end = n
      out += `<span class="tok-comment">${code.slice(i, end)}</span>`
      i = end
      continue
    }
    const ch = code[i]
    if (ch === '"' || ch === "'" || ch === '`') {
      const quote = ch
      let j = i + 1
      while (j < n) {
        if (code[j] === '\\') {
          j += 2
          continue
        }
        if (code[j] === quote) {
          j++
          break
        }
        j++
      }
      out += `<span class="tok-string">${code.slice(i, j)}</span>`
      i = j
      continue
    }
    if (/[0-9]/.test(ch)) {
      let j = i
      while (j < n && /[0-9a-fA-Fx._]/.test(code[j])) j++
      out += `<span class="tok-number">${code.slice(i, j)}</span>`
      i = j
      continue
    }
    if (/[a-zA-Z_$]/.test(ch)) {
      let j = i
      while (j < n && /[a-zA-Z0-9_$]/.test(code[j])) j++
      const word = code.slice(i, j)
      if (keywords.has(word)) {
        out += `<span class="tok-keyword">${word}</span>`
      } else if (code[j] === '(') {
        out += `<span class="tok-function">${word}</span>`
      } else if (/^[A-Z]/.test(word) && word.length > 1) {
        out += `<span class="tok-type">${word}</span>`
      } else {
        out += word
      }
      i = j
      continue
    }
    const entity = consumeEntity(code, i)
    if (entity) {
      out += entity
      i += entity.length
      continue
    }
    out += ch
    i++
  }
  return out
}

/** JSON — keys vs string values, booleans/null/numbers. */
function highlightJSON(code: string): string {
  return code.replace(
    /("(?:[^"\\]|\\.)*")(\s*:)?|\b(true|false|null)\b|(-?\d+\.?\d*(?:[eE][+-]?\d+)?)/g,
    (match, str: string, colon: string, boolNull: string, num: string) => {
      if (str) {
        const cls = colon ? 'tok-property' : 'tok-string'
        return `<span class="${cls}">${str}</span>${colon || ''}`
      }
      if (boolNull) return `<span class="tok-keyword">${boolNull}</span>`
      if (num) return `<span class="tok-number">${num}</span>`
      return match
    },
  )
}

/** CSS — comments, strings, hex colors, units, property-vs-selector. */
function highlightCSS(code: string): string {
  let out = ''
  let i = 0
  const n = code.length
  while (i < n) {
    if (code.startsWith('/*', i)) {
      const end = code.indexOf('*/', i + 2)
      const stop = end === -1 ? n : end + 2
      out += `<span class="tok-comment">${code.slice(i, stop)}</span>`
      i = stop
      continue
    }
    const ch = code[i]
    if (ch === '"' || ch === "'") {
      let j = i + 1
      while (j < n && code[j] !== ch) {
        if (code[j] === '\\') j++
        j++
      }
      j = Math.min(j + 1, n)
      out += `<span class="tok-string">${code.slice(i, j)}</span>`
      i = j
      continue
    }
    if (ch === '#' && /[0-9a-fA-F]/.test(code[i + 1] || '')) {
      let j = i + 1
      while (j < n && /[0-9a-fA-F]/.test(code[j])) j++
      out += `<span class="tok-number">${code.slice(i, j)}</span>`
      i = j
      continue
    }
    if (/[0-9]/.test(ch)) {
      const m =
        /^[0-9]+\.?[0-9]*(px|em|rem|%|vh|vw|vmin|vmax|deg|s|ms|fr|pt|ex|ch)?/.exec(
          code.slice(i),
        )
      const matched = m ? m[0] : ch
      out += `<span class="tok-number">${matched}</span>`
      i += matched.length
      continue
    }
    if (/[a-zA-Z-]/.test(ch)) {
      let j = i
      while (j < n && /[a-zA-Z0-9-]/.test(code[j])) j++
      const word = code.slice(i, j)
      let k = j
      while (k < n && /\s/.test(code[k])) k++
      if (code[k] === ':') {
        out += `<span class="tok-property">${word}</span>`
      } else {
        out += `<span class="tok-tag">${word}</span>`
      }
      i = j
      continue
    }
    const entity = consumeEntity(code, i)
    if (entity) {
      out += entity
      i += entity.length
      continue
    }
    out += ch
    i++
  }
  return out
}

/** HTML/XML — tags, attributes, values, comments (scoped to each tag). */
function highlightHtmlTag(tag: string): string {
  return tag.replace(
    /(&lt;\/?)([a-zA-Z][a-zA-Z0-9-]*)|([a-zA-Z-]+)(=)("(?:[^"]|&quot;)*"|'[^']*')|(&gt;\/?)/g,
    (
      m,
      open: string,
      tagName: string,
      attrName: string,
      eq: string,
      attrVal: string,
      close: string,
    ) => {
      if (open && tagName) {
        return `<span class="tok-punct">${open}</span><span class="tok-tag">${tagName}</span>`
      }
      if (attrName && eq && attrVal) {
        return `<span class="tok-attr">${attrName}</span><span class="tok-punct">${eq}</span><span class="tok-string">${attrVal}</span>`
      }
      if (close) return `<span class="tok-punct">${close}</span>`
      return m
    },
  )
}

function highlightHTML(code: string): string {
  let out = ''
  let i = 0
  const n = code.length
  while (i < n) {
    if (code.startsWith('&lt;!--', i)) {
      const end = code.indexOf('--&gt;', i)
      const stop = end === -1 ? n : end + 6
      out += `<span class="tok-comment">${code.slice(i, stop)}</span>`
      i = stop
      continue
    }
    if (code.startsWith('&lt;', i)) {
      const closeIdx = code.indexOf('&gt;', i)
      if (closeIdx !== -1) {
        out += highlightHtmlTag(code.slice(i, closeIdx + 4))
        i = closeIdx + 4
        continue
      }
    }
    out += code[i]
    i++
  }
  return out
}

/**
 * Highlights raw source text and returns escaped HTML with `tok-*` spans.
 * Falls back to the generic tokenizer for unrecognized languages.
 */
export function highlightToHtml(code: string, language: string | null): string {
  if (!code) return ''
  const escaped = escapeHtml(code)
  const l = (language || '').toLowerCase()
  if (l === 'json') return highlightJSON(escaped)
  if (['css', 'scss', 'less'].includes(l)) return highlightCSS(escaped)
  if (['html', 'xml', 'svg'].includes(l)) return highlightHTML(escaped)
  return highlightGeneric(escaped, getLangConfig(l))
}
