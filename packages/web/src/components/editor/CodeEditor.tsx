/**
 * CodeEditor — lightweight, dependency-free source editor for the Files panels.
 *
 * Renders a transparent <textarea> layered over a syntax-highlighted <pre>
 * (the classic "overlay" technique). Both share the exact same font metrics,
 * padding and white-space so the colored tokens align pixel-perfect with the
 * caret. Scroll positions are synced from the textarea to the highlight layer.
 *
 * A line-number gutter sits to the left, sharing the same line metrics so the
 * numbers stay aligned with the code as it scrolls.
 *
 * Features:
 *   • Tab key inserts two-space indentation at the caret / over a selection
 *   • Ctrl/Cmd+S triggers the optional onSave callback (browser default stopped)
 *   • Grows to the height of the content (inline), or fills the parent
 *     (fullscreen, `fillHeight`) with internal scrolling
 *   • Token palette (.tok-*) scoped under .code-editor, matching the chat room
 */

import { memo, useCallback, useMemo, useRef } from 'react'
import { highlightToHtml } from '@/lib/syntax-highlight.lib'
import { cn } from '@/utils/cn.util'

export interface CodeEditorProps {
  value: string
  onChange: (value: string) => void
  /** Language key (e.g. 'typescript', 'json') driving highlighting. */
  language?: string | null
  readOnly?: boolean
  placeholder?: string
  onSave?: () => void
  className?: string
  /** Minimum height in px; inline mode grows with content beyond this. */
  minHeight?: number
  /** Fill the parent container instead of growing with content (fullscreen). */
  fillHeight?: boolean
  /** Focus the textarea on mount (fullscreen mode). */
  autoFocus?: boolean
}

/** Shared metrics — MUST be identical on both layers for alignment. */
const surfaceClasses =
  'font-mono text-[13px] leading-6 tracking-normal [tab-size:4] p-4 ' +
  'whitespace-pre border-0 outline-none shadow-none'

/** Line height (leading-6 = 1.5rem = 24px) and total vertical padding (p-4). */
const LINE_HEIGHT = 24
const V_PADDING = 32

const CodeEditor = memo(function CodeEditor({
  value,
  onChange,
  language,
  readOnly = false,
  placeholder = '',
  onSave,
  className,
  minHeight = 320,
  fillHeight = false,
  autoFocus = false,
}: CodeEditorProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const preRef = useRef<HTMLPreElement>(null)
  const gutterRef = useRef<HTMLDivElement>(null)

  const lineCount = useMemo(() => value.split('\n').length, [value])
  const contentHeight = useMemo(
    () => Math.max(minHeight, lineCount * LINE_HEIGHT + V_PADDING),
    [lineCount, minHeight],
  )
  const lineNumbers = useMemo(
    () => Array.from({ length: lineCount }, (_, i) => i + 1).join('\n'),
    [lineCount],
  )
  const gutterWidth = useMemo(
    () => Math.max(48, String(lineCount).length * 12 + 16),
    [lineCount],
  )

  // Keep the highlight layer and the gutter scrolled in lockstep with the caret.
  const handleScroll = useCallback(() => {
    const ta = textareaRef.current
    const pre = preRef.current
    const gutter = gutterRef.current
    if (ta && pre) {
      pre.scrollTop = ta.scrollTop
      pre.scrollLeft = ta.scrollLeft
    }
    if (ta && gutter) gutter.scrollTop = ta.scrollTop
  }, [])

  const applyInsertion = useCallback(
    (insert: string) => {
      const ta = textareaRef.current
      if (!ta) return
      const { selectionStart: start, selectionEnd: end } = ta
      const next = value.slice(0, start) + insert + value.slice(end)
      onChange(next)
      // Restore focus and put the caret just past the inserted text on the
      // next tick so the textarea has already committed the new value.
      requestAnimationFrame(() => {
        ta.focus()
        const pos = start + insert.length
        ta.setSelectionRange(pos, pos)
      })
    },
    [onChange, value],
  )

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault()
        onSave?.()
        return
      }
      if (e.key === 'Tab' && !readOnly) {
        e.preventDefault()
        const ta = e.currentTarget
        if (ta.selectionStart === ta.selectionEnd) {
          applyInsertion('  ')
        } else {
          applyInsertion('\n  ')
        }
      }
    },
    [applyInsertion, onSave, readOnly],
  )

  // The trailing "\n" keeps the highlight layer one line tall when the
  // textarea's final line is empty — otherwise they drift out of sync.
  const highlighted = useMemo(
    () => highlightToHtml(value, language ?? null) + '\n',
    [value, language],
  )

  return (
    <div
      className={cn(
        'code-editor relative w-full overflow-hidden rounded-[var(--radius-card)] ' +
          'border border-outline-variant bg-surface-container-lowest ' +
          'focus-within:border-primary focus-within:shadow-[var(--shadow-focus-ring,none)]',
        fillHeight && 'h-full',
        className,
      )}
      style={fillHeight ? undefined : { minHeight, height: contentHeight }}
    >
      {/* Line-number gutter — shares font metrics so numbers stay aligned */}
      <div
        ref={gutterRef}
        aria-hidden="true"
        className={cn(
          surfaceClasses,
          'absolute left-0 top-0 bottom-0 z-[1] overflow-hidden select-none pointer-events-none ' +
            'border-r border-outline-variant/50 bg-surface-container/60 text-right ' +
            'text-on-surface-variant/55 [font-variant-numeric:tabular-nums] whitespace-pre',
        )}
        style={{ width: gutterWidth, paddingRight: 10, paddingLeft: 0 }}
      >
        <span style={{ height: contentHeight }} className="block">
          {lineNumbers}
        </span>
      </div>

      {/* Highlight layer — absolutely positioned behind the textarea */}
      <pre
        ref={preRef}
        aria-hidden="true"
        className={cn(
          surfaceClasses,
          'absolute inset-0 m-0 overflow-hidden text-on-surface pointer-events-none',
        )}
        style={{ paddingLeft: gutterWidth }}
        dangerouslySetInnerHTML={{ __html: highlighted }}
      />

      {/* Input layer — transparent text, visible caret */}
      <textarea
        ref={textareaRef}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onScroll={handleScroll}
        onKeyDown={handleKeyDown}
        readOnly={readOnly}
        spellCheck={false}
        autoCapitalize="off"
        autoComplete="off"
        autoCorrect="off"
        autoFocus={autoFocus}
        placeholder={placeholder}
        aria-label="Code editor"
        className={cn(
          surfaceClasses,
          // Scrollable with a hidden native scrollbar so both layers keep
          // identical content boxes (no scrollbar gutter → pixel-perfect
          // highlight alignment). Wheel/touch/keyboard scrolling all still
          // work; iOS Safari shows its overlay scrollbar on demand.
          'scrollbar-hidden relative h-full w-full resize-none overflow-auto bg-transparent ' +
            'text-transparent caret-[rgb(var(--color-primary))] selection:bg-primary/30 ' +
            'placeholder:text-on-surface-variant/60',
        )}
        style={{ paddingLeft: gutterWidth }}
      />

      {/* Scoped token palette — matches the chat room's VS Code "Dark+" colors */}
      <style>{`
        .code-editor .tok-keyword  { color: rgb(var(--color-primary)); }
        .code-editor .tok-string   { color: rgb(var(--color-warning)); }
        .code-editor .tok-comment  { color: rgb(var(--color-on-surface-variant)); font-style: italic; }
        .code-editor .tok-number   { color: rgb(var(--color-success)); }
        .code-editor .tok-function { color: rgb(var(--color-on-surface)); }
        .code-editor .tok-type     { color: rgb(var(--color-tertiary)); }
        .code-editor .tok-property { color: rgb(var(--color-info)); }
        .code-editor .tok-tag      { color: rgb(var(--color-primary)); }
        .code-editor .tok-attr     { color: rgb(var(--color-info)); }
        .code-editor .tok-punct    { color: rgb(var(--color-outline)); }
      `}</style>
    </div>
  )
})

export default CodeEditor
