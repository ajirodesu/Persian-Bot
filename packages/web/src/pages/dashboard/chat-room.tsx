/**
 * Chat Room Page — /dashboard/chat-room
 *
 * Full-featured bot chat experience:
 *  - Get Started first-time flow (high-quality / professional)
 *  - Professional message bubbles (no tails)
 *  - Bot engine integration via Socket.io
 *  - Reply support, button interactions, markdown rendering
 *  - Replit-agent style resizable input bar
 *  - Label-based file picker (works on mobile/Safari)
 *  - Three-dot menu: Clear Chat, Edit Prefix, Edit Nickname
 *  - Messages persisted in localStorage — survive navigation & refresh
 *  - User identity (userId, displayName) from Better Auth session
 */

import {
  useState,
  useEffect,
  useLayoutEffect,
  useRef,
  useCallback,
  memo,
  type RefObject,
  type KeyboardEvent as ReactKeyboardEvent,
  type ChangeEvent,
  type ClipboardEvent as ReactClipboardEvent,
  type TouchEvent as ReactTouchEvent,
  type MouseEvent as ReactMouseEvent,
} from 'react'
import {
  Menu,
  ArrowUp,
  X,
  Trash2,
  Hash,
  Reply,
  ChevronDown,
  Plus,
  FileText,
  CheckCheck,
  Sparkles,
  Zap,
  MessageCircle,
  Shield,
  DollarSign,
  Tag,
  Image as ImageIcon,
  Play,
  Pause,
  Download,
  Music2,
  Maximize2,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react'
import { Helmet } from '@dr.pogodin/react-helmet'
import { getSocket } from '@/lib/socket.lib'
import { cn } from '@/utils/cn.util'
import Logo from '@/components/ui/Logo'
import IconButton from '@/components/ui/buttons/IconButton'
import { useUserAuth } from '@/contexts/UserAuthContext'
import { useDashboardSidebar } from '@/contexts/DashboardSidebarContext'
import {
  H_HEIGHT,
  H_PX,
  H_BRAND_TEXT,
  H_CHEVRON,
  H_ICON_BTN_MOBILE,
} from '@/constants/header.constants'

// ── Types ─────────────────────────────────────────────────────────────────────

interface BotButton {
  id: string
  label: string
  style?: string
}

interface ChatAttachment {
  type: 'image' | 'video' | 'audio' | 'file'
  url?: string
  name?: string
  localUrl?: string
  file?: File
  /** Explicit MIME type sent by the server — used by <audio> to pick the right decoder. */
  mime?: string
}

/** All audio file extensions the bot can send. */
const AUDIO_EXTS = new Set([
  'mp3', 'aac', 'ogg', 'oga', 'opus', 'weba', 'wma', 'amr', 'ra', 'rm', 'spx', 'mp2', 'ac3', 'eac3',
  'wav', 'flac', 'aiff', 'aif', 'alac', 'ape', 'au', 'dsd',
  'm4a', 'm4b', 'mka', 'mid', 'midi', 'caf', 'dts',
])

interface ChatMessage {
  id: string
  type: 'user' | 'bot'
  text: string
  timestamp: number
  style?: string
  replyTo?: string | null
  buttons?: BotButton[][]
  attachments?: ChatAttachment[]
}

interface ReplyTarget {
  id: string
  text: string
  type: 'user' | 'bot'
}

// ── Storage keys ──────────────────────────────────────────────────────────────

const SESSION_ID_KEY  = 'catbot-chatroom-session-id'
const GET_STARTED_KEY = 'catbot-chatroom-started'
const PREFIX_KEY      = 'catbot-chatroom-prefix'
const NICKNAME_KEY    = 'catbot-chatroom-nickname'
const MESSAGES_KEY    = 'catbot-chatroom-messages'

const DEFAULT_PREFIX   = '/'
const DEFAULT_NICKNAME = 'Cat-Bot'

function getOrCreateSessionId(): string {
  let id = localStorage.getItem(SESSION_ID_KEY)
  if (!id) {
    id = `webchat-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
    localStorage.setItem(SESSION_ID_KEY, id)
  }
  return id
}

function saveMessagesToStorage(msgs: ChatMessage[]): void {
  try {
    // Strip localUrl / file blobs before persisting — they are not serialisable
    const serialisable = msgs.map((m) => ({
      ...m,
      attachments: m.attachments?.map(({ file: _f, localUrl: _l, ...rest }) => rest),
    }))
    localStorage.setItem(MESSAGES_KEY, JSON.stringify(serialisable))
  } catch {
    // Storage quota — silently ignore
  }
}

function loadMessagesFromStorage(): ChatMessage[] {
  try {
    const raw = localStorage.getItem(MESSAGES_KEY)
    if (!raw) return []
    return JSON.parse(raw) as ChatMessage[]
  } catch {
    return []
  }
}

function generateId(): string {
  return `msg-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
}

/**
 * Derives a username handle from the account's full display name — mirrors the
 * convention used everywhere else in the app: "Ken Iwato" → "keniwato".
 * Lowercases, strips diacritics, and removes everything that isn't a-z/0-9.
 * Falls back to 'user' if nothing usable remains (e.g. an emoji-only name).
 */
function deriveUsername(fullName: string): string {
  const handle = (fullName || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]/g, '')
  return handle || 'user'
}

function formatTime(ts: number): string {
  const d = new Date(ts)
  const h = d.getHours()
  const m = d.getMinutes().toString().padStart(2, '0')
  const ampm = h >= 12 ? 'PM' : 'AM'
  return `${h % 12 || 12}:${m} ${ampm}`
}

/** Formats a duration in seconds as "m:ss" for the audio player transport. */
function formatAudioTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00'
  const m = Math.floor(seconds / 60)
  const s = Math.floor(seconds % 60).toString().padStart(2, '0')
  return `${m}:${s}`
}

function formatDateLabel(ts: number): string {
  const d = new Date(ts)
  const today = new Date()
  const yesterday = new Date(today)
  yesterday.setDate(today.getDate() - 1)
  if (d.toDateString() === today.toDateString()) return 'Today'
  if (d.toDateString() === yesterday.toDateString()) return 'Yesterday'
  return d.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' })
}

// ── Markdown Renderer ─────────────────────────────────────────────────────────

/**
 * Strips trailing punctuation / unbalanced closing brackets that were likely
 * part of the surrounding sentence rather than the URL itself (e.g. the
 * period at the end of "Check out https://example.com." or the closing
 * paren in "(see https://example.com)"). Returns the cleaned URL plus
 * whatever was trimmed off, so the caller can re-append it after the tag.
 */
function trimTrailingPunctuation(raw: string): { url: string; trail: string } {
  let url = raw
  let trail = ''
  const CLOSERS: Record<string, string> = { ')': '(', ']': '[', '}': '{' }
  // eslint-disable-next-line no-constant-condition
  while (url.length > 0) {
    const last = url[url.length - 1]
    if (last in CLOSERS) {
      const opener = CLOSERS[last]
      const opens = (url.match(new RegExp(`\\${opener}`, 'g')) || []).length
      const closes = (url.match(new RegExp(`\\${last}`, 'g')) || []).length
      if (closes > opens) {
        trail = last + trail
        url = url.slice(0, -1)
        continue
      }
      break
    }
    if (/[.,!?;:'"]/.test(last)) {
      trail = last + trail
      url = url.slice(0, -1)
      continue
    }
    break
  }
  return { url, trail }
}

/**
 * Converts bare URLs, www.-prefixed domains, and email addresses in
 * already-HTML-escaped text into clickable <a> tags. Runs AFTER markdown
 * [text](url) links have already been converted (so those href="..." values
 * are never double-processed) and skips any URL that immediately follows
 * href=" or src=" to avoid corrupting existing tags.
 *
 * Handles links of any length — no truncation, no character cap — and every
 * common scheme: http, https, ftp, ftps, www.-only domains (no scheme),
 * mailto-able email addresses, and tel: numbers. Trailing sentence
 * punctuation and unbalanced closing brackets are trimmed off the link so
 * "Visit https://example.com." doesn't swallow the final period.
 */
function autoLinkUrls(html: string): string {
  let out = html

  // 1) Full-scheme URLs: http(s)://, ftp(s)://
  out = out.replace(
    /(?<!["'=])\b((?:https?|ftps?):\/\/[^\s<>"']+)/g,
    (_match, rawUrl: string) => {
      const { url, trail } = trimTrailingPunctuation(rawUrl)
      if (!url) return _match
      return `<a href="${url}" target="_blank" rel="noopener noreferrer" class="chatmd-link">${url}</a>${trail}`
    },
  )

  // 2) Bare "www." domains with no scheme (e.g. "www.example.com/path")
  out = out.replace(
    /(?<!["'=/])\b(www\.[^\s<>"']+\.[a-z]{2,}[^\s<>"']*)/gi,
    (_match, rawUrl: string) => {
      const { url, trail } = trimTrailingPunctuation(rawUrl)
      if (!url) return _match
      return `<a href="https://${url}" target="_blank" rel="noopener noreferrer" class="chatmd-link">${url}</a>${trail}`
    },
  )

  // 3) tel: links already prefixed explicitly by the sender
  out = out.replace(
    /(?<!["'=])\btel:([+\d][\d()\-.\s]{5,}\d)/gi,
    '<a href="tel:$1" class="chatmd-link">tel:$1</a>',
  )

  // 4) Bare email addresses → mailto:
  out = out.replace(
    /(?<!["'=:/])\b([\w.+-]+@[a-z0-9-]+(?:\.[a-z0-9-]+)*\.[a-z]{2,})\b(?!["'])/gi,
    '<a href="mailto:$1" class="chatmd-link">$1</a>',
  )

  return out
}

/**
 * Escapes HTML special characters and auto-links bare URLs.
 * Used for plain-text (non-markdown) messages so raw user/bot text
 * never renders as HTML but links are still clickable.
 */
function linkifyPlain(text: string): string {
  if (!text) return ''
  const escaped = text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
  return autoLinkUrls(escaped).replace(/\n/g, '<br>')
}

// ── Syntax highlighting (VS Code "Dark+"-style token colors) ──────────────────
//
// Lightweight, dependency-free tokenizer used to color fenced code blocks so
// bot-sent code renders with real syntax highlighting instead of flat text.
// Operates on text that has ALREADY been HTML-escaped (&, <, > only), so every
// tokenizer below is careful to treat "&lt;", "&gt;", "&amp;" as opaque,
// atomic units rather than splitting them mid-entity.

interface LangConfig {
  keywords: Set<string>
  lineComment?: string
  blockComment?: [string, string]
}

const JS_KEYWORDS = new Set([
  'const', 'let', 'var', 'function', 'return', 'if', 'else', 'for', 'while', 'do', 'switch', 'case',
  'default', 'break', 'continue', 'class', 'extends', 'super', 'new', 'this', 'import', 'export', 'from',
  'as', 'try', 'catch', 'finally', 'throw', 'typeof', 'instanceof', 'in', 'of', 'async', 'await', 'yield',
  'static', 'get', 'set', 'void', 'delete', 'null', 'undefined', 'true', 'false', 'interface', 'type',
  'enum', 'implements', 'public', 'private', 'protected', 'readonly', 'namespace', 'declare', 'abstract',
  'keyof', 'never', 'unknown', 'any', 'satisfies',
])

const PY_KEYWORDS = new Set([
  'def', 'return', 'if', 'elif', 'else', 'for', 'while', 'break', 'continue', 'pass', 'class', 'import',
  'from', 'as', 'try', 'except', 'finally', 'raise', 'with', 'lambda', 'yield', 'global', 'nonlocal',
  'assert', 'del', 'in', 'is', 'not', 'and', 'or', 'True', 'False', 'None', 'async', 'await', 'self',
])

const C_FAMILY_KEYWORDS = new Set([
  'if', 'else', 'for', 'while', 'do', 'switch', 'case', 'default', 'break', 'continue', 'return', 'class',
  'struct', 'enum', 'union', 'public', 'private', 'protected', 'static', 'final', 'void', 'int', 'float',
  'double', 'char', 'bool', 'long', 'short', 'unsigned', 'signed', 'const', 'new', 'delete', 'this',
  'super', 'extends', 'implements', 'import', 'package', 'namespace', 'using', 'template', 'typename',
  'virtual', 'override', 'try', 'catch', 'finally', 'throw', 'true', 'false', 'null', 'nullptr', 'func',
  'var', 'let', 'fn', 'impl', 'trait', 'mod', 'pub', 'match', 'defer', 'go', 'chan', 'select', 'echo',
  'end', 'then', 'begin', 'elif', 'fi', 'done', 'function',
])

const BASH_KEYWORDS = new Set([
  'if', 'then', 'else', 'elif', 'fi', 'for', 'while', 'do', 'done', 'case', 'esac', 'function', 'return',
  'break', 'continue', 'export', 'local', 'readonly', 'shift', 'echo', 'exit', 'in', 'select', 'until',
  'time', 'test',
])

const SQL_KEYWORDS = new Set([
  'select', 'from', 'where', 'insert', 'into', 'values', 'update', 'set', 'delete', 'create', 'table',
  'alter', 'drop', 'join', 'inner', 'left', 'right', 'outer', 'on', 'group', 'by', 'order', 'having',
  'limit', 'offset', 'and', 'or', 'not', 'null', 'is', 'in', 'like', 'as', 'distinct', 'union', 'all',
  'exists', 'case', 'when', 'then', 'else', 'end', 'primary', 'key', 'foreign', 'references', 'default',
  'unique', 'index', 'view', 'with',
])

const GENERIC_KEYWORDS = new Set([...JS_KEYWORDS, ...PY_KEYWORDS, ...C_FAMILY_KEYWORDS])

function getLangConfig(lang: string): LangConfig {
  const l = lang.toLowerCase()
  if (['js', 'jsx', 'ts', 'tsx', 'javascript', 'typescript', 'mjs', 'cjs'].includes(l)) {
    return { keywords: JS_KEYWORDS, lineComment: '//', blockComment: ['/*', '*/'] }
  }
  if (['py', 'python'].includes(l)) return { keywords: PY_KEYWORDS, lineComment: '#' }
  if (['rb', 'ruby'].includes(l)) return { keywords: PY_KEYWORDS, lineComment: '#' }
  if (['sh', 'bash', 'shell', 'zsh'].includes(l)) return { keywords: BASH_KEYWORDS, lineComment: '#' }
  if (l === 'sql') return { keywords: SQL_KEYWORDS, lineComment: '--' }
  if (['yml', 'yaml'].includes(l)) return { keywords: new Set(['true', 'false', 'null']), lineComment: '#' }
  if (['java', 'c', 'cpp', 'c++', 'cs', 'csharp', 'go', 'rust', 'rs', 'php', 'swift', 'kotlin', 'kt', 'dart'].includes(l)) {
    return { keywords: C_FAMILY_KEYWORDS, lineComment: '//', blockComment: ['/*', '*/'] }
  }
  // Unknown/unspecified language — best-effort union of common keywords.
  return { keywords: GENERIC_KEYWORDS, lineComment: '//', blockComment: ['/*', '*/'] }
}

/** Consumes one already-escaped HTML entity (e.g. "&lt;") starting at `i`, if
 *  present, so tokenizers never slice an entity in half. Returns null if `i`
 *  isn't the start of an entity. */
function consumeEntity(code: string, i: number): string | null {
  if (code[i] !== '&') return null
  const semi = code.indexOf(';', i)
  if (semi === -1 || semi - i > 6) return null
  return code.slice(i, semi + 1)
}

/** General-purpose single-pass tokenizer for C-like / Python / bash / SQL /
 *  YAML style languages — comments, strings, numbers, keywords, function
 *  calls (identifier immediately followed by "("), and PascalCase types. */
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
        if (code[j] === '\\') { j += 2; continue }
        if (code[j] === quote) { j++; break }
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

/** JSON — object keys colored separately from string values, plus
 *  booleans/null/numbers. Single regex pass, safe because JSON has no
 *  comments or nested-quote ambiguity to worry about. */
function highlightJSON(code: string): string {
  return code.replace(
    /("(?:[^"\\]|\\.)*")(\s*:)?|\b(true|false|null)\b|(-?\d+\.?\d*(?:[eE][+-]?\d+)?)/g,
    (match, str, colon, boolNull, num) => {
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

/** CSS — comments, strings, hex colors, dimensioned numbers, and
 *  property-vs-selector coloring (a bare word immediately followed by ":"
 *  is treated as a property name). */
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
      while (j < n && code[j] !== ch) { if (code[j] === '\\') j++; j++ }
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
      const m = /^[0-9]+\.?[0-9]*(px|em|rem|%|vh|vw|vmin|vmax|deg|s|ms|fr|pt|ex|ch)?/.exec(code.slice(i))
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

/** HTML/XML — tags, attribute names/values, and comments. Only scans within
 *  the bounds of each "&lt;...&gt;" delimited tag, so attribute-value
 *  quotes never leak into (or get corrupted by) surrounding regex passes. */
function highlightHtmlTag(tag: string): string {
  return tag.replace(
    /(&lt;\/?)([a-zA-Z][a-zA-Z0-9-]*)|([a-zA-Z-]+)(=)("(?:[^"]|&quot;)*"|'[^']*')|(&gt;\/?)/g,
    (m, open, tagName, attrName, eq, attrVal, close) => {
      if (open && tagName) return `<span class="tok-punct">${open}</span><span class="tok-tag">${tagName}</span>`
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

/** Dispatches to the right tokenizer for the fenced block's declared
 *  language (falling back to the generic multi-language tokenizer for
 *  anything unrecognized or unspecified). */
function highlightCode(code: string, lang: string): string {
  const l = (lang || '').toLowerCase()
  if (l === 'json') return highlightJSON(code)
  if (['css', 'scss', 'less'].includes(l)) return highlightCSS(code)
  if (['html', 'xml', 'svg'].includes(l)) return highlightHTML(code)
  return highlightGeneric(code, getLangConfig(l))
}

function renderMarkdown(text: string): string {
  if (!text) return ''

  let html = text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')

  const codeBlocks: string[] = []
  const pushCodeBlock = (code: string, langRaw: string): string => {
    const idx = codeBlocks.length
    const trimmed = code.trim()
    const lang = langRaw.trim()
    const highlighted = trimmed ? highlightCode(trimmed, lang) : trimmed
    // Base64-encode the (already HTML-escaped) code so it can travel safely
    // inside an HTML attribute — decoded + un-escaped again on copy click.
    const encoded = btoa(unescape(encodeURIComponent(trimmed)))
    const langLabel = lang ? `<span class="chatmd-pre-lang">${lang}</span>` : ''
    codeBlocks.push(
      `<div class="chatmd-pre-wrap">` +
        langLabel +
        `<pre class="chatmd-pre"><code class="chatmd-code-block">${highlighted}</code></pre>` +
        `<button type="button" class="chatmd-copy-btn" data-code="${encoded}" aria-label="Copy code">Copy</button>` +
        `</div>`,
    )
    return `\x00CODE${idx}\x00`
  }
  // Fenced blocks with an explicit language directly after the opening
  // fence (e.g. "```ts\n...\n```") are highlighted using that language.
  html = html.replace(/```([a-zA-Z][a-zA-Z0-9_+-]{0,15})\n([\s\S]*?)```/g, (_, langRaw: string, code: string) =>
    pushCodeBlock(code, langRaw),
  )
  // Anything left over is a fenced block with no language directive.
  html = html.replace(/```([\s\S]*?)```/g, (_, code: string) => pushCodeBlock(code, ''))

  html = html.replace(/`([^`\n]+)`/g, '<code class="chatmd-code">$1</code>')
  html = html.replace(/\*\*\*([^*\n]+)\*\*\*/g, '<strong><em>$1</em></strong>')
  html = html.replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>')
  html = html.replace(/\*([^*\n]+)\*/g, '<em>$1</em>')
  html = html.replace(/__([^_\n]+)__/g, '<u>$1</u>')
  html = html.replace(/_([^_\n]+)_/g, '<em>$1</em>')
  html = html.replace(/~~([^~\n]+)~~/g, '<del>$1</del>')
  html = html.replace(
    /\[([^\]]+)\]\(([^)]+)\)/g,
    '<a href="$2" target="_blank" rel="noopener noreferrer" class="chatmd-link">$1</a>',
  )
  // Auto-link bare URLs that weren't already wrapped by the [text](url) step above
  html = autoLinkUrls(html)
  html = html.replace(/^### (.+)$/gm, '<span class="chatmd-h3">$1</span>')
  html = html.replace(/^## (.+)$/gm, '<span class="chatmd-h2">$1</span>')
  html = html.replace(/^# (.+)$/gm, '<span class="chatmd-h1">$1</span>')
  html = html.replace(/^─{3,}$/gm, '<hr class="chatmd-hr" />')
  html = html.replace(/^[•·\-*] (.+)$/gm, '<span class="chatmd-li">• $1</span>')
  html = html.replace(/^(\d+)\. (.+)$/gm, '<span class="chatmd-oli">$1. $2</span>')
  html = html.replace(/^&gt; (.+)$/gm, '<span class="chatmd-quote">$1</span>')
  html = html.replace(/\n/g, '<br>')

  codeBlocks.forEach((block, idx) => {
    html = html.replace(`\x00CODE${idx}\x00`, block)
  })

  return html
}

/** Reverses the minimal HTML-escaping applied before markdown parsing so the
 *  clipboard receives the original code text, not entity-escaped HTML. */
function unescapeHtmlEntities(text: string): string {
  return text.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')
}

/** Event-delegated click handler for the "Copy" button embedded in fenced
 *  code blocks — works because clicks on nodes injected via
 *  dangerouslySetInnerHTML still bubble up through the real DOM to this
 *  handler on the enclosing React element. */
function handleMarkdownClick(e: ReactMouseEvent<HTMLSpanElement>) {
  const btn = (e.target as HTMLElement).closest<HTMLButtonElement>('.chatmd-copy-btn')
  if (!btn) return
  const encoded = btn.getAttribute('data-code')
  if (!encoded) return
  try {
    const raw = unescapeHtmlEntities(decodeURIComponent(escape(atob(encoded))))
    void navigator.clipboard.writeText(raw)
    const original = btn.textContent
    btn.textContent = 'Copied!'
    btn.disabled = true
    setTimeout(() => {
      btn.textContent = original
      btn.disabled = false
    }, 1500)
  } catch {
    // Clipboard API unavailable (insecure context, permissions, etc.) — no-op
  }
}

function MarkdownText({ text, style }: { text: string; style?: string }) {
  if (!text) return null
  if (style !== 'markdown') {
    return (
      <span
        className="whitespace-pre-wrap break-words"
        dangerouslySetInnerHTML={{ __html: linkifyPlain(text) }}
      />
    )
  }
  return (
    <span
      className="chatmd break-words"
      onClick={handleMarkdownClick}
      dangerouslySetInnerHTML={{ __html: renderMarkdown(text) }}
    />
  )
}

// ── Audio Player ──────────────────────────────────────────────────────────────

/**
 * High-quality, fully custom audio player used for every bot/user audio
 * attachment — replaces the bare-bones native <audio controls> element with
 * a proper transport: play/pause, scrubbable progress bar with hover
 * preview, live time readout, loading state, and a one-tap download
 * action.
 */
function AudioPlayer({
  url,
  mime,
  fileName,
  flush,
}: {
  url: string
  mime: string
  fileName: string
  /** Render integrated into the bubble — full width, no border, no boxed
   *  surface of its own — instead of the standalone bordered pill. */
  flush?: boolean
}) {
  const audioRef = useRef<HTMLAudioElement>(null)
  const [isPlaying, setIsPlaying] = useState(false)
  const [isLoading, setIsLoading] = useState(true)
  const [duration, setDuration] = useState(0)
  const [currentTime, setCurrentTime] = useState(0)
  const [isScrubbing, setIsScrubbing] = useState(false)

  useEffect(() => {
    const audio = audioRef.current
    if (!audio) return

    const onLoadedMetadata = () => {
      setDuration(Number.isFinite(audio.duration) ? audio.duration : 0)
      setIsLoading(false)
    }
    const onTimeUpdate = () => {
      if (!isScrubbing) setCurrentTime(audio.currentTime)
    }
    const onEnded = () => {
      setIsPlaying(false)
      setCurrentTime(0)
    }
    const onPlay = () => setIsPlaying(true)
    const onPause = () => setIsPlaying(false)
    const onWaiting = () => setIsLoading(true)
    const onCanPlay = () => setIsLoading(false)

    audio.addEventListener('loadedmetadata', onLoadedMetadata)
    audio.addEventListener('timeupdate', onTimeUpdate)
    audio.addEventListener('ended', onEnded)
    audio.addEventListener('play', onPlay)
    audio.addEventListener('pause', onPause)
    audio.addEventListener('waiting', onWaiting)
    audio.addEventListener('canplay', onCanPlay)
    audio.addEventListener('canplaythrough', onCanPlay)

    return () => {
      audio.removeEventListener('loadedmetadata', onLoadedMetadata)
      audio.removeEventListener('timeupdate', onTimeUpdate)
      audio.removeEventListener('ended', onEnded)
      audio.removeEventListener('play', onPlay)
      audio.removeEventListener('pause', onPause)
      audio.removeEventListener('waiting', onWaiting)
      audio.removeEventListener('canplay', onCanPlay)
      audio.removeEventListener('canplaythrough', onCanPlay)
    }
  }, [isScrubbing])

  const togglePlay = useCallback(() => {
    const audio = audioRef.current
    if (!audio) return
    if (audio.paused) {
      void audio.play().catch(() => {
        /* autoplay/decoding failure — UI simply stays paused */
      })
    } else {
      audio.pause()
    }
  }, [])

  const handleSeek = useCallback((e: ChangeEvent<HTMLInputElement>) => {
    const audio = audioRef.current
    const value = Number(e.target.value)
    setCurrentTime(value)
    if (audio) audio.currentTime = value
  }, [])

  const progressPct = duration > 0 ? Math.min(100, (currentTime / duration) * 100) : 0

  return (
    <div
      className={cn(
        'cr-audio-player flex items-center gap-3',
        flush
          ? 'w-full px-3.5 py-3'
          : 'pl-1.5 pr-3 py-2 rounded-2xl bg-black/25 border border-white/10 min-w-[248px] max-w-[300px]',
      )}
    >
      <audio ref={audioRef} preload="metadata">
        <source src={url} type={mime} />
      </audio>

      <button
        type="button"
        onClick={togglePlay}
        disabled={isLoading}
        aria-label={isPlaying ? 'Pause audio' : 'Play audio'}
        className="shrink-0 flex items-center justify-center h-9 w-9 rounded-full bg-primary text-on-primary shadow-md hover:brightness-110 active:scale-95 transition-all disabled:opacity-60 disabled:active:scale-100"
      >
        {isLoading ? (
          <span className="h-3.5 w-3.5 rounded-full border-2 border-current border-t-transparent animate-spin" />
        ) : isPlaying ? (
          <Pause className="h-4 w-4 fill-current" />
        ) : (
          <Play className="h-4 w-4 fill-current ml-0.5" />
        )}
      </button>

      <div className="flex-1 min-w-0 flex flex-col gap-1.5">
        <div className="flex items-center gap-1.5 min-w-0">
          <Music2 className="h-3 w-3 opacity-45 shrink-0" />
          <span className="text-[11px] font-medium truncate opacity-80">{fileName}</span>
        </div>

        <div className="relative flex items-center h-3 group/seek">
          <div className="absolute inset-x-0 h-[3px] rounded-full bg-white/15 overflow-hidden pointer-events-none">
            <div
              className="h-full bg-primary rounded-full"
              style={{ width: `${progressPct}%`, transition: isScrubbing ? 'none' : 'width 0.1s linear' }}
            />
          </div>
          <div
            className="absolute h-2.5 w-2.5 rounded-full bg-primary shadow -translate-x-1/2 opacity-0 group-hover/seek:opacity-100 transition-opacity pointer-events-none"
            style={{ left: `${progressPct}%` }}
          />
          <input
            type="range"
            min={0}
            max={duration || 0}
            step={0.01}
            value={Math.min(currentTime, duration || 0)}
            onChange={handleSeek}
            onPointerDown={() => setIsScrubbing(true)}
            onPointerUp={() => setIsScrubbing(false)}
            disabled={isLoading || duration === 0}
            aria-label={`Seek — ${formatAudioTime(currentTime)} of ${formatAudioTime(duration)}`}
            className="cr-audio-range absolute inset-0 w-full m-0 cursor-pointer disabled:cursor-default"
          />
        </div>

        <div className="flex items-center justify-between text-[10px] tabular-nums opacity-45 leading-none">
          <span>{formatAudioTime(currentTime)}</span>
          <span>{formatAudioTime(duration)}</span>
        </div>
      </div>

      <div className="relative flex flex-col items-center shrink-0">
        <a
          href={url}
          download={fileName}
          aria-label={`Download ${fileName}`}
          className="p-1.5 rounded-full text-on-surface-variant/60 hover:text-primary hover:bg-white/5 transition-colors"
        >
          <Download className="h-3.5 w-3.5" />
        </a>
      </div>
    </div>
  )
}

// ── Image Lightbox ────────────────────────────────────────────────────────────

/** Renders the currently active lightbox image with its own load/zoom state — mounted fresh (via a `key` on index) each time the active image changes, so state resets naturally instead of via an effect. */
function LightboxImage({ url, fileName }: { url: string; fileName: string }) {
  const [isLoading, setIsLoading] = useState(true)
  const [isZoomed, setIsZoomed] = useState(false)

  return (
    <>
      {isLoading && (
        <span className="absolute h-8 w-8 rounded-full border-[3px] border-white/25 border-t-white animate-spin" />
      )}
      <img
        src={url}
        alt={fileName}
        onLoad={() => setIsLoading(false)}
        onClick={() => setIsZoomed((z) => !z)}
        draggable={false}
        className={cn(
          'rounded-lg select-none transition-transform duration-200 ease-out',
          isZoomed
            ? 'max-w-none max-h-none scale-[1.9] cursor-zoom-out'
            : 'max-w-[94vw] max-h-[86vh] object-contain cursor-zoom-in',
          isLoading && 'opacity-0',
        )}
      />
    </>
  )
}

/**
 * Fullscreen photo viewer for chat image attachments. Supports click-to-zoom,
 * download, keyboard navigation (Esc to close, ←/→ to switch), and a
 * filmstrip + prev/next controls when the triggering message has more than
 * one image attached.
 */
function ImageLightbox({
  images,
  index,
  onIndexChange,
  onClose,
}: {
  images: ChatAttachment[]
  index: number
  onIndexChange: (i: number) => void
  onClose: () => void
}) {
  const current = images[index]
  const url = current?.localUrl ?? current?.url ?? ''
  const fileName = current?.name ?? 'image'
  const hasMultiple = images.length > 1

  const goPrev = useCallback(() => {
    onIndexChange((index - 1 + images.length) % images.length)
  }, [index, images.length, onIndexChange])

  const goNext = useCallback(() => {
    onIndexChange((index + 1) % images.length)
  }, [index, images.length, onIndexChange])

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
      else if (e.key === 'ArrowLeft' && hasMultiple) goPrev()
      else if (e.key === 'ArrowRight' && hasMultiple) goNext()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [onClose, goPrev, goNext, hasMultiple])

  // Lock background scroll while the lightbox is open
  useEffect(() => {
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = prevOverflow
    }
  }, [])

  if (!current || !url) return null

  return (
    <div
      className="fixed inset-0 z-[300] flex items-center justify-center bg-black/92 backdrop-blur-md"
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
      style={{ animation: 'cr-fadeInFast 140ms ease both' }}
    >
      {/* Top bar */}
      <div className="absolute top-0 inset-x-0 flex items-center justify-between gap-3 px-4 py-3 bg-gradient-to-b from-black/70 to-transparent z-10">
        <div className="flex items-center gap-2 min-w-0">
          <ImageIcon className="h-4 w-4 text-white/70 shrink-0" />
          <span className="text-sm text-white/90 font-medium truncate max-w-[46vw]">{fileName}</span>
          {hasMultiple && (
            <span className="text-xs text-white/50 tabular-nums shrink-0">{index + 1} / {images.length}</span>
          )}
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          <a
            href={url}
            download={fileName}
            aria-label="Download image"
            className="p-2 rounded-full text-white/80 hover:bg-white/10 hover:text-white transition-colors"
            onClick={(e) => e.stopPropagation()}
          >
            <Download className="h-[18px] w-[18px]" />
          </a>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="p-2 rounded-full text-white/80 hover:bg-white/10 hover:text-white transition-colors"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
      </div>

      {/* Prev / next */}
      {hasMultiple && (
        <>
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); goPrev() }}
            aria-label="Previous image"
            className="absolute left-2 sm:left-4 top-1/2 -translate-y-1/2 p-2.5 rounded-full bg-black/40 text-white/80 hover:bg-black/60 hover:text-white border border-white/10 transition-colors z-10"
          >
            <ChevronLeft className="h-5 w-5" />
          </button>
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); goNext() }}
            aria-label="Next image"
            className="absolute right-2 sm:right-4 top-1/2 -translate-y-1/2 p-2.5 rounded-full bg-black/40 text-white/80 hover:bg-black/60 hover:text-white border border-white/10 transition-colors z-10"
          >
            <ChevronRight className="h-5 w-5" />
          </button>
        </>
      )}

      {/* Image */}
      <div
        className="relative max-w-[94vw] max-h-[86vh] flex items-center justify-center overflow-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <LightboxImage key={index} url={url} fileName={fileName} />
      </div>

      {/* Filmstrip for multi-image messages */}
      {hasMultiple && (
        <div
          className="absolute bottom-0 inset-x-0 flex items-center justify-center gap-1.5 px-4 py-3 bg-gradient-to-t from-black/70 to-transparent overflow-x-auto"
          onClick={(e) => e.stopPropagation()}
        >
          {images.map((img, i) => (
            <button
              key={i}
              type="button"
              onClick={() => onIndexChange(i)}
              aria-label={`View image ${i + 1}`}
              className={cn(
                'h-10 w-10 rounded-lg overflow-hidden border-2 transition-all shrink-0',
                i === index ? 'border-primary opacity-100 scale-105' : 'border-transparent opacity-50 hover:opacity-80',
              )}
            >
              <img src={img.localUrl ?? img.url} alt="" className="h-full w-full object-cover" />
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

// ── Attachment View ───────────────────────────────────────────────────────────

/** Resolves a playable audio MIME type — prefers the server-provided MIME,
 *  falling back to a filename-extension lookup covering the full range of
 *  formats YTDLnis/yt-dlp and common encoders produce. */
function resolveAudioMime(att: ChatAttachment, url: string): string {
  if (att.mime) return att.mime
  const ext = (att.name ?? url ?? '').split('.').pop()?.split('?')[0]?.toLowerCase() ?? ''
  const map: Record<string, string> = {
    mp3: 'audio/mpeg', mp2: 'audio/mpeg', aac: 'audio/aac', ac3: 'audio/ac3', eac3: 'audio/eac3',
    ogg: 'audio/ogg', oga: 'audio/ogg', opus: 'audio/ogg', wav: 'audio/wav', flac: 'audio/flac',
    weba: 'audio/webm', wma: 'audio/x-ms-wma', amr: 'audio/amr', ra: 'audio/x-realaudio',
    rm: 'audio/x-realaudio', spx: 'audio/x-speex', aiff: 'audio/x-aiff', aif: 'audio/x-aiff',
    au: 'audio/basic', m4a: 'audio/mp4', m4b: 'audio/mp4', alac: 'audio/mp4',
    mka: 'audio/x-matroska', mid: 'audio/midi', midi: 'audio/midi',
    caf: 'audio/x-caf', dts: 'audio/vnd.dts', ape: 'audio/x-ape',
  }
  return map[ext] ?? 'audio/mpeg'
}

/**
 * Flush, borderless media renderer for image/video/audio attachments — used
 * when media is "stuck" directly to the bubble edges (no padding, no
 * border, no independent border-radius). Corner rounding comes entirely
 * from the bubble's own `overflow-hidden` clip, so the media appears
 * seamlessly fused to the bubble rather than floating inside it, and the
 * bubble itself widens to the media's own width — capped at the same
 * max-width every message bubble is capped at — so bubble and media are
 * always exactly the same size. An optional overlay (timestamp + read
 * receipt) is rendered on the last visual (image/video) item, matching the
 * pattern used by high-quality chat clients for full-bleed photos.
 */
function FlushMedia({
  att,
  onOpen,
  showMeta,
  isBot,
  timestamp,
  disableFullscreen,
  onMediaLoad,
}: {
  att: ChatAttachment
  onOpen?: () => void
  showMeta?: boolean
  isBot: boolean
  timestamp: number
  /** When true, the image renders flat — no zoom cursor, no hover
   *  overlay, no fullscreen button. Used for messages that also carry
   *  interactive buttons, where the photo is illustrative rather than
   *  an independently-openable attachment. */
  disableFullscreen?: boolean
  /** Fired once the image/video has actually loaded and the bubble has
   *  settled at its final height. */
  onMediaLoad?: () => void
}) {
  const url = att.localUrl ?? att.url
  if (!url) return null

  const MetaOverlay = showMeta ? (
    <div className="absolute bottom-1.5 right-1.5 flex items-center gap-1 px-1.5 py-[3px] rounded-full bg-black/55 backdrop-blur-sm text-white shadow-sm pointer-events-none">
      <span className="text-[10px] leading-none select-none tabular-nums opacity-90">
        {formatTime(timestamp)}
      </span>
      {!isBot && <CheckCheck className="h-3 w-3 opacity-90" />}
    </div>
  ) : null

  if (att.type === 'image') {
    if (disableFullscreen) {
      return (
        <div className="relative block w-full bg-black/10">
          <img
            src={url}
            alt={att.name ?? 'image'}
            loading="lazy"
            decoding="async"
            draggable={false}
            onLoad={onMediaLoad}
            className="block w-full h-auto max-h-[340px] object-cover select-none"
          />
          {MetaOverlay}
        </div>
      )
    }

    return (
      <button
        type="button"
        onClick={onOpen}
        aria-label={`View ${att.name ?? 'image'} fullscreen`}
        className="group relative block w-full cursor-zoom-in bg-black/10"
      >
        <img
          src={url}
          alt={att.name ?? 'image'}
          loading="lazy"
          decoding="async"
          draggable={false}
          onLoad={onMediaLoad}
          className="block w-full h-auto max-h-[340px] object-cover select-none"
        />
        <div className="absolute inset-0 flex items-center justify-center bg-black/0 group-hover:bg-black/20 transition-colors duration-200">
          <span className="flex items-center justify-center h-9 w-9 rounded-full bg-black/50 text-white opacity-0 group-hover:opacity-100 scale-90 group-hover:scale-100 transition-all duration-200">
            <Maximize2 className="h-4 w-4" />
          </span>
        </div>
        {MetaOverlay}
      </button>
    )
  }

  if (att.type === 'video') {
    return (
      <div className="group relative block w-full bg-black">
        <video
          src={url}
          controls
          playsInline
          preload="metadata"
          controlsList="nodownload noremoteplayback"
          onLoadedData={onMediaLoad}
          className="block w-full h-auto max-h-[340px] bg-black"
        />
        {MetaOverlay}
      </div>
    )
  }

  // audio — same flush treatment: full bubble width, no border, no boxed
  // "pill" surface of its own; it reads as part of the bubble, not a
  // separate element glued inside it.
  const mime = resolveAudioMime(att, url)
  const fileName = att.name ?? 'audio'
  return <AudioPlayer url={url} mime={mime} fileName={fileName} flush />
}

function AttachmentView({ att }: { att: ChatAttachment }) {
  const url = att.localUrl ?? att.url
  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      download={att.name}
      className="flex items-center gap-2 px-3 py-2 rounded-xl bg-black/20 hover:bg-black/30 transition-colors text-xs border border-white/10"
    >
      <FileText className="h-4 w-4 shrink-0 opacity-70" />
      <span className="truncate max-w-[160px]">{att.name ?? 'File'}</span>
    </a>
  )
}


// ── Bot Button ────────────────────────────────────────────────────────────────

const BotButtonRow = memo(function BotButtonRow({
  buttons,
  onButtonClick,
  messageId,
}: {
  buttons: BotButton[][]
  onButtonClick: (buttonId: string, messageId: string) => void
  messageId: string
}) {
  return (
    <div className="flex flex-col gap-1.5 mt-2.5">
      {buttons.map((row, rowIdx) => (
        <div key={rowIdx} className="flex flex-wrap gap-1.5">
          {row.map((btn) => (
            <button
              key={btn.id}
              type="button"
              onClick={() => onButtonClick(btn.id, messageId)}
              className={cn(
                'px-3.5 py-1.5 rounded-xl text-xs font-semibold transition-all',
                'border focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40',
                btn.style === 'danger'
                  ? 'border-error/50 text-error hover:bg-error/10 active:scale-95'
                  : btn.style === 'success'
                    ? 'border-emerald-400/50 text-emerald-400 hover:bg-emerald-400/10 active:scale-95'
                    : 'border-primary/40 text-primary hover:bg-primary/10 active:scale-95',
              )}
            >
              {btn.label}
            </button>
          ))}
        </div>
      ))}
    </div>
  )
})

// ── Reply Quote inside bubble ─────────────────────────────────────────────────

const ReplyQuote = memo(function ReplyQuote({
  messages,
  replyToId,
  botNickname,
  displayName,
  onClick,
}: {
  messages: ChatMessage[]
  replyToId: string
  botNickname: string
  displayName: string
  onClick?: () => void
}) {
  const original = messages.find((m) => m.id === replyToId)
  if (!original) return null
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex flex-col gap-0.5 mb-1.5 pl-2 border-l-[3px] border-current/50 min-w-0 w-full max-w-full overflow-hidden text-left cursor-pointer active:opacity-70 transition-opacity"
    >
      <p className="text-[12.5px] font-bold leading-tight truncate w-full max-w-full">
        {original.type === 'bot' ? botNickname : displayName}
      </p>
      <p className="text-[12.5px] opacity-70 truncate leading-tight w-full max-w-full">
        {original.text ? original.text.split('\n')[0] : '📎 Attachment'}
      </p>
    </button>
  )
})

// ── Message Bubble ────────────────────────────────────────────────────────────

const SWIPE_REPLY_THRESHOLD = 56
const SWIPE_REPLY_MAX = 72

const MessageBubble = memo(function MessageBubble({
  msg,
  messages,
  onReply,
  onButtonClick,
  onImageOpen,
  onQuoteClick,
  onMediaLoad,
  botNickname,
  displayName,
}: {
  msg: ChatMessage
  messages: ChatMessage[]
  onReply: (target: ReplyTarget) => void
  onButtonClick: (buttonId: string, messageId: string) => void
  onImageOpen: (images: ChatAttachment[], index: number) => void
  onQuoteClick: (messageId: string) => void
  /** Fired when an image/video attachment finishes loading, so the
   *  thread can re-check whether it should follow the bubble's new,
   *  final height down to the bottom. */
  onMediaLoad?: () => void
  botNickname: string
  displayName: string
}) {
  const [swipeReplyVisible, setSwipeReplyVisible] = useState(false)
  const isBot = msg.type === 'bot'

  // ── Swipe-to-reply (touch) ─────────────────────────────────────────────
  // Purely DOM-driven while dragging (no re-render per frame) for a smooth,
  // efficient gesture; React state only flips the reply-affordance icon and
  // fires onReply once the gesture completes past the threshold.
  const bubbleColRef = useRef<HTMLDivElement>(null)
  const touchStart = useRef({ x: 0, y: 0 })
  const dragDistance = useRef(0)
  const isHorizontalSwipe = useRef<boolean | null>(null)
  const isDragging = useRef(false)

  const handleTouchStart = useCallback((e: ReactTouchEvent) => {
    if (e.touches.length !== 1) return
    touchStart.current = { x: e.touches[0].clientX, y: e.touches[0].clientY }
    dragDistance.current = 0
    isHorizontalSwipe.current = null
    isDragging.current = true
  }, [])

  const handleTouchMove = useCallback((e: ReactTouchEvent) => {
    if (!isDragging.current) return
    const touch = e.touches[0]
    const dx = touch.clientX - touchStart.current.x
    const dy = touch.clientY - touchStart.current.y

    if (isHorizontalSwipe.current === null) {
      if (Math.abs(dx) < 6 && Math.abs(dy) < 6) return
      isHorizontalSwipe.current = Math.abs(dx) > Math.abs(dy)
      if (!isHorizontalSwipe.current) return
    }
    if (!isHorizontalSwipe.current) return

    e.preventDefault()
    // Bot bubbles sit on the left (swipe right to reply), user bubbles sit
    // on the right (swipe left to reply) — `dir` normalizes both to a
    // positive "reveal" progress value.
    const dir = isBot ? 1 : -1
    const clamped = Math.max(0, Math.min(SWIPE_REPLY_MAX, dx * dir))
    dragDistance.current = clamped
    if (bubbleColRef.current) {
      bubbleColRef.current.style.transform = `translateX(${clamped * dir}px)`
    }
    setSwipeReplyVisible(clamped > 14)
  }, [isBot])

  const handleTouchEnd = useCallback(() => {
    if (!isDragging.current) return
    isDragging.current = false
    const triggered = isHorizontalSwipe.current && dragDistance.current >= SWIPE_REPLY_THRESHOLD
    if (bubbleColRef.current) {
      bubbleColRef.current.style.transition = 'transform 180ms ease'
      bubbleColRef.current.style.transform = 'translateX(0px)'
      const el = bubbleColRef.current
      setTimeout(() => { el.style.transition = '' }, 200)
    }
    setSwipeReplyVisible(false)
    if (triggered) onReply({ id: msg.id, text: msg.text, type: msg.type })
  }, [isBot, msg.id, msg.text, msg.type, onReply])
  const hasButtons = (msg.buttons?.length ?? 0) > 0
  const hasText = !!msg.text?.trim()
  const imageAttachments = (msg.attachments ?? []).filter(
    (a) => a.type === 'image' && (a.localUrl ?? a.url),
  )
  // Photo/video/audio attachments render "stuck" to the bubble — full-bleed,
  // no border, sized to exactly match the bubble's own max width. Only
  // plain files keep the padded pill treatment, since a download link
  // isn't full-bleed media.
  const mediaAttachments = (msg.attachments ?? []).filter(
    (a) => (a.type === 'image' || a.type === 'video' || a.type === 'audio') && (a.localUrl ?? a.url),
  )
  const pillAttachments = (msg.attachments ?? []).filter((a) => !mediaAttachments.includes(a))
  const hasMedia = mediaAttachments.length > 0
  const hasPills = pillAttachments.length > 0
  // The timestamp overlay only works on visual media (image/video) since
  // they provide a canvas to sit on top of; audio has no such surface, so
  // when audio is the trailing item we fall back to a normal meta row.
  const lastMediaType = hasMedia ? mediaAttachments[mediaAttachments.length - 1].type : null
  const trailingIsVisual = lastMediaType === 'image' || lastMediaType === 'video'

  return (
    <div
      className={cn(
        'group relative flex w-full items-end gap-1 px-3 py-1',
        isBot ? 'justify-start' : 'justify-end',
      )}
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
      onTouchCancel={handleTouchEnd}
    >
      {/* Swipe-to-reply affordance — fades in behind the bubble as it's
          dragged, mirroring the Telegram/WhatsApp mobile gesture */}
      <div
        className={cn(
          'absolute inset-y-0 flex items-center pointer-events-none transition-opacity duration-150',
          isBot ? 'left-2' : 'right-2',
          swipeReplyVisible ? 'opacity-70' : 'opacity-0',
        )}
      >
        <div className="h-7 w-7 rounded-full bg-on-surface/10 flex items-center justify-center">
          <Reply className="h-3.5 w-3.5 text-on-surface-variant" />
        </div>
      </div>

      {/* Desktop hover reply button — appears when the cursor is over the
          message bubble, replacing the mobile swipe gesture with a direct
          click affordance. Sits on the side closest to the centre of the
          screen (right of bot bubbles, left of user bubbles) so it never
          crowds the viewport edge, and is hidden entirely below the `md`
          breakpoint since mobile uses the swipe-to-reply gesture instead. */}
      <button
        type="button"
        aria-label="Reply to this message"
        onClick={() => onReply({ id: msg.id, text: msg.text, type: msg.type })}
        className={cn(
          'hidden md:flex items-center justify-center h-7 w-7 rounded-full shrink-0 self-center',
          'text-on-surface-variant/50 hover:text-on-surface hover:bg-on-surface/10',
          'opacity-0 group-hover:opacity-100 focus-visible:opacity-100 transition-opacity duration-150',
          isBot ? 'order-last' : 'order-first',
        )}
      >
        <Reply className="h-3.5 w-3.5" />
      </button>

      {/* Bubble column — media bubbles get a *definite* width (not just a
          cap) so image/video/audio all render at exactly the bubble's max
          size, consistently, instead of shrink-wrapping to their own
          natural content size. Text-only bubbles keep the normal
          shrink-to-fit behavior. */}
      <div
        ref={bubbleColRef}
        className={cn(
          'flex flex-col relative max-w-[72%]',
          hasMedia && 'w-full',
          isBot ? 'items-start order-first' : 'items-end order-last',
        )}
        style={{ minWidth: 0 }}
      >
        {/* Bubble body — outer shell clips to rounded corners so flush media
            fuses seamlessly with no independent border/radius of its own */}
        <div
          className={cn(
            'flex flex-col overflow-hidden min-w-[52px]',
            hasMedia && 'w-full',
            isBot
              ? 'bg-[var(--bubble-bot)] text-[var(--bubble-bot-text)] rounded-2xl'
              : 'bg-[var(--bubble-user)] text-[var(--bubble-user-text)] rounded-2xl',
            'shadow-md',
          )}
        >
          {(hasText || hasPills || msg.replyTo) && (
            <div
              className="px-3.5 py-2.5"
              style={{ wordBreak: 'break-word', overflowWrap: 'break-word' }}
            >
              {msg.replyTo && (
                <ReplyQuote
                  messages={messages}
                  replyToId={msg.replyTo}
                  botNickname={botNickname}
                  displayName={displayName}
                  onClick={() => onQuoteClick(msg.replyTo!)}
                />
              )}

              {hasPills && (
                <div className={cn('flex flex-col gap-2', hasText && 'mb-2')}>
                  {pillAttachments.map((att, i) => (
                    <AttachmentView key={i} att={att} />
                  ))}
                </div>
              )}

              {hasText && (
                <div className="text-[13.5px] leading-relaxed">
                  <MarkdownText text={msg.text} style={msg.style} />
                </div>
              )}

              {/* Meta row — shown here whenever there's no trailing *visual*
                  media (image/video), since only those provide a canvas for
                  an overlaid timestamp; audio-last or media-less bubbles
                  show the timestamp in the normal flow instead. */}
              {(!hasMedia || !trailingIsVisual) && (
                <div className={cn('flex items-center gap-1 mt-1', isBot ? 'justify-start' : 'justify-end')}>
                  <span className="text-[10px] opacity-40 leading-none select-none tabular-nums">
                    {formatTime(msg.timestamp)}
                  </span>
                  {!isBot && <CheckCheck className="h-3 w-3 opacity-40 shrink-0" />}
                </div>
              )}
            </div>
          )}

          {/* Media — shown after text, flush against the bubble edges with
              no padding and no border of its own. The bubble column above
              is given a definite width whenever media is present, and
              every media item here fills that width exactly — so image,
              video, and audio are always rendered at the same size: the
              message bubble's max size. */}
          {hasMedia && (
            <div className="flex flex-col w-full">
              {mediaAttachments.map((att, i) => {
                const imgIndex = att.type === 'image' ? imageAttachments.indexOf(att) : -1
                const isLast = i === mediaAttachments.length - 1
                return (
                  <FlushMedia
                    key={i}
                    att={att}
                    onOpen={imgIndex >= 0 ? () => onImageOpen(imageAttachments, imgIndex) : undefined}
                    showMeta={isLast && att.type !== 'audio'}
                    isBot={isBot}
                    timestamp={msg.timestamp}
                    disableFullscreen={hasButtons}
                    onMediaLoad={onMediaLoad}
                  />
                )
              })}
            </div>
          )}
        </div>

        {/* Inline buttons below bubble */}
        {hasButtons && (
          <BotButtonRow
            buttons={msg.buttons!}
            messageId={msg.id}
            onButtonClick={onButtonClick}
          />
        )}
      </div>
    </div>
  )
})

// ── Three-dot Menu ────────────────────────────────────────────────────────────

/**
 * Chat header's right-side control — a bot avatar (with live status dot)
 * that opens the Chat Room settings panel. On desktop it matches the Bot
 * Manager header's account-menu trigger exactly: an avatar-plus-chevron
 * pill that rotates its indicator with the open/closed state. On mobile it
 * stays the compact icon-only circle (no pill padding, no chevron) so it
 * keeps parity with the hamburger button's footprint in the tight header.
 */
function ChatSettingsMenu({
  isConnected,
  onClearChat,
  onEditPrefix,
  onEditNickname,
}: {
  isConnected: boolean
  onClearChat: () => void
  onEditPrefix: () => void
  onEditNickname: () => void
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  return (
    <div ref={ref} className="relative shrink-0">
      <button
        type="button"
        aria-label="Chat Room settings"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((p) => !p)}
        className={cn(
          // Mobile: a bare 36px circle (matches the hamburger's shrunken
          // mobile IconButton footprint — see H_ICON_BTN_MOBILE). Desktop:
          // the same pill shape, padding, and hover treatment as the Bot
          // Manager header's UserMenu trigger, so the two read as one
          // consistent component.
          'relative flex items-center gap-1.5 rounded-full transition-colors duration-fast',
          'h-9 w-9 justify-center',
          'md:h-auto md:w-auto md:justify-start md:rounded-lg md:px-2 md:py-1.5',
          'hover:bg-on-surface/[var(--state-hover-opacity)]',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40',
          open && 'bg-on-surface/[var(--state-hover-opacity)]',
        )}
      >
        <span className="relative h-9 w-9 md:h-10 md:w-10 rounded-full bg-primary-container flex items-center justify-center ring-2 ring-primary/20 shrink-0">
          <Logo className="h-4 w-4 md:h-5 md:w-5 text-on-primary-container" />
          <span
            className={cn(
              'absolute bottom-0 right-0 h-2.5 w-2.5 md:h-3 md:w-3 rounded-full border-2 border-surface transition-colors duration-500',
              isConnected ? 'bg-emerald-400' : 'bg-on-surface-variant/30',
            )}
          />
        </span>
        {/* Dropdown indicator — desktop only, rotates with menu state,
            identical treatment to the Bot Manager UserMenu's chevron. */}
        <ChevronDown
          className={cn(
            H_CHEVRON,
            'hidden md:block text-on-surface-variant transition-transform duration-fast',
            open && 'rotate-180',
          )}
        />
      </button>

      {open && (
        <div
          role="menu"
          className="absolute right-0 top-full mt-2 z-[150] w-[248px] rounded-2xl border border-outline-variant/50 bg-surface-container shadow-elevation-3 overflow-hidden"
          style={{ animation: 'cr-fadeIn 140ms ease both' }}
        >
          <div className="px-4 pt-3.5 pb-2.5 border-b border-outline-variant/30">
            <p className="text-[11px] font-bold uppercase tracking-wider text-on-surface-variant/55">
              Chat Room Settings
            </p>
            <p className="text-[11px] mt-0.5">
              {isConnected ? (
                <span className="text-emerald-400/80 font-medium">Online</span>
              ) : (
                <span className="text-on-surface-variant/60">Connecting…</span>
              )}
            </p>
          </div>

          <div className="py-1.5">
            <DotsMenuItem
              icon={Tag}
              label="Edit Bot Nickname"
              onClick={() => { setOpen(false); onEditNickname() }}
            />
            <DotsMenuItem
              icon={Hash}
              label="Edit Prefix"
              onClick={() => { setOpen(false); onEditPrefix() }}
            />
          </div>

          <div className="h-px bg-outline-variant/30 mx-3" />

          <div className="py-1.5">
            <DotsMenuItem
              icon={Trash2}
              label="Clear Chat"
              danger
              onClick={() => { setOpen(false); onClearChat() }}
            />
          </div>
        </div>
      )}
    </div>
  )
}

/** Single row inside the Chat Room settings dropdown — icon in a soft
 *  rounded chip, label, consistent hover/active affordance. */
function DotsMenuItem({
  icon: Icon,
  label,
  onClick,
  danger,
}: {
  icon: typeof Tag
  label: string
  onClick: () => void
  danger?: boolean
}) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      className={cn(
        'w-full flex items-center gap-3 px-3.5 py-2.5 mx-1 rounded-xl text-sm font-medium transition-colors',
        'w-[calc(100%-8px)]',
        danger
          ? 'text-error hover:bg-error/10'
          : 'text-on-surface hover:bg-on-surface/8',
      )}
    >
      <span
        className={cn(
          'flex items-center justify-center h-7 w-7 rounded-lg shrink-0',
          danger ? 'bg-error/10' : 'bg-primary/10',
        )}
      >
        <Icon className={cn('h-3.5 w-3.5', danger ? 'text-error' : 'text-primary')} />
      </span>
      {label}
    </button>
  )
}

// ── Nickname Modal ─────────────────────────────────────────────────────────────

function NicknameModal({
  current,
  onSave,
  onClose,
}: {
  current: string
  onSave: (n: string) => void
  onClose: () => void
}) {
  const [value, setValue] = useState(current)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    inputRef.current?.focus()
    inputRef.current?.select()
  }, [])

  const handleSave = () => {
    const trimmed = value.trim().slice(0, 32) || DEFAULT_NICKNAME
    onSave(trimmed)
  }

  return (
    <div
      className="fixed inset-0 z-[200] flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div
        className="w-[360px] rounded-3xl bg-surface-container border border-outline-variant/50 shadow-elevation-3 p-6"
        style={{ animation: 'cr-fadeIn 160ms ease both' }}
      >
        <div className="flex items-center justify-between mb-1">
          <div>
            <h2 className="text-base font-bold text-on-surface leading-tight">Bot Nickname</h2>
            <p className="text-xs text-on-surface-variant mt-0.5 leading-relaxed">
              Give your bot a custom name. Say its name or use the prefix to trigger it.
            </p>
          </div>
          <button type="button" onClick={onClose} className="p-1.5 rounded-full text-on-surface-variant hover:bg-on-surface/10 transition-colors ml-3 shrink-0">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex items-center gap-2 bg-surface-container-high rounded-2xl border border-outline-variant/50 px-3 py-2.5 mb-5 mt-4 focus-within:ring-2 focus-within:ring-primary/40 focus-within:border-primary/50 transition-all">
          <Tag className="h-4 w-4 text-primary shrink-0" />
          <input
            ref={inputRef}
            type="text"
            value={value}
            maxLength={32}
            onChange={(e: ChangeEvent<HTMLInputElement>) => setValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleSave()
              if (e.key === 'Escape') onClose()
            }}
            placeholder="e.g. Cat-Bot, Aria, Nexus…"
            className="flex-1 bg-transparent text-on-surface text-sm placeholder:text-on-surface-variant/40 focus:outline-none"
          />
          {value && value !== current && (
            <span className="text-[10px] text-primary font-bold tracking-wide px-2 py-0.5 rounded-full bg-primary/10">NEW</span>
          )}
        </div>

        <div className="flex items-center gap-2 justify-end">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 rounded-xl text-sm font-medium text-on-surface-variant hover:bg-on-surface/10 transition-colors"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSave}
            className="px-5 py-2 rounded-xl text-sm font-bold bg-primary text-on-primary hover:opacity-90 active:scale-95 transition-all"
          >
            Save
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Prefix Modal ──────────────────────────────────────────────────────────────

function PrefixModal({
  current,
  onSave,
  onClose,
}: {
  current: string
  onSave: (p: string) => void
  onClose: () => void
}) {
  const [value, setValue] = useState(current)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    inputRef.current?.focus()
    inputRef.current?.select()
  }, [])

  const handleSave = () => {
    const trimmed = value.trim().slice(0, 10) || DEFAULT_PREFIX
    onSave(trimmed)
  }

  return (
    <div
      className="fixed inset-0 z-[200] flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div
        className="w-[340px] rounded-3xl bg-surface-container border border-outline-variant/50 shadow-elevation-3 p-6"
        style={{ animation: 'cr-fadeIn 160ms ease both' }}
      >
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-base font-bold text-on-surface leading-tight">Edit Command Prefix</h2>
            <p className="text-xs text-on-surface-variant mt-0.5">Commands starting with this symbol trigger the bot.</p>
          </div>
          <button type="button" onClick={onClose} className="p-1.5 rounded-full text-on-surface-variant hover:bg-on-surface/10 transition-colors">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex items-center gap-2 bg-surface-container-high rounded-2xl border border-outline-variant/50 px-3 py-2.5 mb-5 focus-within:ring-2 focus-within:ring-primary/40 focus-within:border-primary/50 transition-all">
          <Hash className="h-4 w-4 text-primary shrink-0" />
          <input
            ref={inputRef}
            type="text"
            value={value}
            maxLength={10}
            onChange={(e: ChangeEvent<HTMLInputElement>) => setValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleSave()
              if (e.key === 'Escape') onClose()
            }}
            placeholder="e.g. / or ! or +"
            className="flex-1 bg-transparent text-on-surface font-mono text-sm placeholder:text-on-surface-variant/40 focus:outline-none"
          />
          {value && value !== current && (
            <span className="text-[10px] text-primary font-bold tracking-wide px-2 py-0.5 rounded-full bg-primary/10">NEW</span>
          )}
        </div>

        <div className="flex items-center gap-2 justify-end">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 rounded-xl text-sm font-medium text-on-surface-variant hover:bg-on-surface/10 transition-colors"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSave}
            className="px-5 py-2 rounded-xl text-sm font-bold bg-primary text-on-primary hover:opacity-90 active:scale-95 transition-all"
          >
            Save
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Clear Confirm Modal ───────────────────────────────────────────────────────

function ClearModal({ onConfirm, onClose }: { onConfirm: () => void; onClose: () => void }) {
  return (
    <div
      className="fixed inset-0 z-[200] flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div
        className="w-[340px] rounded-3xl bg-surface-container border border-outline-variant/50 shadow-elevation-3 p-6"
        style={{ animation: 'cr-fadeIn 160ms ease both' }}
      >
        <div className="h-11 w-11 rounded-2xl bg-error/12 flex items-center justify-center mb-4">
          <Trash2 className="h-5 w-5 text-error" />
        </div>
        <h2 className="text-base font-bold text-on-surface mb-1">Clear Chat?</h2>
        <p className="text-sm text-on-surface-variant mb-6 leading-relaxed">
          All messages in this session will be permanently removed.
        </p>
        <div className="flex items-center gap-2 justify-end">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 rounded-xl text-sm font-medium text-on-surface-variant hover:bg-on-surface/10 transition-colors"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => { onConfirm(); onClose() }}
            className="px-5 py-2 rounded-xl text-sm font-bold bg-error text-on-error hover:opacity-90 active:scale-95 transition-all"
          >
            Clear Chat
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Get Started Screen ────────────────────────────────────────────────────────

function GetStartedScreen({
  onStart,
  prefix,
  botNickname,
}: {
  onStart: () => void
  prefix: string
  botNickname: string
}) {
  const features = [
    {
      icon: <Zap className="h-4 w-4 text-amber-400" />,
      bg: 'bg-amber-400/10 border-amber-400/20',
      title: 'Instant Commands',
      desc: `Type ${prefix}help to explore everything the bot can do.`,
    },
    {
      icon: <DollarSign className="h-4 w-4 text-sky-400" />,
      bg: 'bg-sky-400/10 border-sky-400/20',
      title: 'Economy & Games',
      desc: 'Earn coins, check balance, play slots — economy commands tied to your account.',
    },
    {
      icon: <MessageCircle className="h-4 w-4 text-emerald-400" />,
      bg: 'bg-emerald-400/10 border-emerald-400/20',
      title: 'Rich Responses',
      desc: 'Markdown, buttons, images, and files — all supported.',
    },
    {
      icon: <Shield className="h-4 w-4 text-violet-400" />,
      bg: 'bg-violet-400/10 border-violet-400/20',
      title: 'Persistent History',
      desc: 'Your messages are saved — pick up right where you left off.',
    },
  ]

  return (
    <div className="flex-1 flex flex-col items-center justify-center gap-8 px-6 py-10 min-h-0">
      {/* Hero avatar */}
      <div className="relative">
        <div className="h-[88px] w-[88px] rounded-[28px] bg-gradient-to-br from-primary/30 to-primary/10 flex items-center justify-center shadow-elevation-3 ring-1 ring-primary/20">
          <Logo className="h-12 w-12 text-primary" />
        </div>
        <div className="absolute -bottom-1.5 -right-1.5 h-6 w-6 rounded-full bg-emerald-400 border-[3px] border-[var(--chatroom-bg)] flex items-center justify-center">
          <Sparkles className="h-3 w-3 text-emerald-900" />
        </div>
      </div>

      {/* Headline */}
      <div className="text-center max-w-xs">
        <h1 className="text-2xl font-extrabold text-on-surface mb-2 leading-tight tracking-tight">
          Meet {botNickname}
        </h1>
        <p className="text-sm text-on-surface-variant leading-relaxed">
          Your personal AI assistant — right inside the dashboard. Send commands, get rich responses, and explore everything the bot can do.
        </p>
      </div>

      {/* Feature cards */}
      <div className="grid grid-cols-2 gap-3 w-full max-w-sm">
        {features.map((f, i) => (
          <div
            key={i}
            className={cn(
              'rounded-2xl border p-3.5 flex flex-col gap-2',
              f.bg,
            )}
          >
            <div className="flex items-center gap-2">
              {f.icon}
              <span className="text-xs font-bold text-on-surface leading-tight">{f.title}</span>
            </div>
            <p className="text-[11px] text-on-surface-variant leading-relaxed">{f.desc}</p>
          </div>
        ))}
      </div>

      {/* CTA */}
      <div className="flex flex-col items-center gap-3">
        <button
          type="button"
          onClick={onStart}
          className="flex items-center gap-2 px-8 py-3 rounded-2xl bg-primary text-on-primary font-bold text-sm hover:opacity-90 active:scale-95 transition-all shadow-elevation-2"
        >
          <Sparkles className="h-4 w-4" />
          Get Started
        </button>
        <p className="text-[11px] text-on-surface-variant/50 select-none">
          Press <kbd className="font-mono bg-on-surface/8 px-1.5 py-0.5 rounded text-[10px]">Enter</kbd> to send &middot; <kbd className="font-mono bg-on-surface/8 px-1.5 py-0.5 rounded text-[10px]">Shift+Enter</kbd> for new line
        </p>
      </div>
    </div>
  )
}

// ── Attachment Picker ──────────────────────────────────────────────────────────
// Exposes Photo (any image MIME type) and File pickers for users — the bot can
// still send video/audio in outbound messages, just not as a pick-to-send option.
// Uses <label htmlFor> — works on all browsers including iOS Safari.

function AttachmentPicker({
  onSelect,
  onClose,
}: {
  onSelect: (files: ChatAttachment[]) => void
  onClose: () => void
}) {
  const handleFiles = (
    files: FileList | null,
    type: 'image' | 'file',
    inputEl: HTMLInputElement | null,
  ) => {
    if (!files || files.length === 0) return
    const attachments: ChatAttachment[] = Array.from(files).map((f) => {
      // Auto-detect by actual MIME type rather than trusting which picker entry
      // was used — this way ANY image type (jpg/png/gif/webp/heic/svg/avif/bmp…)
      // still renders as a photo bubble even if it came through "File", a
      // drag-drop, or a paste, instead of falling back to a generic file pill.
      const isImage = type === 'image' || f.type.startsWith('image/')
      const isAudio = f.type.startsWith('audio/') ||
        AUDIO_EXTS.has(f.name.split('.').pop()?.toLowerCase() ?? '')
      const isVideo = f.type.startsWith('video/')
      const attType = isImage ? ('image' as const)
        : isAudio ? ('audio' as const)
        : isVideo ? ('video' as const)
        : type
      return {
        type: attType,
        name: f.name,
        localUrl: URL.createObjectURL(f),
        file: f,
        ...(f.type ? { mime: f.type } : {}),
      }
    })
    onSelect(attachments)
    // Reset input so the same file can be re-selected
    if (inputEl) inputEl.value = ''
    onClose()
  }

  const options: {
    id: string
    label: string
    icon: React.ReactNode
    accept: string
    type: 'image' | 'file'
    multiple: boolean
  }[] = [
    {
      id: 'cr-pick-photo',
      label: 'Photo',
      icon: <ImageIcon className="h-4 w-4" />,
      // Accept every image MIME subtype the browser/OS picker knows about —
      // not a hardcoded list of extensions — so any image format is selectable.
      accept: 'image/*',
      type: 'image',
      multiple: true,
    },
    {
      id: 'cr-pick-file',
      label: 'File',
      icon: <FileText className="h-4 w-4" />,
      accept: '*/*',
      type: 'file',
      multiple: true,
    },
  ]

  return (
    <div
      className="absolute bottom-full mb-2 left-0 z-[120]"
      style={{ animation: 'cr-fadeIn 110ms ease both' }}
    >
      <div className="rounded-2xl border border-outline-variant/50 bg-surface-container shadow-elevation-3 p-1.5 flex flex-col min-w-[140px]">
        {options.map((opt) => (
          <label
            key={opt.id}
            htmlFor={opt.id}
            className="flex items-center gap-3 px-3.5 py-2.5 rounded-xl text-sm text-on-surface hover:bg-on-surface/8 transition-colors cursor-pointer"
          >
            <span className="text-on-surface-variant">{opt.icon}</span>
            {opt.label}
            <input
              id={opt.id}
              type="file"
              accept={opt.accept}
              multiple={opt.multiple}
              className="sr-only"
              onClick={(e) => {
                // Reset value so selecting the same file fires onChange again
                ;(e.target as HTMLInputElement).value = ''
              }}
              onChange={(e) => handleFiles(e.target.files, opt.type, e.target)}
            />
          </label>
        ))}
      </div>
    </div>
  )
}

// ── Reply Preview Strip ────────────────────────────────────────────────────────

function ReplyPreviewBar({
  target,
  onDismiss,
  botNickname,
  displayName,
}: {
  target: ReplyTarget
  onDismiss: () => void
  botNickname: string
  displayName: string
}) {
  return (
    <div className="flex items-center gap-2 mb-2 px-3 py-2 rounded-xl bg-surface-container-high border border-outline-variant/20">
      <div className="w-0.5 h-9 rounded-full bg-primary shrink-0" />
      <div className="flex-1 min-w-0">
        <p className="text-[10px] font-bold text-primary uppercase tracking-widest">
          {target.type === 'bot' ? botNickname : displayName}
        </p>
        <p className="text-xs text-on-surface-variant truncate leading-snug">
          {target.text.slice(0, 80) || '📎 Attachment'}
        </p>
      </div>
      <button
        type="button"
        onClick={onDismiss}
        aria-label="Cancel reply"
        className="p-1.5 rounded-full text-on-surface-variant hover:text-on-surface hover:bg-on-surface/10 transition-colors shrink-0"
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  )
}

// ── Empty Chat State ───────────────────────────────────────────────────────────

function EmptyChatState({ prefix, botNickname }: { prefix: string; botNickname: string }) {
  return (
    <div className="flex-1 flex flex-col items-center justify-center gap-3 py-16 px-6 text-center">
      <div className="h-14 w-14 rounded-full bg-primary/10 flex items-center justify-center">
        <Logo className="h-8 w-8 text-primary/60" />
      </div>
      <div>
        <p className="text-sm font-semibold text-on-surface mb-1">Start chatting with {botNickname}</p>
        <p className="text-xs text-on-surface-variant">
          Type <code className="font-mono text-primary">{prefix}help</code> to see all commands, or say its name to trigger the bot.
        </p>
      </div>
    </div>
  )
}

// ── Composer ──────────────────────────────────────────────────────────────────

// Single-line textarea content height, in px, at the composer's base font
// size/line-height/padding — anything taller means the text has wrapped.
const SINGLE_LINE_THRESHOLD = 46

interface ComposerProps {
  prefix: string
  botNickname: string
  isConnected: boolean
  isMobileViewport: boolean
  pendingAttachments: ChatAttachment[]
  onRemoveAttachment: (index: number) => void
  showAttachPicker: boolean
  onToggleAttachPicker: () => void
  onSelectAttachments: (files: ChatAttachment[]) => void
  onCloseAttachPicker: () => void
  onSend: (text: string) => void
  inputRef: RefObject<HTMLTextAreaElement | null>
}

/**
 * Owns the composer's text input entirely on its own — inputText, the
 * wrapped/single-line layout flag, and the textarea's auto-resize all live
 * as LOCAL state here instead of on the page component. That means typing a
 * message only ever re-renders this small subtree, never the message list,
 * header, or anything else on the page — the biggest lever for keeping the
 * composer smooth once the chat history gets long.
 *
 * The auto-resize itself is batched into a single requestAnimationFrame per
 * keystroke, so a burst of fast typing can never trigger more than one
 * forced-layout read/write pair per frame.
 */
const Composer = memo(function Composer({
  prefix,
  botNickname,
  isConnected,
  isMobileViewport,
  pendingAttachments,
  onRemoveAttachment,
  showAttachPicker,
  onToggleAttachPicker,
  onSelectAttachments,
  onCloseAttachPicker,
  onSend,
  inputRef,
}: ComposerProps) {
  const [inputText, setInputText] = useState('')
  const [isComposerMultiline, setIsComposerMultiline] = useState(false)
  // Hidden mirror element used purely to detect wrapping — see the
  // "Hidden mirror row" block in the JSX below for why this exists.
  const mirrorRef = useRef<HTMLDivElement>(null)
  // Caret position to restore after a programmatic (paste) text change —
  // a controlled textarea doesn't keep the caret in the right spot on its
  // own once we've bypassed the browser's native paste insertion.
  const pendingCaretRef = useRef<number | null>(null)

  // Autofocus once — this component only mounts the moment "Get Started" is
  // clicked (hasStarted flips true), so a mount-time focus replaces the old
  // manual setTimeout-from-the-page-component approach.
  useEffect(() => {
    const t = setTimeout(() => inputRef.current?.focus(), 50)
    return () => clearTimeout(t)
  }, [])

  // Single source of truth for both the visible textarea's height and the
  // wrap-mode flag, driven off inputText itself rather than off individual
  // DOM events. This covers typing, paste, and the programmatic clear on
  // send with one code path instead of three separately-maintained ones —
  // whatever changed inputText, the box always ends up correctly sized.
  // useLayoutEffect (not useEffect) so this resolves before the browser
  // paints, same as the old rAF approach, but without needing to manually
  // batch/cancel frames since React already coalesces the underlying state
  // updates into a single commit per keystroke.
  useLayoutEffect(() => {
    const el = inputRef.current
    if (!el) return

    // Wrap mode: measured off the HIDDEN MIRROR — a fixed-width,
    // off-screen twin of the single-line row that never changes size, so
    // this can never be affected by which layout mode is currently on
    // screen. (Measuring off the visible textarea instead is what caused
    // the earlier "reverts to single line" flicker: switching modes
    // changed its width, which changed the very thing being measured.)
    // This is decided BEFORE the height read below, since the height
    // read depends on it — see the comment there.
    if (!inputText) {
      setIsComposerMultiline(false)
      if (mirrorRef.current) mirrorRef.current.textContent = ''
      // Emptied out (backspaced to nothing, cleared on send, etc.) —
      // snap scrollTop back to 0 too. Without this the box can be left
      // internally "scrolled" from before, which is invisible since the
      // scrollbar is CSS-hidden but leaves the caret sitting in the
      // wrong spot until the user types again.
      el.scrollTop = 0
    } else if (mirrorRef.current) {
      // Trailing newline needs a trailing space or the mirror collapses
      // the empty final line — same trick textarea-autosize libraries use.
      mirrorRef.current.textContent = inputText.endsWith('\n') ? inputText + ' ' : inputText
      setIsComposerMultiline(mirrorRef.current.scrollHeight > SINGLE_LINE_THRESHOLD)
    }

    // Height: measured off the VISIBLE textarea, at whatever width it
    // currently has. That width is a function of isComposerMultiline —
    // single-line mode shares the row with the attach/send buttons
    // (narrower), wrapped mode goes full-width (wider). Pasting a long
    // block in one shot can flip that mode in the very same update, but
    // the DOM hasn't re-rendered at the new width yet when this line
    // runs — el is still at its PREVIOUS width. Reading scrollHeight now
    // would lock in a height measured at the wrong width and, since
    // nothing depends on isComposerMultiline to trigger a re-measure,
    // it would never correct itself — exactly the leftover "extra
    // space" bug seen after a one-shot paste that changes modes.
    // Including isComposerMultiline in this effect's own dependency
    // array is what fixes it: when the setIsComposerMultiline call
    // above actually changes the value, React re-runs this effect
    // again before paint, and this second pass reads scrollHeight at
    // the now-correct, post-mode-change width. When the mode doesn't
    // change (the common case — typing, or a paste that doesn't cross
    // the wrap threshold), the effect runs exactly once as before.
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`

    // Restore caret after a paste-driven update (see handlePaste) — a
    // controlled textarea's value updates, but the browser doesn't know
    // where the caret should land since we bypassed its native insertion.
    if (pendingCaretRef.current !== null) {
      el.selectionStart = el.selectionEnd = pendingCaretRef.current
      pendingCaretRef.current = null
    }
  }, [inputText, inputRef, isComposerMultiline])

  const handleInputChange = useCallback((e: ChangeEvent<HTMLTextAreaElement>) => {
    setInputText(e.target.value)
  }, [])

  // Clipboard sources very often carry formatting artifacts that have
  // nothing to do with the message itself but still show up as visible
  // "extra space" once dropped into a whitespace:pre-wrap textarea:
  //  - a trailing newline (copying a full line from an editor, a chat
  //    bubble, a spreadsheet cell, etc.) — invisible as text, but it still
  //    counts toward scrollHeight, so it shows up as unexplained empty
  //    space at the bottom of the box.
  //  - trailing spaces/tabs on individual lines (common when pasting from
  //    PDFs or word processors) — pre-wrap preserves them, which can push
  //    a line's wrap point out further than the visible text alone would.
  //  - large paragraph gaps (3+ blank lines in a row) — common when
  //    copying from web pages/documents — which read as an oversized
  //    blank gap in the composer.
  //  - leading whitespace on the very first line, which lands as a stray
  //    indent before the message even starts.
  // This is a single regex pass, so it stays cheap even for a very long
  // paste dropped in all at once. Interior newlines (deliberate paragraph
  // breaks in the pasted text) are otherwise left untouched.
  const sanitizePastedText = (raw: string, atStart: boolean): string => {
    let text = raw
      .replace(/\r\n?/g, '\n') // normalize CRLF/CR to LF
      .replace(/[ \t]+$/gm, '') // trim trailing spaces/tabs on every line
      .replace(/\n{3,}/g, '\n\n') // collapse 3+ blank lines to a single blank line
      .replace(/[\n ]+$/, '') // strip trailing blank lines/spaces overall

    // Only strip leading blank lines/spaces when pasting at the very start
    // of the box — mid-text pastes keep whatever whitespace separates the
    // pasted chunk from what's already there.
    if (atStart) text = text.replace(/^[\n ]+/, '')

    return text
  }

  const handlePaste = useCallback(
    (e: ReactClipboardEvent<HTMLTextAreaElement>) => {
      const text = e.clipboardData?.getData('text')
      if (text == null) return // non-text paste (e.g. an image) — let default handling run
      e.preventDefault()

      const el = e.currentTarget
      const start = el.selectionStart ?? inputText.length
      const end = el.selectionEnd ?? inputText.length
      const cleaned = sanitizePastedText(text, start === 0)

      pendingCaretRef.current = start + cleaned.length
      setInputText(inputText.slice(0, start) + cleaned + inputText.slice(end))
    },
    [inputText],
  )

  const handleSend = useCallback(() => {
    const trimmed = inputText.trim()
    if (!isConnected || (!trimmed && pendingAttachments.length === 0)) return
    onSend(trimmed)
    setInputText('')
    inputRef.current?.focus()
  }, [inputText, isConnected, pendingAttachments.length, onSend, inputRef])

  const handleKeyDown = useCallback(
    (e: ReactKeyboardEvent<HTMLTextAreaElement>) => {
      // Mobile: Enter/Next always inserts a newline (the textarea's native
      // behaviour) — sending is exclusively the dedicated Send button's job.
      if (isMobileViewport) return
      // Desktop: standard chat-app behaviour — Enter sends, Shift+Enter
      // inserts a newline.
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault()
        handleSend()
      }
    },
    [isMobileViewport, handleSend],
  )

  const canSend = isConnected && (!!inputText.trim() || pendingAttachments.length > 0)

  return (
    <>
      {/* ChatGPT-style rounded composer — the message bar itself. Filled
          with the same translucent surface + blur as the page header
          (bg-surface/90 backdrop-blur-xl) so the two bars read as one
          consistent tone, top and bottom. */}
      <div
        className={cn(
          'relative rounded-[28px] transition-all shadow-[0_1px_6px_rgba(0,0,0,0.16)]',
          'bg-surface/90 backdrop-blur-xl ring-[1.5px] ring-inset ring-[var(--input-border)]',
          'focus-within:ring-[var(--input-border-focus)] focus-within:shadow-[0_0_0_3px_var(--input-ring),0_1px_6px_rgba(0,0,0,0.16)]',
        )}
      >
        {/* Pending attachments row — images shown in the message bar */}
        {pendingAttachments.length > 0 && (
          <div className="flex flex-wrap gap-2 px-4 pt-3 pb-1">
            {pendingAttachments.map((att, i) => (
              <div key={i} className="relative group/att">
                {att.type === 'image' && att.localUrl ? (
                  <img
                    src={att.localUrl}
                    alt={att.name}
                    className="h-16 w-16 rounded-xl object-cover border border-white/10 shadow-sm"
                  />
                ) : (
                  <div className="h-16 w-16 rounded-xl bg-white/5 border border-white/10 flex flex-col items-center justify-center gap-1 p-1">
                    {<FileText className="h-4 w-4 text-on-surface-variant" />}
                    <span className="text-[8px] text-on-surface-variant truncate w-full text-center px-1">{att.name}</span>
                  </div>
                )}
                <button
                  type="button"
                  onClick={() => onRemoveAttachment(i)}
                  aria-label="Remove attachment"
                  className="absolute -top-1.5 -right-1.5 h-5 w-5 rounded-full bg-surface-container border border-outline-variant/50 flex items-center justify-center text-on-surface-variant hover:text-error transition-colors opacity-0 group-hover/att:opacity-100 shadow-sm"
                >
                  <X className="h-3 w-3" />
                </button>
              </div>
            ))}
          </div>
        )}

        {/* Hidden mirror row — exists purely to measure whether the
            current text would wrap within the single-line row's text
            column. It uses the EXACT same attach/text/send widths and
            gaps as the real single-line row below, so its measured
            width always matches the real one — without hardcoding any
            pixel math — but it's absolutely positioned, invisible, and
            never interacted with, so nothing about switching modes can
            ever change what it measures. That's what breaks the
            feedback loop that caused the earlier "reverts to single
            line" bug: mode is now decided entirely by the text itself,
            never by the visible textarea's current layout. */}
        <div
          aria-hidden="true"
          className="absolute inset-x-0 top-0 flex gap-2 px-2 py-1.5 opacity-0 pointer-events-none -z-10"
        >
          <div className="h-10 w-10 shrink-0" />
          <div
            ref={mirrorRef}
            className="min-w-0 flex-1 p-1 text-[16px] md:text-[15px] leading-relaxed whitespace-pre-wrap break-words"
          />
          <div className="h-10 w-10 shrink-0" />
        </div>

        {/* Attach · text · send — three permanent siblings whose only
            the CSS arrangement (never their mount identity) changes
            between states, so the textarea never remounts and never
            loses focus/cursor position mid-type.
            - Single line: one row, DOM order = attach → text → send.
            - Wrapped (2+ lines): text is forced onto its own full-
              width line (`basis-full`), which pushes attach/send onto
              a second flex line together; `justify-between` then
              pins attach to that line's left edge and send to its
              right edge — matching the reference composer exactly.
            isComposerMultiline itself comes from the hidden mirror
            above, never from this textarea's own scrollHeight, so
            widening the textarea here can't loop back into the
            decision that widened it. */}
        <div
          className={cn(
            'flex flex-wrap items-center',
            isComposerMultiline
              ? 'justify-between gap-x-2 gap-y-1.5 px-3 pt-3 pb-1.5'
              : 'gap-2 px-2 py-1.5',
          )}
        >
          {/* Attachment button */}
          <div
            id="attach-picker-root"
            className={cn('relative shrink-0', isComposerMultiline && 'order-2')}
          >
            <button
              type="button"
              aria-label="Attach file"
              aria-expanded={showAttachPicker}
              onClick={onToggleAttachPicker}
              className={cn(
                'flex items-center justify-center h-10 w-10 rounded-full transition-colors',
                showAttachPicker
                  ? 'bg-primary/15 text-primary'
                  : 'text-on-surface-variant/60 hover:text-on-surface-variant hover:bg-on-surface/8',
              )}
            >
              <Plus className="h-5 w-5" />
            </button>
            {showAttachPicker && (
              <AttachmentPicker onSelect={onSelectAttachments} onClose={onCloseAttachPicker} />
            )}
          </div>

          {/* Auto-resizing textarea */}
          <textarea
            ref={inputRef}
            value={inputText}
            onChange={handleInputChange}
            onKeyDown={handleKeyDown}
            onPaste={handlePaste}
            // Tells mobile virtual keyboards to render a "return"
            // (newline) key instead of "Next"/"Go"/"Send", matching
            // the actual behaviour: Enter always inserts a line
            // break here, never submits.
            enterKeyHint="enter"
            placeholder={isConnected ? `Message ${botNickname} or use ${prefix}help` : 'Connecting…'}
            rows={1}
            disabled={!isConnected}
            className={cn(
              // 16px minimum on mobile — anything smaller makes iOS
              // Safari auto-zoom the whole page in when the field is
              // focused, which is exactly the "page keeps resizing
              // itself" instability on mobile. Desktop keeps the
              // original 15px.
              'cr-input-scroll min-w-0 p-1 bg-transparent text-[16px] md:text-[15px] text-on-surface leading-relaxed',
              'placeholder:text-on-surface-variant/40 focus:outline-none resize-none overflow-y-auto',
              !isConnected && 'opacity-40 cursor-not-allowed',
              isComposerMultiline ? 'order-1 basis-full w-full' : 'flex-1',
            )}
            style={{ minHeight: '40px', maxHeight: '200px' }}
          />

          {/* Send button */}
          <button
            type="button"
            aria-label="Send message"
            onClick={handleSend}
            disabled={!canSend}
            className={cn(
              // Same plain, unmarked footprint as the attach (+)
              // button — and when active, the exact same soft
              // highlight treatment it uses (bg-primary/15 +
              // text-primary), so both controls read as one
              // consistent visual language.
              'flex items-center justify-center h-10 w-10 rounded-full transition-colors shrink-0',
              isComposerMultiline && 'order-3',
              canSend
                ? 'bg-primary/15 text-primary active:scale-95'
                : 'text-on-surface-variant/30 cursor-not-allowed',
            )}
          >
            {/* The arrow is always visible; it only switches from a
                faint outline to the "full" active send icon once
                there's text (or an attachment) to send. */}
            <ArrowUp className="h-5 w-5" />
          </button>
        </div>
      </div>

      {/* Desktop-only composer hint — replaces the old keyboard-
          shortcut reminder (Enter/Shift+Enter behaviour is standard
          desktop chat convention and no longer needs a caption)
          with a pointer toward the AI feature instead: mentioning
          the bot's name in a message triggers an AI response. */}
      <p className="hidden sm:block text-center text-[10px] text-on-surface-variant/30 mt-1.5 select-none">
        Type {botNickname} to trigger an AI response
      </p>
    </>
  )
})

// ── Main Page ─────────────────────────────────────────────────────────────────

// Hoisted out of the component so this large, fully-static string is
// allocated once at module load instead of being rebuilt on every render
// (e.g. on every keystroke in the composer).
const CR_STYLES = `
        :root {
          --chatroom-bg: #0d0f12;
          --chatroom-header: #111318;
          --bubble-bot: #1e2330;
          --bubble-bot-text: #e2e8f0;
          --bubble-user: #7c3200;
          --bubble-user-text: #fff7ed;
          --input-bg: #161a22;
          --input-border: rgba(255,255,255,0.1);
          --input-border-focus: rgba(255,130,40,0.45);
          --input-ring: rgba(255,130,40,0.12);
        }


        @keyframes cr-fadeIn {
          from { opacity: 0; transform: translateY(-6px) scale(0.97); }
          to   { opacity: 1; transform: translateY(0) scale(1); }
        }

        @keyframes cr-fadeInFast {
          from { opacity: 0; transform: translateY(4px) scale(0.9); }
          to   { opacity: 1; transform: translateY(0) scale(1); }
        }
        .cr-fadein-fast { animation: cr-fadeInFast 0.12s ease-out; }

        /* ── Jump-to-message highlight (quote tap / swipe) ─────────────────── */
        .cr-highlight-flash { background-color: rgba(255,130,40,0.16); }

        /* ── Auto-hiding scroll bar — thumb only appears while actively
               scrolling, then fades out, instead of sitting on screen
               permanently. Applied to the message list scroll container. */
        .cr-scroll {
          scrollbar-width: thin;
          scrollbar-color: transparent transparent;
        }
        .cr-scroll.is-scrolling {
          scrollbar-color: rgba(255,255,255,0.22) transparent;
        }
        .cr-scroll::-webkit-scrollbar { width: 6px; }
        .cr-scroll::-webkit-scrollbar-track { background: transparent; }
        .cr-scroll::-webkit-scrollbar-thumb {
          background: transparent;
          border-radius: 999px;
          transition: background-color 200ms ease;
        }
        .cr-scroll.is-scrolling::-webkit-scrollbar-thumb {
          background: rgba(255,255,255,0.22);
        }

        /* ── Composer wrapper — safe-area-aware bottom padding ─────────────
               Adds the iOS/Android home-indicator inset on top of the
               normal padding instead of the input bar sitting flush under
               it, and keeps the same visual spacing on devices/browsers
               that don't report a safe-area inset (env(...) falls back to
               0px there, leaving the base value untouched). */
        .cr-input-safe-pb {
          padding-bottom: calc(0.5rem + env(safe-area-inset-bottom, 0px));
        }
        @media (min-width: 768px) {
          .cr-input-safe-pb {
            padding-bottom: calc(1rem + env(safe-area-inset-bottom, 0px));
          }
        }

        /* ── Composer textarea — scrollbar fully hidden ────────────────────
               The input still scrolls internally once its content exceeds
               max-height (200px), but no scrollbar track/thumb is ever
               rendered, on mobile or desktop. */
        .cr-input-scroll {
          scrollbar-width: none;
          -ms-overflow-style: none;
        }
        .cr-input-scroll::-webkit-scrollbar { display: none; width: 0; height: 0; }

        /* ── Audio player: seek bar ─────────────────────────────────────── */
        .cr-audio-range {
          -webkit-appearance: none;
          appearance: none;
          background: transparent;
          height: 12px;
        }
        .cr-audio-range::-webkit-slider-runnable-track { background: transparent; height: 12px; }
        .cr-audio-range::-moz-range-track { background: transparent; height: 12px; }
        .cr-audio-range::-webkit-slider-thumb {
          -webkit-appearance: none;
          appearance: none;
          width: 12px;
          height: 12px;
          border-radius: 50%;
          background: transparent;
          cursor: pointer;
        }
        .cr-audio-range::-moz-range-thumb {
          width: 12px;
          height: 12px;
          border: none;
          border-radius: 50%;
          background: transparent;
          cursor: pointer;
        }

        .cr-audio-player audio { display: none; }

        /* Markdown styles */
        .chatmd strong { font-weight: 700; }
        .chatmd em { font-style: italic; }
        .chatmd del { text-decoration: line-through; opacity: 0.65; }
        .chatmd u { text-decoration: underline; }

        .chatmd-code {
          font-family: 'Fira Mono', 'Consolas', 'Monaco', monospace;
          font-size: 0.8em;
          padding: 0.1em 0.38em;
          border-radius: 5px;
          background: rgba(255 255 255 / 0.1);
          border: 1px solid rgba(255 255 255 / 0.08);
        }
        .chatmd-pre {
          margin: 6px 0;
          border-radius: 10px;
          background: rgba(0 0 0 / 0.35);
          border: 1px solid rgba(255 255 255 / 0.07);
          padding: 10px 14px;
          overflow-x: auto;
        }
        .chatmd-pre-wrap { position: relative; display: block; }
        .chatmd-pre-wrap .chatmd-pre { padding-right: 56px; }
        .chatmd-pre-lang {
          position: absolute;
          top: 8px;
          left: 14px;
          font-size: 9px;
          font-weight: 700;
          letter-spacing: 0.06em;
          text-transform: uppercase;
          color: rgba(255,255,255,0.32);
          user-select: none;
          pointer-events: none;
        }
        .chatmd-pre-wrap:has(.chatmd-pre-lang) .chatmd-pre { padding-top: 22px; }
        /* Syntax token colors — VS Code "Dark+" palette */
        .tok-keyword  { color: #569cd6; }
        .tok-string   { color: #ce9178; }
        .tok-comment  { color: #6a9955; font-style: italic; }
        .tok-number   { color: #b5cea8; }
        .tok-function { color: #dcdcaa; }
        .tok-type     { color: #4ec9b0; }
        .tok-property { color: #9cdcfe; }
        .tok-tag      { color: #569cd6; }
        .tok-attr     { color: #9cdcfe; }
        .tok-punct    { color: rgba(255,255,255,0.75); }
        .chatmd-copy-btn {
          position: absolute;
          top: 12px;
          right: 8px;
          font-size: 10px;
          font-weight: 600;
          line-height: 1;
          padding: 4px 8px;
          border-radius: 6px;
          background: rgba(255,255,255,0.08);
          border: 1px solid rgba(255,255,255,0.14);
          color: rgba(255,255,255,0.55);
          opacity: 0.7;
          transition: opacity 150ms ease, background-color 150ms ease, color 150ms ease;
          cursor: pointer;
        }
        .chatmd-pre-wrap:hover .chatmd-copy-btn,
        .chatmd-copy-btn:focus-visible {
          opacity: 1;
        }
        .chatmd-copy-btn:hover {
          background: rgba(255,255,255,0.18);
          color: rgba(255,255,255,0.95);
        }
        .chatmd-copy-btn:disabled { cursor: default; color: #4ade80; }
        .chatmd-code-block {
          font-family: 'Fira Mono', 'Consolas', 'Monaco', monospace;
          font-size: 0.78em;
          white-space: pre-wrap;
          word-break: break-all;
          display: block;
        }
        .chatmd-link {
          color: #79c0ff;
          text-decoration: underline;
          text-underline-offset: 2px;
          word-break: break-all;
          overflow-wrap: anywhere;
        }
        .chatmd-link:hover { color: #a5d6ff; }
        .chatmd-link:visited { color: #b39ddb; }
        .chatmd-h1 { display: block; font-size: 1.12em; font-weight: 800; margin: 5px 0 2px; }
        .chatmd-h2 { display: block; font-size: 1.06em; font-weight: 700; margin: 4px 0 1px; }
        .chatmd-h3 { display: block; font-size: 1em; font-weight: 600; margin: 3px 0 1px; }
        .chatmd-hr { border: none; border-top: 1px solid rgba(255 255 255 / 0.12); margin: 7px 0; }
        .chatmd-li { display: block; padding-left: 4px; margin: 1px 0; }
        .chatmd-oli { display: block; padding-left: 4px; margin: 1px 0; }
        .chatmd-quote {
          display: block;
          border-left: 2px solid rgba(255 255 255 / 0.25);
          padding-left: 8px;
          margin: 2px 0;
          opacity: 0.78;
          font-style: italic;
        }
`

export default function ChatRoomPage() {
  const { user } = useUserAuth()
  const { mobileOpen, toggle: toggleMobileSidebar } = useDashboardSidebar()

  // Derive stable identity from the logged-in account. userId is the account's
  // REAL id (Better Auth user.id) — this is what economy commands, button
  // ownership scoping, and per-session command toggles are keyed off server-side,
  // so it must stay the same value across reconnects/tabs for the same login.
  const userId = user?.id ?? 'web-user'
  const displayName = user?.name ?? 'You'
  // Username handle is extracted from the account's full name, e.g.
  // "Ken Iwato" -> "keniwato", per platform convention.
  const username = deriveUsername(displayName)
  const avatarUrl = user?.image ?? ''

  const [messages, setMessages] = useState<ChatMessage[]>(() => loadMessagesFromStorage())
  const [prefix, setPrefix] = useState<string>(
    () => localStorage.getItem(PREFIX_KEY) ?? DEFAULT_PREFIX,
  )
  const [botNickname, setBotNickname] = useState<string>(
    () => localStorage.getItem(NICKNAME_KEY) ?? DEFAULT_NICKNAME,
  )
  const [sessionId] = useState<string>(getOrCreateSessionId)
  const [hasStarted, setHasStarted] = useState<boolean>(
    () => localStorage.getItem(GET_STARTED_KEY) === 'true',
  )
  const [showPrefixModal, setShowPrefixModal] = useState(false)
  const [showClearModal, setShowClearModal] = useState(false)
  const [showNicknameModal, setShowNicknameModal] = useState(false)
  const [showAttachPicker, setShowAttachPicker] = useState(false)
  const [replyTarget, setReplyTarget] = useState<ReplyTarget | null>(null)
  const [pendingAttachments, setPendingAttachments] = useState<ChatAttachment[]>([])
  const [isConnected, setIsConnected] = useState(false)
  const [showScrollBtn, setShowScrollBtn] = useState(false)
  const [lightbox, setLightbox] = useState<{ images: ChatAttachment[]; index: number } | null>(null)
  // Drives the Enter-key behaviour split below: on mobile, Enter/Next must
  // only insert a newline (sending is Send-button-only); on desktop, Enter
  // sends and Shift+Enter inserts a newline. Tracks the same `md` (768px)
  // breakpoint the rest of this page's mobile/desktop split already uses.
  const [isMobileViewport, setIsMobileViewport] = useState<boolean>(() =>
    typeof window !== 'undefined' ? window.matchMedia('(max-width: 767px)').matches : false,
  )

  useEffect(() => {
    const mq = window.matchMedia('(max-width: 767px)')
    const handleChange = (e: MediaQueryListEvent) => setIsMobileViewport(e.matches)
    setIsMobileViewport(mq.matches)
    mq.addEventListener('change', handleChange)
    return () => mq.removeEventListener('change', handleChange)
  }, [])
  // True from the moment the user sends a message until the bot's reply
  // (or an edit/delete/error/disconnect) arrives — drives the "typing" bubble.
  const [awaitingReply, setAwaitingReply] = useState(false)

  const handleImageOpen = useCallback((images: ChatAttachment[], index: number) => {
    setLightbox({ images, index })
  }, [])

  const messagesEndRef = useRef<HTMLDivElement>(null)
  const scrollAreaRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const hasLoadedHistoryRef = useRef(false)
  const prefixRef = useRef(prefix)
  prefixRef.current = prefix
  const nicknameRef = useRef(botNickname)
  nicknameRef.current = botNickname
  const userIdRef = useRef(userId)
  userIdRef.current = userId
  const displayNameRef = useRef(displayName)
  displayNameRef.current = displayName
  const usernameRef = useRef(username)
  usernameRef.current = username
  const avatarUrlRef = useRef(avatarUrl)
  avatarUrlRef.current = avatarUrl
  // Bot messages (with their buttons) only — sent back to the server on join
  // so a cold session (post-restart) can rehydrate session.messages with the
  // same IDs the client already has, instead of leaving it empty. Without this,
  // clicking a button on a message from before the restart targets an ID the
  // server has never seen, so editMessage() can't find it and falls back to
  // sending a brand-new message instead of editing the existing one.
  const messagesRef = useRef(messages)
  messagesRef.current = messages

  const socket = getSocket()

  // ── Persist messages (debounced — avoids thrashing localStorage on fast
  //    bot streams where dozens of edits arrive in quick succession) ──────────

  const storageTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => {
    if (storageTimerRef.current) clearTimeout(storageTimerRef.current)
    storageTimerRef.current = setTimeout(() => {
      saveMessagesToStorage(messages)
    }, 300)
    return () => {
      if (storageTimerRef.current) clearTimeout(storageTimerRef.current)
    }
  }, [messages])

  // ── Socket events ───────────────────────────────────────────────────────────

  useEffect(() => {
    if (!socket.connected) socket.connect()

    const onConnect = () => {
      setIsConnected(true)
      socket.emit('chatroom:join', { sessionId, prefix: prefixRef.current, botNickname: nicknameRef.current, userId: userIdRef.current, userName: displayNameRef.current, username: usernameRef.current, avatarUrl: avatarUrlRef.current, messages: messagesRef.current })
    }
    const onDisconnect = () => {
      setIsConnected(false)
      setAwaitingReply(false)
    }

    const onHistory = (data: { messages: ChatMessage[]; prefix: string }) => {
      // Merge server history with local — server is the source of truth for new msgs
      // but we keep local messages if server returns empty (e.g. server restart)
      if (data.messages.length > 0) {
        setMessages(data.messages)
      }
      if (data.prefix) {
        setPrefix(data.prefix)
        localStorage.setItem(PREFIX_KEY, data.prefix)
      }
    }

    const onBotMessage = (msg: ChatMessage) => {
      setAwaitingReply(false)
      setMessages((prev) => (prev.some((m) => m.id === msg.id) ? prev : [...prev, msg]))
    }

    const onBotEdit = (data: {
      id: string
      text: string
      style?: string
      buttons?: BotButton[][]
      attachments?: ChatAttachment[]
    }) => {
      setAwaitingReply(false)
      setMessages((prev) =>
        prev.map((m) =>
          m.id === data.id
            ? {
                ...m,
                text: data.text,
                ...(data.style !== undefined && { style: data.style }),
                ...(data.buttons !== undefined && { buttons: data.buttons }),
                ...(data.attachments !== undefined && { attachments: data.attachments }),
              }
            : m,
        ),
      )
    }

    const onBotDelete = (data: { id: string }) => {
      setAwaitingReply(false)
      setMessages((prev) => prev.filter((m) => m.id !== data.id))
    }

    const onMsgDeleted = (data: { id: string }) =>
      setMessages((prev) => prev.filter((m) => m.id !== data.id))

    const onCleared = () => {
      setMessages([])
      setAwaitingReply(false)
      localStorage.removeItem(MESSAGES_KEY)
    }

    const onPrefixUpdated = (data: { prefix: string }) => {
      setPrefix(data.prefix)
      localStorage.setItem(PREFIX_KEY, data.prefix)
    }

    const onError = () => { setAwaitingReply(false) }

    socket.on('connect', onConnect)
    socket.on('disconnect', onDisconnect)
    socket.on('chatroom:history', onHistory)
    socket.on('chatroom:bot_message', onBotMessage)
    socket.on('chatroom:bot_edit', onBotEdit)
    socket.on('chatroom:bot_delete', onBotDelete)
    socket.on('chatroom:message_deleted', onMsgDeleted)
    socket.on('chatroom:cleared', onCleared)
    socket.on('chatroom:prefix_updated', onPrefixUpdated)
    socket.on('chatroom:error', onError)

    if (socket.connected) {
      setIsConnected(true)
      socket.emit('chatroom:join', { sessionId, prefix: prefixRef.current, botNickname: nicknameRef.current, userId: userIdRef.current, userName: displayNameRef.current, username: usernameRef.current, avatarUrl: avatarUrlRef.current, messages: messagesRef.current })
    }

    return () => {
      socket.off('connect', onConnect)
      socket.off('disconnect', onDisconnect)
      socket.off('chatroom:history', onHistory)
      socket.off('chatroom:bot_message', onBotMessage)
      socket.off('chatroom:bot_edit', onBotEdit)
      socket.off('chatroom:bot_delete', onBotDelete)
      socket.off('chatroom:message_deleted', onMsgDeleted)
      socket.off('chatroom:cleared', onCleared)
      socket.off('chatroom:prefix_updated', onPrefixUpdated)
      socket.off('chatroom:error', onError)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [socket, sessionId])

  // ── Auto-scroll ─────────────────────────────────────────────────────────────
  // Only auto-scroll when the user is already near the bottom — prevents
  // forcibly jumping away while the user is reading older messages.

  const isNearBottomRef = useRef(true)

  const scrollToBottom = useCallback((smooth = true) => {
    messagesEndRef.current?.scrollIntoView({ behavior: smooth ? 'smooth' : 'instant' })
  }, [])

  useEffect(() => {
    if (isNearBottomRef.current) {
      // First paint of the loaded history should land directly on the
      // latest message with no visible animation. Every message that
      // arrives after that (live, from the bot or the user) still
      // scrolls smoothly so the motion reads as "a new message came in".
      scrollToBottom(hasLoadedHistoryRef.current)
    }
    if (messages.length > 0) hasLoadedHistoryRef.current = true
  }, [messages, awaitingReply, scrollToBottom])

  // A message with an image/video attachment mounts before the media
  // itself has loaded, so its true height (and therefore the real
  // bottom of the thread) isn't known yet at the moment the message
  // arrives. Once the media finishes loading and the bubble expands to
  // its full size, re-run the same near-bottom-gated scroll so the view
  // still lands on the actual latest message instead of stopping short.
  const handleMediaLoad = useCallback(() => {
    if (isNearBottomRef.current) scrollToBottom()
  }, [scrollToBottom])

  // ── Scroll-to-bottom pill visibility + near-bottom tracking ─────────────────

  useEffect(() => {
    const el = scrollAreaRef.current
    if (!el) return
    let hideTimer: ReturnType<typeof setTimeout> | null = null
    const handler = () => {
      const dist = el.scrollHeight - el.scrollTop - el.clientHeight
      isNearBottomRef.current = dist < 150
      setShowScrollBtn(dist > 120)

      // Scrollbar only appears while actively scrolling, then fades out
      // after a short idle period instead of staying visible permanently.
      el.classList.add('is-scrolling')
      if (hideTimer) clearTimeout(hideTimer)
      hideTimer = setTimeout(() => el.classList.remove('is-scrolling'), 700)
    }
    el.addEventListener('scroll', handler, { passive: true })
    return () => {
      el.removeEventListener('scroll', handler)
      if (hideTimer) clearTimeout(hideTimer)
    }
  }, [])

  // ── Dismiss attach picker on outside click ───────────────────────────────────

  useEffect(() => {
    if (!showAttachPicker) return
    const handler = (e: MouseEvent) => {
      const root = document.getElementById('attach-picker-root')
      if (root && !root.contains(e.target as Node)) setShowAttachPicker(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [showAttachPicker])

  // ── Send message ─────────────────────────────────────────────────────────────

  // Converts a File to a base64 data: URL so the bytes actually survive the
  // socket round-trip to the server (a blob: URL is only valid inside this
  // browser tab and is meaningless once it reaches the backend).
  const fileToDataUrl = (file: File): Promise<string> =>
    new Promise((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => resolve(reader.result as string)
      reader.onerror = () => reject(reader.error)
      reader.readAsDataURL(file)
    })

  // Caps how large a single attachment can be before we refuse to send it —
  // data: URLs are ~33% bigger than the source file and socket.io messages
  // aren't meant to carry huge payloads.
  const MAX_ATTACHMENT_BYTES = 8 * 1024 * 1024 // 8MB

  /** Builds the wire-safe attachment payload (real bytes via data: URL when a
   *  File is pending, or the already-resolved url otherwise). */
  const resolveAttachmentsForSend = useCallback(
    async (atts: ChatAttachment[]): Promise<ChatAttachment[]> => {
      const resolved: ChatAttachment[] = []
      for (const att of atts) {
        if (att.file) {
          if (att.file.size > MAX_ATTACHMENT_BYTES) {
            throw new Error(`"${att.name ?? 'file'}" is too large (max 8MB).`)
          }
          const dataUrl = await fileToDataUrl(att.file)
          resolved.push({ type: att.type, name: att.name, url: dataUrl })
        } else {
          resolved.push({ type: att.type, name: att.name, url: att.url })
        }
      }
      return resolved
    },
    [],
  )

  const sendMessage = useCallback((rawText: string) => {
    const text = rawText.trim()
    if (!text && pendingAttachments.length === 0) return
    if (!isConnected) return

    const id = generateId()
    const userMsg: ChatMessage = {
      id,
      type: 'user',
      text,
      timestamp: Date.now(),
      ...(pendingAttachments.length > 0 && { attachments: pendingAttachments }),
      ...(replyTarget ? { replyTo: replyTarget.id } : {}),
    }
    setMessages((prev) => [...prev, userMsg])
    setAwaitingReply(true)

    const attachmentsSnapshot = pendingAttachments
    const replyTargetSnapshot = replyTarget

    void (async () => {
      let wireAttachments: ChatAttachment[] = []
      try {
        wireAttachments = await resolveAttachmentsForSend(attachmentsSnapshot)
      } catch (err) {
        // Surface the failure as a local system-style message rather than silently
        // dropping the attachment or sending a broken blob: URL to the server.
        setMessages((prev) => [
          ...prev,
          {
            id: generateId(),
            type: 'bot',
            text: `⚠️ ${err instanceof Error ? err.message : 'Could not send attachment.'}`,
            timestamp: Date.now(),
          },
        ])
        return
      }

      if (replyTargetSnapshot) {
        socket.emit('chatroom:reply', {
          id,
          text,
          sessionId,
          replyToId: replyTargetSnapshot.id,
          replyToText: replyTargetSnapshot.text,
          replyToType: replyTargetSnapshot.type,
          attachments: wireAttachments,
        })
      } else {
        socket.emit('chatroom:message', { id, text, sessionId, attachments: wireAttachments })
      }
    })()

    setPendingAttachments([])
    setReplyTarget(null)

    // Always scroll to bottom when the user sends — even if they were reading up
    isNearBottomRef.current = true
  }, [pendingAttachments, replyTarget, isConnected, socket, sessionId, resolveAttachmentsForSend])

  useEffect(() => {
    if (!awaitingReply) return
    const timer = setTimeout(() => setAwaitingReply(false), 45_000)
    return () => clearTimeout(timer)
  }, [awaitingReply])

  const handleButtonClick = useCallback(
    (buttonId: string, messageId: string) => {
      setAwaitingReply(true)
      socket.emit('chatroom:button_click', { buttonId, messageId, sessionId })
    },
    [socket, sessionId],
  )

  // Jump to the original message when a reply quote inside a bubble is
  // tapped/clicked, with a brief highlight flash so it's easy to spot.
  const handleQuoteClick = useCallback((messageId: string) => {
    const el = scrollAreaRef.current?.querySelector<HTMLElement>(`[data-message-id="${messageId}"]`)
    if (!el) return
    el.scrollIntoView({ behavior: 'smooth', block: 'center' })
    el.classList.add('cr-highlight-flash')
    setTimeout(() => el.classList.remove('cr-highlight-flash'), 900)
  }, [])

  const handleClearChat = useCallback(() => {
    setAwaitingReply(false)
    socket.emit('chatroom:clear')
  }, [socket])

  const handleSavePrefix = useCallback(
    (p: string) => {
      setShowPrefixModal(false)
      socket.emit('chatroom:set_prefix', { prefix: p })
    },
    [socket],
  )

  const handleSaveNickname = useCallback((name: string) => {
    setBotNickname(name)
    localStorage.setItem(NICKNAME_KEY, name)
    setShowNicknameModal(false)
    // Sync updated nickname to server so ai command picks it up immediately
    socket.emit('chatroom:join', { sessionId, botNickname: name, userId: userIdRef.current, userName: displayNameRef.current, username: usernameRef.current, avatarUrl: avatarUrlRef.current })
  }, [socket, sessionId])

  const handleStart = useCallback(() => {
    localStorage.setItem(GET_STARTED_KEY, 'true')
    setHasStarted(true)
    // Composer mounts as soon as hasStarted flips true and autofocuses itself.
  }, [])

  const handleRemoveAttachment = useCallback((index: number) => {
    setPendingAttachments((prev) => prev.filter((_, j) => j !== index))
  }, [])

  const handleToggleAttachPicker = useCallback(() => {
    setShowAttachPicker((p) => !p)
  }, [])

  const handleSelectAttachments = useCallback((files: ChatAttachment[]) => {
    setPendingAttachments((prev) => [...prev, ...files])
  }, [])

  const handleCloseAttachPicker = useCallback(() => {
    setShowAttachPicker(false)
  }, [])

  const handleDismissReply = useCallback(() => {
    setReplyTarget(null)
  }, [])

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <>
      {/* Browser tab title — same "<page> · Cat-Bot" convention used by
          every other dashboard page (Bot Manager, Settings, etc). */}
      <Helmet>
        <title>Chat Room · Cat-Bot</title>
      </Helmet>

      {/* Fills the dashboard's content column — sidebar stays visible alongside it */}
      <div className="flex flex-col h-full min-h-0 bg-[var(--chatroom-bg)] overflow-hidden">

        {/* ── Header ─────────────────────────────────────────────────────────────
              Single unified header for this page (the shared dashboard content
              header is skipped for this route — see DashboardLayout). Same
              surface, blur, border, height and hamburger treatment as every
              other dashboard page header — only the centre/right content
              differs: [hamburger, mobile-only] · [nickname, centred] · [profile icon]. */}
        <header
          className={cn(
            'relative flex items-center shrink-0 z-sticky',
            'bg-surface/90 backdrop-blur-xl border-b border-outline-variant/70',
            H_HEIGHT,
            H_PX,
          )}
        >
          {/* Mobile hamburger — opens the same sidebar drawer DashboardLayout owns */}
          <IconButton
            icon={mobileOpen ? <X /> : <Menu />}
            aria-label={mobileOpen ? 'Close navigation' : 'Open navigation menu'}
            variant="text"
            size="md"
            className={cn('md:hidden', H_ICON_BTN_MOBILE)}
            onClick={toggleMobileSidebar}
          />

          {/* Nickname — left-aligned on desktop (matches the title placement
              convention used by every other dashboard page header), still
              absolutely centred on mobile where there's no room next to the
              hamburger for a left-aligned title without crowding it. */}
          <p
            className={cn(
              H_BRAND_TEXT,
              'hidden md:inline-flex text-on-surface select-none truncate',
            )}
          >
            {botNickname}
          </p>

          <div className="absolute inset-0 flex items-center justify-center pointer-events-none px-16 md:hidden">
            <p
              className={cn(
                H_BRAND_TEXT,
                'text-on-surface select-none truncate',
              )}
            >
              {botNickname}
            </p>
          </div>

          {/* Profile icon — opens Chat Room settings (nickname, prefix, clear chat) */}
          <div className="ml-auto">
            <ChatSettingsMenu
              isConnected={isConnected}
              onClearChat={() => setShowClearModal(true)}
              onEditPrefix={() => setShowPrefixModal(true)}
              onEditNickname={() => setShowNicknameModal(true)}
            />
          </div>
        </header>

        {/* ── Message area ─────────────────────────────────────────────────── */}
        <div className="flex-1 min-h-0 relative">
          <div
            ref={scrollAreaRef}
            className="cr-scroll h-full overflow-y-auto overflow-x-hidden"
          >
            {!hasStarted ? (
              <div className="flex flex-col h-full">
                <GetStartedScreen onStart={handleStart} prefix={prefix} botNickname={botNickname} />
              </div>
            ) : messages.length === 0 ? (
              <div className="flex flex-col h-full">
                <EmptyChatState prefix={prefix} botNickname={botNickname} />
              </div>
            ) : (
              <div className="mx-auto w-full max-w-[48rem] flex flex-col py-3 px-3 md:px-6">
                {messages.map((msg, i) => {
                  const prevMsg = i > 0 ? messages[i - 1] : null
                  const showDate =
                    !prevMsg ||
                    new Date(msg.timestamp).toDateString() !==
                      new Date(prevMsg.timestamp).toDateString()
                  const showSpacing = !prevMsg || prevMsg.type !== msg.type

                  return (
                    <div key={msg.id} data-message-id={msg.id} className={cn(showSpacing && 'mt-3', 'rounded-2xl transition-colors duration-300')}>
                      {showDate && (
                        <div className="flex items-center gap-3 my-4 px-4">
                          <div className="flex-1 h-px bg-outline-variant/20" />
                          <span className="text-[10px] font-semibold text-on-surface-variant/40 px-2 select-none uppercase tracking-widest">
                            {formatDateLabel(msg.timestamp)}
                          </span>
                          <div className="flex-1 h-px bg-outline-variant/20" />
                        </div>
                      )}
                      <MessageBubble
                        msg={msg}
                        messages={messages}
                        onReply={setReplyTarget}
                        onButtonClick={handleButtonClick}
                        onImageOpen={handleImageOpen}
                        onQuoteClick={handleQuoteClick}
                        onMediaLoad={handleMediaLoad}
                        botNickname={botNickname}
                        displayName={displayName}
                      />
                    </div>
                  )
                })}

                <div ref={messagesEndRef} className="h-2" />
              </div>
            )}
          </div>

          {/* Scroll-to-bottom pill — centred above the composer, matching
              the floating centred affordance used by ChatGPT/Claude-style
              chat UIs instead of sitting off to one side. */}
          {showScrollBtn && (
            <button
              type="button"
              aria-label="Scroll to latest messages"
              onClick={() => {
                isNearBottomRef.current = true
                scrollToBottom()
              }}
              className="absolute bottom-3 left-1/2 -translate-x-1/2 z-10 flex items-center justify-center h-10 w-10 rounded-full bg-surface-container border border-outline-variant/50 shadow-elevation-2 text-on-surface-variant hover:text-on-surface hover:bg-surface-container-high transition-colors"
            >
              <ChevronDown className="h-5 w-5" />
            </button>
          )}
        </div>

        {/* ── Input area ───────────────────────────────────────────────────── */}
        {hasStarted && (
          // No background/panel here — this row is pure spacing so the
          // composer pill below is the *only* visible surface, floating
          // directly over the message list like ChatGPT's input bar,
          // identically on mobile and desktop.
          <div className="cr-input-safe-pb shrink-0 px-3 md:px-6 pt-2 md:pt-4">
            {/* Capped + centred on desktop — full-bleed pill only makes sense on phones */}
            <div className="mx-auto w-full max-w-[48rem]">
              {/* Reply preview */}
              {replyTarget && (
                <ReplyPreviewBar
                  target={replyTarget}
                  onDismiss={handleDismissReply}
                  botNickname={botNickname}
                  displayName={displayName}
                />
              )}

              <Composer
                prefix={prefix}
                botNickname={botNickname}
                isConnected={isConnected}
                isMobileViewport={isMobileViewport}
                pendingAttachments={pendingAttachments}
                onRemoveAttachment={handleRemoveAttachment}
                showAttachPicker={showAttachPicker}
                onToggleAttachPicker={handleToggleAttachPicker}
                onSelectAttachments={handleSelectAttachments}
                onCloseAttachPicker={handleCloseAttachPicker}
                onSend={sendMessage}
                inputRef={inputRef}
              />
            </div>
          </div>
        )}
      </div>

      {/* ── Modals ─────────────────────────────────────────────────────────── */}
      {showPrefixModal && (
        <PrefixModal
          current={prefix}
          onSave={handleSavePrefix}
          onClose={() => setShowPrefixModal(false)}
        />
      )}
      {showClearModal && (
        <ClearModal
          onConfirm={handleClearChat}
          onClose={() => setShowClearModal(false)}
        />
      )}
      {showNicknameModal && (
        <NicknameModal
          current={botNickname}
          onSave={handleSaveNickname}
          onClose={() => setShowNicknameModal(false)}
        />
      )}
      {lightbox && (
        <ImageLightbox
          images={lightbox.images}
          index={lightbox.index}
          onIndexChange={(i) => setLightbox((prev) => (prev ? { ...prev, index: i } : prev))}
          onClose={() => setLightbox(null)}
        />
      )}

      {/* ── Scoped styles ──────────────────────────────────────────────────── */}
      <style>{CR_STYLES}</style>
    </>
  )
}