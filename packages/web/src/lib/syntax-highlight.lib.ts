/**
 * syntax-highlight.lib — dependency-free syntax highlighter for the code
 * editor.
 *
 * Accepts RAW source text, HTML-escapes it first, then tokenizes the escaped
 * stream. Output is a string of `<span class="tok-*">` HTML intended for
 * `dangerouslySetInnerHTML`. The token CSS classes are themed in the
 * CodeEditor component, so colors follow every dashboard theme.
 *
 * Supported languages: typescript, tsx (TypeScript + JSX), javascript, json,
 * markdown, html (with embedded style/script), css, yaml, shell, python,
 * sql, ini (gitignore/gitattributes/env/toml-style configs), text.
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

const SQL_KEYWORDS_LOWER = [
  'select',
  'from',
  'where',
  'insert',
  'into',
  'values',
  'update',
  'set',
  'delete',
  'create',
  'table',
  'alter',
  'drop',
  'join',
  'left',
  'right',
  'inner',
  'outer',
  'on',
  'as',
  'and',
  'or',
  'not',
  'null',
  'true',
  'false',
  'primary',
  'key',
  'foreign',
  'references',
  'index',
  'unique',
  'default',
  'order',
  'by',
  'group',
  'having',
  'limit',
  'offset',
  'union',
  'all',
  'distinct',
  'exists',
  'in',
  'is',
  'like',
  'between',
  'case',
  'when',
  'then',
  'else',
  'end',
]

// SQL is conventionally uppercase — the generic tokenizer matches
// case-sensitively, so register both casings.
const SQL_KEYWORDS = new Set([
  ...SQL_KEYWORDS_LOWER,
  ...SQL_KEYWORDS_LOWER.map((w) => w.toUpperCase()),
])

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
  if (['py', 'pyw', 'python'].includes(l)) {
    return { keywords: GENERIC_KEYWORDS, lineComment: '#' }
  }
  if (['sql'].includes(l)) {
    return {
      keywords: SQL_KEYWORDS,
      lineComment: '--',
      blockComment: ['/*', '*/'],
    }
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
function escapeHtml(code: string): string {
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

// Lowercase HTML tags (plus svg) recognized for TSX disambiguation.
const HTML_TAGS = new Set(
  (
    'a,abbr,address,article,aside,audio,b,base,blockquote,body,br,button,' +
    'canvas,caption,cite,code,col,colgroup,data,datalist,dd,del,details,dfn,' +
    'dialog,div,dl,dt,em,embed,fieldset,figcaption,figure,footer,form,h1,h2,' +
    'h3,h4,h5,h6,head,header,hgroup,hr,html,i,iframe,img,input,ins,kbd,label,' +
    'legend,li,link,main,map,mark,meta,meter,nav,noscript,object,ol,optgroup,' +
    'option,output,p,picture,pre,progress,q,rp,rt,ruby,s,samp,script,section,' +
    'select,small,source,span,strong,style,sub,summary,sup,svg,table,tbody,td,' +
    'template,textarea,tfoot,th,thead,time,title,tr,track,u,ul,var,video,wbr,' +
    'path,circle,rect,line,polyline,polygon,ellipse,text,g,defs,clipPath,' +
    'linearGradient,radialGradient,stop,use,symbol,mask,pattern,foreignObject'
  ).split(','),
)

/**
 * TSX — TypeScript with JSX. Scans for `<Tag …>` / `</Tag>` / `<>` regions
 * (tag name must start uppercase, be a known HTML tag, or open/close a
 * fragment) and highlights tags, attributes, strings and `{expression}`
 * blocks (recursed as TypeScript); everything else uses the JS tokenizer.
 */
function highlightTSX(code: string): string {
  let out = ''
  let i = 0
  const n = code.length

  // Scans a JSX tag starting at `&lt;` (index `start`) on ESCAPED text.
  // Returns the end index (exclusive, past `&gt;`) or -1. A `<` followed by
  // `(` right after the tag is a TypeScript generic call, not JSX.
  const scanTag = (start: number): number => {
    let j = start + 4 // skip `&lt;`
    let closing = false
    if (code[j] === '/') {
      closing = true
      j++
    }
    if (code.startsWith('&gt;', j)) return closing ? j + 4 : -1 // fragment <>
    const nameMatch = /^[A-Za-z][\w.-]*/.exec(code.slice(j))
    if (!nameMatch) return -1
    const tagName = nameMatch[0]
    const lower = tagName.toLowerCase()
    if (
      !closing &&
      !/^[A-Z]/.test(tagName) &&
      !HTML_TAGS.has(tagName) &&
      !HTML_TAGS.has(lower)
    ) {
      return -1
    }
    j += tagName.length
    let depth = 0
    let inStr: string | null = null
    while (j < n) {
      if (inStr) {
        if (code[j] === '\\') {
          j += 2
          continue
        }
        if (
          (inStr === '"' && code.startsWith('&quot;', j)) ||
          (inStr === "'" && code[j] === "'")
        ) {
          j += inStr === '"' ? 6 : 1
          inStr = null
          continue
        }
        j++
        continue
      }
      if (code.startsWith('&quot;', j)) {
        inStr = '"'
        j += 6
        continue
      }
      if (code[j] === "'") {
        inStr = "'"
        j++
        continue
      }
      if (code[j] === '{') depth++
      else if (code[j] === '}') {
        if (depth === 0) return -1
        depth--
      } else if (code.startsWith('&gt;', j) && depth === 0) {
        const end = j + 4
        // `Tag<...>(` is a generic call, not an element.
        if (!closing && code[end] === '(') return -1
        return end
      }
      j++
    }
    return -1
  }

  // Highlights one tag region (escaped text between `&lt;` and `&gt;`).
  const highlightTag = (tag: string): string => {
    const m = tag.length
    const open = /^(&lt;\/?)([A-Za-z][\w.-]*)/.exec(tag)
    if (!open) return tag
    let t = `<span class="tok-punct">${open[1]}</span><span class="tok-tag">${open[2]}</span>`
    let k = open[0].length
    while (k < m) {
      const rest = tag.slice(k)
      if (rest.startsWith('&gt;')) {
        t += `<span class="tok-punct">&gt;</span>`
        k += 4
        continue
      }
      if (rest === '/') {
        t += `<span class="tok-punct">/</span>`
        k += 1
        continue
      }
      const ws = /^\s+/.exec(rest)
      if (ws) {
        t += ws[0]
        k += ws[0].length
        continue
      }
      if (rest[0] === '{') {
        // {expression} — brace-match then recurse (nesting allowed).
        let d = 0
        let q: string | null = null
        let p = k
        while (p < m) {
          if (q) {
            if (tag[p] === '\\') {
              p += 2
              continue
            }
            if (
              (q === '"' && tag.startsWith('&quot;', p)) ||
              (q === "'" && tag[p] === "'")
            ) {
              p += q === '"' ? 6 : 1
              q = null
              continue
            }
            p++
            continue
          }
          if (tag.startsWith('&quot;', p)) {
            q = '"'
            p += 6
            continue
          }
          if (tag[p] === "'") {
            q = "'"
            p++
            continue
          }
          if (tag[p] === '{') d++
          else if (tag[p] === '}') {
            d--
            if (d === 0) {
              p++
              break
            }
          }
          p++
        }
        const inner = tag.slice(k + 1, p - 1)
        t += `<span class="tok-punct">{</span>${highlightTSX(inner)}<span class="tok-punct">}</span>`
        k = p
        continue
      }
      const attr = /^([A-Za-z_:][\w:.-]*)(=)?/.exec(rest)
      if (attr) {
        t += `<span class="tok-attr">${attr[1]}</span>`
        k += attr[1].length
        if (attr[2]) {
          t += `<span class="tok-punct">=</span>`
          k += 1
          const v = tag.slice(k)
          const strMatch = /^&quot;((?:(?!&quot;).)*)&quot;|^'[^'\n]*'/.exec(v)
          if (strMatch) {
            t += `<span class="tok-string">${strMatch[0]}</span>`
            k += strMatch[0].length
          } else if (v[0] === '{') {
            continue // re-loop handles the brace expression above
          }
        }
        continue
      }
      // Anything unrecognized (e.g. spread `...`) — emit one char.
      const entity = consumeEntity(tag, k)
      if (entity) {
        t += entity
        k += entity.length
      } else {
        t += tag[k]
        k++
      }
    }
    return t
  }

  while (i < n) {
    if (code[i] === '&' && code.startsWith('&lt;', i)) {
      const end = scanTag(i)
      if (end !== -1) {
        out += highlightTag(code.slice(i, end))
        i = end
        continue
      }
      out += '&lt;'
      i += 4
      continue
    }
    // Plain TS code until the next potential tag — hand the chunk to the
    // JS tokenizer so keywords/strings/comments stay correct.
    const next = code.indexOf('&lt;', i)
    const stop = next === -1 ? n : next
    out += highlightGeneric(code.slice(i, stop), {
      keywords: JS_KEYWORDS,
      lineComment: '//',
      blockComment: ['/*', '*/'],
    })
    i = stop
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

/** CSS — comments, strings, hex/id selectors, at-rules, variables, units. */
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
    // At-rules (@media, @import, @keyframes …).
    if (ch === '@') {
      const m = /^@[a-zA-Z-]+/.exec(code.slice(i))
      const word = m ? m[0] : ch
      out += `<span class="tok-keyword">${word}</span>`
      i += word.length
      continue
    }
    // CSS variables (--brand) and id selectors (#main); hex colors only
    // when the run is exactly 3/4/6/8 hex digits long.
    if (ch === '#' || (ch === '-' && code[i + 1] === '-')) {
      if (ch === '-') {
        const m = /^--[a-zA-Z0-9-_]+/.exec(code.slice(i))
        const word = m ? m[0] : '--'
        out += `<span class="tok-attr">${word}</span>`
        i += word.length
        continue
      }
      const hex = /^#([0-9a-fA-F]+)/.exec(code.slice(i))
      if (hex && [3, 4, 6, 8].includes(hex[1].length)) {
        const after = code[i + 1 + hex[1].length] ?? ''
        if (!/[0-9a-zA-Z_-]/.test(after)) {
          out += `<span class="tok-number">${hex[0]}</span>`
          i += hex[0].length
          continue
        }
      }
      const id = /^#[a-zA-Z_][\w-]*/.exec(code.slice(i))
      if (id) {
        out += `<span class="tok-tag">${id[0]}</span>`
        i += id[0].length
        continue
      }
      out += ch
      i++
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

/** HTML/XML — tags, attributes, values, comments, doctype (scoped per tag). */
function highlightHtmlTag(tag: string): string {
  return tag.replace(
    /(&lt;\/?)([a-zA-Z][a-zA-Z0-9-]*)|([a-zA-Z-]+)(=)('[^']*'|&quot;(?:(?!&quot;).)*&quot;)|(&gt;\/?)/g,
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
    if (code.startsWith('&lt;!', i)) {
      // Doctype and other declarations (case-insensitive).
      const closeIdx = code.indexOf('&gt;', i)
      const stop = closeIdx === -1 ? n : closeIdx + 4
      out += `<span class="tok-keyword">${code.slice(i, stop)}</span>`
      i = stop
      continue
    }
    if (code.startsWith('&lt;', i)) {
      const closeIdx = code.indexOf('&gt;', i)
      if (closeIdx !== -1) {
        const tagText = code.slice(i, closeIdx + 4)
        const styleOpen =
          /^&lt;style(\s|&gt;)/.test(tagText) || /^&lt;STYLE(\s|&gt;)/.test(tagText)
        const scriptOpen =
          /^&lt;script(\s|&gt;)/.test(tagText) || /^&lt;SCRIPT(\s|&gt;)/.test(tagText)
        if (styleOpen || scriptOpen) {
          // Embedded block — highlight the inner content with the matching
          // grammar (CSS or JavaScript) up to the closing tag.
          const kind = styleOpen ? 'style' : 'script'
          const closeRe = new RegExp(`&lt;/${kind}\\s*&gt;`, 'i')
          const rest = code.slice(closeIdx + 4)
          const endMatch = closeRe.exec(rest)
          const inner = endMatch
            ? rest.slice(0, endMatch.index)
            : rest
          const highlighted =
            kind === 'style'
              ? highlightCSS(inner)
              : highlightGeneric(inner, {
                  keywords: JS_KEYWORDS,
                  lineComment: '//',
                  blockComment: ['/*', '*/'],
                })
          out += highlightHtmlTag(tagText) + highlighted
          i = closeIdx + 4 + inner.length
          continue
        }
        out += highlightHtmlTag(tagText)
        i = closeIdx + 4
        continue
      }
    }
    out += code[i]
    i++
  }
  return out
}

/** INI-style configs (gitignore/gitattributes/env/toml/ini): sections, keys, values. */
function highlightIni(code: string): string {
  return code
    .split('\n')
    .map((line) => {
      if (/^\s*[#;]/.test(line)) {
        return `<span class="tok-comment">${line === '' ? ' ' : line}</span>`
      }
      const section = /^\s*(\[[^\]\n]*\])\s*$/.exec(line)
      if (section) {
        return `<span class="tok-keyword">${line}</span>`
      }
      const kv = /^\s*([^=: \t][^=:]*?)\s*([=:])\s*(.*)$/.exec(line)
      if (kv) {
        const value = kv[3] ?? ''
        return (
          `<span class="tok-attr">${kv[1]}</span>` +
          `<span class="tok-punct">${kv[2]}</span> ` +
          (value !== ''
            ? `<span class="tok-string">${value}</span>`
            : '')
        )
      }
      return line
    })
    .join('\n')
}

/**
 * Markdown — headings, emphasis, inline code, fenced blocks, links, lists,
 * blockquotes and rules. Operates on escaped text line-by-line (single pass,
 * no nesting) so it stays fast on large files. Fence bodies render as
 * strings; the fence language label is highlighted.
 */
function inlineMd(text: string): string {
  // Stash code spans first so *, _, [, ] inside them are never tokenized.
  // The sentinel is built programmatically (no-control-regex forbids the
  // literal escape inside a regex).
  const STX = String.fromCharCode(2)
  const stash: string[] = []
  const staged = text.replace(/`[^`\n]*`/g, (m) => {
    stash.push(`<span class="tok-string">${m}</span>`)
    return `${STX}${stash.length - 1}${STX}`
  })
  // Images and links: ![alt](url) / [label](url).
  let s = staged.replace(
    /(!?)\[([^\]\n]*)\]\(([^)\n]*)\)/g,
    (_m, bang: string, label: string, url: string) =>
      `${bang}[<span class="tok-function">${label}</span>](<span class="tok-string">${url}</span>)`,
  )
  // Bold (**…** / __…__) then italic (*…* / _…_).
  s = s.replace(
    /(\*\*|__)([^*\n]+?)\1/g,
    '<span class="tok-function"><strong>$2</strong></span>',
  )
  s = s.replace(
    /(^|[^*\w])\*([^*\n]+?)\*/g,
    '$1<span class="tok-comment"><em>$2</em></span>',
  )
  s = s.replace(
    /(^|[^\w])_([^_\n]+?)_/g,
    '$1<span class="tok-comment"><em>$2</em></span>',
  )
  // Restore stashed code spans (odd segments are stash indices).
  return s
    .split(STX)
    .map((part, i) => (i % 2 === 1 ? (stash[Number(part)] ?? '') : part))
    .join('')
}

function highlightMarkdown(code: string): string {
  const lines = code.split('\n')
  let inFence = false
  return lines
    .map((line) => {
      const fence = /^\s*(`{3,}|~{3,})(.*)$/.exec(line)
      if (fence) {
        if (!inFence) {
          inFence = true
          const info = (fence[2] ?? '').trim()
          return (
            `<span class="tok-punct">${fence[1]}</span>` +
            (info !== '' ? `<span class="tok-attr">${info}</span>` : '')
          )
        }
        inFence = false
        return `<span class="tok-punct">${line}</span>`
      }
      if (inFence) {
        return line === '' ? '' : `<span class="tok-string">${line}</span>`
      }
      if (/^\s{0,3}([-*_][ \t]*){3,}\s*$/.test(line)) {
        return `<span class="tok-punct">${line}</span>`
      }
      const heading = /^(#{1,6})(\s+)(.*)$/.exec(line)
      if (heading) {
        return `<span class="tok-keyword">${heading[1]}</span>${heading[2]}<span class="tok-function">${inlineMd(heading[3] ?? '')}</span>`
      }
      const quote = /^((?:\s*&gt;)+)(\s?)(.*)$/.exec(line)
      if (quote) {
        return `<span class="tok-keyword">${quote[1]}</span>${quote[2]}${inlineMd(quote[3] ?? '')}`
      }
      const list = /^(\s*(?:[-*+]|\d+[.)])\s+)(.*)$/.exec(line)
      if (list) {
        return `<span class="tok-keyword">${list[1]}</span>${inlineMd(list[2] ?? '')}`
      }
      return inlineMd(line)
    })
    .join('\n')
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
  if (l === 'tsx' || l === 'jsx') return highlightTSX(escaped)
  if (['css', 'scss', 'less', 'sass'].includes(l)) return highlightCSS(escaped)
  if (['html', 'xml', 'svg', 'vue', 'svelte'].includes(l))
    return highlightHTML(escaped)
  if (l === 'markdown' || l === 'md') return highlightMarkdown(escaped)
  if (l === 'ini') return highlightIni(escaped)
  return highlightGeneric(escaped, getLangConfig(l))
}

/**
 * Splits highlighted HTML into one entry per logical line, repairing spans
 * that cross line boundaries (multiline comments, strings, fences): open
 * spans are re-emitted at each line start and closed at each line end, so
 * every row is self-contained and independently renderable. Language
 * agnostic — driven purely by span tags, so all grammars stay correct.
 */
export function splitHighlightedHtml(highlighted: string): string[] {
  const lines = highlighted.split('\n')
  const openStack: string[] = []
  return lines.map((line) => {
    const row = openStack.join('')
    const tagRe = /(<span class="tok-[a-z]+">)|(<\/span>)/g
    let m: RegExpExecArray | null
    let out = ''
    let last = 0
    while ((m = tagRe.exec(line)) !== null) {
      out += line.slice(last, m.index)
      if (m[1]) {
        openStack.push(m[1])
        out += m[1]
      } else {
        openStack.pop()
        out += m[2]
      }
      last = m.index + m[0].length
    }
    out += line.slice(last)
    // Close everything still open so the row is self-contained.
    for (let k = openStack.length - 1; k >= 0; k--) {
      out += '</span>'
    }
    return row + out
  })
}
