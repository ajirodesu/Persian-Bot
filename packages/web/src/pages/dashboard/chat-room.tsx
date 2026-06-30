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
  useRef,
  useCallback,
  type KeyboardEvent as ReactKeyboardEvent,
  type ChangeEvent,
} from 'react'
import { useNavigate } from 'react-router-dom'
import {
  ArrowLeft,
  MoreVertical,
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
} from 'lucide-react'
import { getSocket } from '@/lib/socket.lib'
import { cn } from '@/utils/cn.util'
import { ROUTES } from '@/constants/routes.constants'
import Logo from '@/components/ui/Logo'
import { useUserAuth } from '@/contexts/UserAuthContext'
import { H_HEIGHT } from '@/constants/header.constants'

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
}

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

function renderMarkdown(text: string): string {
  if (!text) return ''

  let html = text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')

  const codeBlocks: string[] = []
  html = html.replace(/```([\s\S]*?)```/g, (_, code: string) => {
    const idx = codeBlocks.length
    codeBlocks.push(
      `<pre class="chatmd-pre"><code class="chatmd-code-block">${code.trim()}</code></pre>`,
    )
    return `\x00CODE${idx}\x00`
  })

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

function MarkdownText({ text, style }: { text: string; style?: string }) {
  if (!text) return null
  if (style !== 'markdown') {
    return <span className="whitespace-pre-wrap break-words">{text}</span>
  }
  return (
    <span
      className="chatmd break-words"
      dangerouslySetInnerHTML={{ __html: renderMarkdown(text) }}
    />
  )
}

// ── Attachment View ───────────────────────────────────────────────────────────

function AttachmentView({ att }: { att: ChatAttachment }) {
  const url = att.localUrl ?? att.url
  if (att.type === 'image' && url) {
    return (
      <a href={url} target="_blank" rel="noopener noreferrer" className="block">
        <img
          src={url}
          alt={att.name ?? 'image'}
          className="max-w-[220px] max-h-[180px] w-full rounded-xl object-cover border border-white/10"
        />
      </a>
    )
  }
  if (att.type === 'video' && url) {
    return (
      <video src={url} controls className="max-w-[240px] rounded-xl border border-white/10" />
    )
  }
  if (att.type === 'audio' && url) {
    return <audio src={url} controls className="max-w-[240px] mt-1" />
  }
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

function BotButtonRow({
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
}

// ── Reply Quote inside bubble ─────────────────────────────────────────────────

function ReplyQuote({
  messages,
  replyToId,
  botNickname,
  displayName,
}: {
  messages: ChatMessage[]
  replyToId: string
  botNickname: string
  displayName: string
}) {
  const original = messages.find((m) => m.id === replyToId)
  if (!original) return null
  return (
    <div className="flex gap-2 mb-2 px-2.5 py-2 rounded-xl bg-black/20 border-l-2 border-primary/60">
      <div className="min-w-0">
        <p className="text-[10px] font-bold text-primary/90 mb-0.5 uppercase tracking-widest">
          {original.type === 'bot' ? botNickname : displayName}
        </p>
        <p className="text-xs text-on-surface/60 truncate leading-snug">
          {original.text.slice(0, 72) || '📎 Attachment'}
        </p>
      </div>
    </div>
  )
}

// ── Message Bubble ────────────────────────────────────────────────────────────

function MessageBubble({
  msg,
  messages,
  onReply,
  onDelete,
  onButtonClick,
  botNickname,
  displayName,
}: {
  msg: ChatMessage
  messages: ChatMessage[]
  onReply: (target: ReplyTarget) => void
  onDelete: (id: string) => void
  onButtonClick: (buttonId: string, messageId: string) => void
  botNickname: string
  displayName: string
}) {
  const [hovered, setHovered] = useState(false)
  const isBot = msg.type === 'bot'
  const hasAttachments = (msg.attachments?.length ?? 0) > 0
  const hasButtons = (msg.buttons?.length ?? 0) > 0
  const hasText = !!msg.text?.trim()

  const ActionButtons = (
    <div
      className={cn(
        'flex items-center gap-0.5 transition-all duration-150 shrink-0 self-center',
        hovered ? 'opacity-100' : 'opacity-0 pointer-events-none',
        isBot ? 'ml-1 order-last' : 'mr-1 order-first',
      )}
    >
      <button
        type="button"
        aria-label="Reply"
        onClick={() => onReply({ id: msg.id, text: msg.text, type: msg.type })}
        className="p-1.5 rounded-full bg-surface-container border border-outline-variant/50 text-on-surface-variant hover:text-primary hover:border-primary/50 transition-colors shadow-sm"
      >
        <Reply className="h-3 w-3" />
      </button>
      <button
        type="button"
        aria-label="Delete"
        onClick={() => onDelete(msg.id)}
        className="p-1.5 rounded-full bg-surface-container border border-outline-variant/50 text-on-surface-variant hover:text-error hover:border-error/50 transition-colors shadow-sm"
      >
        <Trash2 className="h-3 w-3" />
      </button>
    </div>
  )

  return (
    <div
      className={cn(
        'flex w-full items-end gap-1 px-3 py-0.5',
        isBot ? 'justify-start' : 'justify-end',
      )}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      {/* Bubble column */}
      <div
        className={cn(
          'flex flex-col relative max-w-[72%]',
          isBot ? 'items-start order-first' : 'items-end order-last',
        )}
        style={{ minWidth: 0 }}
      >
        {/* Reply quote */}
        {msg.replyTo && (
          <ReplyQuote messages={messages} replyToId={msg.replyTo} botNickname={botNickname} displayName={displayName} />
        )}

        {/* Bubble body */}
        <div
          className={cn(
            'px-3.5 py-2.5 min-w-[52px]',
            isBot
              ? 'bg-[var(--bubble-bot)] text-[var(--bubble-bot-text)] rounded-2xl'
              : 'bg-[var(--bubble-user)] text-[var(--bubble-user-text)] rounded-2xl',
            'shadow-md',
          )}
          style={{ wordBreak: 'break-word', overflowWrap: 'break-word' }}
        >
          {hasAttachments && (
            <div className="flex flex-col gap-2 mb-2">
              {msg.attachments!.map((att, i) => (
                <AttachmentView key={i} att={att} />
              ))}
            </div>
          )}

          {hasText && (
            <div className="text-[13.5px] leading-relaxed">
              <MarkdownText text={msg.text} style={msg.style} />
            </div>
          )}

          {/* Meta row */}
          <div className={cn('flex items-center gap-1 mt-1', isBot ? 'justify-start' : 'justify-end')}>
            <span className="text-[10px] opacity-40 leading-none select-none tabular-nums">
              {formatTime(msg.timestamp)}
            </span>
            {!isBot && <CheckCheck className="h-3 w-3 opacity-40 shrink-0" />}
          </div>
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

      {/* Hover action buttons */}
      {ActionButtons}
    </div>
  )
}

// ── Three-dot Menu ────────────────────────────────────────────────────────────

function DotsMenu({
  onClearChat,
  onEditPrefix,
  onEditNickname,
}: {
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
        aria-label="Chat options"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((p) => !p)}
        className={cn(
          'p-2 rounded-full text-on-surface-variant hover:bg-on-surface/10 transition-colors',
          open && 'bg-on-surface/10',
        )}
      >
        <MoreVertical className="h-5 w-5" />
      </button>

      {open && (
        <div
          role="menu"
          className="absolute right-0 top-full mt-1.5 z-[150] min-w-[192px] rounded-2xl border border-outline-variant/60 bg-surface-container shadow-elevation-3 py-1.5 overflow-hidden"
          style={{ animation: 'cr-fadeIn 120ms ease both' }}
        >
          <button
            type="button"
            role="menuitem"
            onClick={() => { setOpen(false); onEditNickname() }}
            className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-on-surface hover:bg-on-surface/8 transition-colors"
          >
            <Tag className="h-4 w-4 shrink-0 text-on-surface-variant" />
            Edit Bot Nickname
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={() => { setOpen(false); onEditPrefix() }}
            className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-on-surface hover:bg-on-surface/8 transition-colors"
          >
            <Hash className="h-4 w-4 shrink-0 text-on-surface-variant" />
            Edit Prefix
          </button>
          <div className="mx-3 my-1 border-t border-outline-variant/40" />
          <button
            type="button"
            role="menuitem"
            onClick={() => { setOpen(false); onClearChat() }}
            className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-error hover:bg-error/8 transition-colors"
          >
            <Trash2 className="h-4 w-4 shrink-0" />
            Clear Chat
          </button>
        </div>
      )}
    </div>
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
      return {
        type: isImage ? ('image' as const) : type,
        name: f.name,
        localUrl: URL.createObjectURL(f),
        file: f,
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

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function ChatRoomPage() {
  const navigate = useNavigate()
  const { user } = useUserAuth()

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
  const [inputText, setInputText] = useState('')
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

  const messagesEndRef = useRef<HTMLDivElement>(null)
  const scrollAreaRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
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

  // ── Persist messages whenever they change ───────────────────────────────────

  useEffect(() => {
    saveMessagesToStorage(messages)
  }, [messages])

  // ── Socket events ───────────────────────────────────────────────────────────

  useEffect(() => {
    if (!socket.connected) socket.connect()

    const onConnect = () => {
      setIsConnected(true)
      socket.emit('chatroom:join', { sessionId, prefix: prefixRef.current, botNickname: nicknameRef.current, userId: userIdRef.current, userName: displayNameRef.current, username: usernameRef.current, avatarUrl: avatarUrlRef.current, messages: messagesRef.current })
    }
    const onDisconnect = () => setIsConnected(false)

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
      setMessages((prev) => (prev.some((m) => m.id === msg.id) ? prev : [...prev, msg]))
    }

    const onBotEdit = (data: {
      id: string
      text: string
      style?: string
      buttons?: BotButton[][]
      attachments?: ChatAttachment[]
    }) => {
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

    const onBotDelete = (data: { id: string }) =>
      setMessages((prev) => prev.filter((m) => m.id !== data.id))

    const onMsgDeleted = (data: { id: string }) =>
      setMessages((prev) => prev.filter((m) => m.id !== data.id))

    const onCleared = () => {
      setMessages([])
      localStorage.removeItem(MESSAGES_KEY)
    }

    const onPrefixUpdated = (data: { prefix: string }) => {
      setPrefix(data.prefix)
      localStorage.setItem(PREFIX_KEY, data.prefix)
    }

    const onError = () => { /* no-op */ }

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

  const scrollToBottom = useCallback((smooth = true) => {
    messagesEndRef.current?.scrollIntoView({ behavior: smooth ? 'smooth' : 'instant' })
  }, [])

  useEffect(() => {
    scrollToBottom()
  }, [messages, scrollToBottom])

  // ── Scroll-to-bottom pill visibility ────────────────────────────────────────

  useEffect(() => {
    const el = scrollAreaRef.current
    if (!el) return
    const handler = () => {
      const dist = el.scrollHeight - el.scrollTop - el.clientHeight
      setShowScrollBtn(dist > 120)
    }
    el.addEventListener('scroll', handler, { passive: true })
    return () => el.removeEventListener('scroll', handler)
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

  const sendMessage = useCallback(() => {
    const text = inputText.trim()
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

    setInputText('')
    setPendingAttachments([])
    setReplyTarget(null)

    if (inputRef.current) {
      inputRef.current.style.height = 'auto'
    }
    inputRef.current?.focus()
  }, [inputText, pendingAttachments, replyTarget, isConnected, socket, sessionId, resolveAttachmentsForSend])

  const handleButtonClick = useCallback(
    (buttonId: string, messageId: string) => {
      socket.emit('chatroom:button_click', { buttonId, messageId, sessionId })
    },
    [socket, sessionId],
  )

  const handleDeleteMessage = useCallback(
    (id: string) => socket.emit('chatroom:delete_message', { id }),
    [socket],
  )

  const handleClearChat = useCallback(() => socket.emit('chatroom:clear'), [socket])

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

  /**
   * Exit the chat room — navigate back to dashboard.
   * Messages and session are intentionally preserved for next visit.
   */
  const handleExit = useCallback(() => {
    navigate(ROUTES.DASHBOARD.ROOT)
  }, [navigate])

  const handleStart = () => {
    localStorage.setItem(GET_STARTED_KEY, 'true')
    setHasStarted(true)
    setTimeout(() => inputRef.current?.focus(), 50)
  }

  const handleKeyDown = (e: ReactKeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      sendMessage()
    }
  }

  const handleInputChange = (e: ChangeEvent<HTMLTextAreaElement>) => {
    setInputText(e.target.value)
    const el = e.target
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`
  }

  const canSend = isConnected && (!!inputText.trim() || pendingAttachments.length > 0)

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <>
      {/* Full-screen overlay covers dashboard */}
      <div className="fixed inset-0 z-[100] flex flex-col bg-[var(--chatroom-bg)] overflow-hidden">

        {/* ── Header ─────────────────────────────────────────────────────────── */}
        <header
          className={cn(
            'flex items-center gap-3 px-3 shrink-0',
            'bg-[var(--chatroom-header)] border-b border-outline-variant/30 shadow-sm',
            H_HEIGHT,
          )}
        >
          <button
            type="button"
            aria-label="Exit chat room"
            onClick={handleExit}
            className="p-2 -ml-1 rounded-full text-on-surface-variant hover:bg-on-surface/10 transition-colors shrink-0"
          >
            <ArrowLeft className="h-5 w-5" />
          </button>

          {/* Bot avatar with online dot */}
          <div className="relative shrink-0">
            <div className="h-9 w-9 rounded-full bg-primary-container flex items-center justify-center ring-2 ring-primary/20">
              <Logo className="h-5 w-5 text-on-primary-container" />
            </div>
            <div className={cn(
              'absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full border-2 border-[var(--chatroom-header)] transition-colors duration-500',
              isConnected ? 'bg-emerald-400' : 'bg-on-surface-variant/30',
            )} />
          </div>

          {/* Name + status */}
          <div className="flex-1 min-w-0">
            <p className="text-sm font-bold text-on-surface leading-tight">{botNickname}</p>
            <p className="text-[11px] leading-tight">
              {!isConnected ? (
                <span className="text-on-surface-variant/60">Connecting…</span>
              ) : (
                <span className="text-emerald-400/80 font-medium">Online</span>
              )}
            </p>
          </div>

          {/* Username chip */}
          <div className="hidden sm:flex items-center gap-1 px-2 py-1 rounded-lg bg-on-surface/5 border border-outline-variant/30 shrink-0">
            <span className="text-xs font-mono text-on-surface-variant font-medium">@{username}</span>
          </div>

          {/* Prefix chip */}
          <div className="hidden sm:flex items-center gap-1 px-2 py-1 rounded-lg bg-primary/10 border border-primary/20 shrink-0">
            <Hash className="h-3 w-3 text-primary" />
            <span className="text-xs font-mono text-primary font-bold">{prefix}</span>
          </div>

          <DotsMenu
            onClearChat={() => setShowClearModal(true)}
            onEditPrefix={() => setShowPrefixModal(true)}
            onEditNickname={() => setShowNicknameModal(true)}
          />
        </header>

        {/* ── Message area ─────────────────────────────────────────────────── */}
        <div className="flex-1 min-h-0 relative">
          <div
            ref={scrollAreaRef}
            className="h-full overflow-y-auto overflow-x-hidden"
            style={{ scrollbarWidth: 'thin', scrollbarColor: 'rgba(255,255,255,0.07) transparent' }}
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
              <div className="flex flex-col py-3">
                {messages.map((msg, i) => {
                  const prevMsg = i > 0 ? messages[i - 1] : null
                  const showDate =
                    !prevMsg ||
                    new Date(msg.timestamp).toDateString() !==
                      new Date(prevMsg.timestamp).toDateString()
                  const showSpacing = !prevMsg || prevMsg.type !== msg.type

                  return (
                    <div key={msg.id} className={showSpacing ? 'mt-2' : ''}>
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
                        onDelete={handleDeleteMessage}
                        onButtonClick={handleButtonClick}
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

          {/* Scroll-to-bottom pill */}
          {showScrollBtn && (
            <button
              type="button"
              aria-label="Scroll to bottom"
              onClick={() => scrollToBottom()}
              className="absolute bottom-3 right-3 z-10 flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-surface-container border border-outline-variant/50 shadow-elevation-2 text-on-surface-variant hover:text-on-surface transition-colors text-xs font-medium"
            >
              <ChevronDown className="h-3.5 w-3.5" />
              Latest
            </button>
          )}
        </div>

        {/* ── Input area ───────────────────────────────────────────────────── */}
        {hasStarted && (
          <div className="shrink-0 px-3 py-1.5 bg-[var(--chatroom-bg)]">
            {/* Reply preview */}
            {replyTarget && (
              <ReplyPreviewBar
                target={replyTarget}
                onDismiss={() => setReplyTarget(null)}
                botNickname={botNickname}
                displayName={displayName}
              />
            )}

            {/* Replit-agent style input container */}
            <div
              className={cn(
                'relative rounded-2xl border transition-all',
                'bg-[var(--input-bg)] border-[var(--input-border)]',
                'focus-within:border-[var(--input-border-focus)] focus-within:shadow-[0_0_0_2px_var(--input-ring)]',
              )}
            >
              {/* Pending attachments row — images shown in the message bar */}
              {pendingAttachments.length > 0 && (
                <div className="flex flex-wrap gap-2 px-3 pt-2.5 pb-1">
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
                        onClick={() => setPendingAttachments((prev) => prev.filter((_, j) => j !== i))}
                        aria-label="Remove attachment"
                        className="absolute -top-1.5 -right-1.5 h-5 w-5 rounded-full bg-surface-container border border-outline-variant/50 flex items-center justify-center text-on-surface-variant hover:text-error transition-colors opacity-0 group-hover/att:opacity-100 shadow-sm"
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </div>
                  ))}
                </div>
              )}

              {/* Auto-resizing textarea */}
              <textarea
                ref={inputRef}
                value={inputText}
                onChange={handleInputChange}
                onKeyDown={handleKeyDown}
                placeholder={
                  isConnected
                    ? `Message ${botNickname} or use ${prefix}help`
                    : 'Connecting…'
                }
                rows={1}
                disabled={!isConnected}
                className={cn(
                  'w-full bg-transparent text-sm text-on-surface leading-relaxed',
                  'placeholder:text-on-surface-variant/35 focus:outline-none',
                  'resize-none overflow-y-auto px-4 pt-2 pb-0.5',
                  !isConnected && 'opacity-40 cursor-not-allowed',
                )}
                style={{ minHeight: '32px', maxHeight: '200px' }}
              />

              {/* Bottom action row: attach (left) ↔ send (right) */}
              <div className="flex items-center justify-between px-2 pb-1.5 pt-0">
                {/* Attachment button — + icon like Replit agent */}
                <div id="attach-picker-root" className="relative">
                  <button
                    type="button"
                    aria-label="Attach file"
                    aria-expanded={showAttachPicker}
                    onClick={() => setShowAttachPicker((p) => !p)}
                    className={cn(
                      'flex items-center justify-center h-6 w-6 rounded-xl transition-colors',
                      showAttachPicker
                        ? 'bg-primary/15 text-primary'
                        : 'text-on-surface-variant/50 hover:text-on-surface-variant hover:bg-on-surface/8',
                    )}
                  >
                    <Plus className="h-3.5 w-3.5" />
                  </button>
                  {showAttachPicker && (
                    <AttachmentPicker
                      onSelect={(files) => setPendingAttachments((prev) => [...prev, ...files])}
                      onClose={() => setShowAttachPicker(false)}
                    />
                  )}
                </div>

                {/* Send button — arrow up ⬆ like Replit agent */}
                <button
                  type="button"
                  aria-label="Send message"
                  onClick={sendMessage}
                  disabled={!canSend}
                  className={cn(
                    'flex items-center justify-center h-6 w-6 rounded-xl transition-all',
                    canSend
                      ? 'bg-primary text-on-primary shadow-sm hover:opacity-90 active:scale-95'
                      : 'bg-on-surface/8 text-on-surface-variant/30 cursor-not-allowed',
                  )}
                >
                  <ArrowUp className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>

            {/* Shift+Enter hint — hidden on mobile */}
            <p className="hidden sm:block text-center text-[10px] text-on-surface-variant/30 mt-1 select-none">
              Enter to send · Shift+Enter for new line
            </p>
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

      {/* ── Scoped styles ──────────────────────────────────────────────────── */}
      <style>{`
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
        }
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
      `}</style>
    </>
  )
}