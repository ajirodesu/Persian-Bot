/**
 * CodeEditor — lightweight, dependency-free source editor for the Files panels.
 *
 * A transparent <textarea> is layered over syntax-highlighted code rows (the
 * classic "overlay" technique). The overlay shares the code column's exact
 * font metrics, padding, wrapping and width, so wrapped lines and the caret
 * align pixel-perfect with the colored tokens — with zero horizontal scroll.
 *
 * Layout is one grid row per logical line: [gutter number][code]. Rows grow
 * with wrapped content, so numbers never drift. Long lines continue on the
 * next line (pre-wrap + break-words), matching the prototype.
 *
 * Features:
 *   • Tab key inserts two-space indentation at the caret / over a selection
 *   • Ctrl/Cmd+S triggers the optional onSave callback (browser default stopped)
 *   • Grows to the height of the content (inline), or fills the parent
 *     (fullscreen, `fillHeight`) with internal scrolling
 *   • Token palette (.tok-*) scoped under .code-editor, themed per dashboard theme
 */

import {
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { highlightToHtml, splitHighlightedHtml } from '@/lib/syntax-highlight.lib'
import { cn } from '@/utils/cn.util'

export interface CodeEditorCursor {
  line: number
  column: number
}

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
  /** Reports the caret's 1-based line/column whenever it moves. */
  onCursor?: (pos: CodeEditorCursor) => void
  /** Removes the container border/focus ring for edge-to-edge full-screen use. */
  borderless?: boolean
}

/** Shared code metrics — MUST be identical on rows and overlay for alignment. */
const codeClasses =
  'font-mono text-[13px] leading-6 tracking-normal [tab-size:4] ' +
  'whitespace-pre-wrap break-words border-0 outline-none shadow-none'

/** Horizontal gap between the rightmost digit and the code (GitHub-like). */
const GUTTER_PAD_RIGHT = 16
/** Inner horizontal padding of the code column, each side. */
const CODE_PAD_X = 16
/** Inner vertical padding of the whole surface, top and bottom. */
const CODE_PAD_Y = 16

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
  onCursor,
  borderless = false,
}: CodeEditorProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const rowsRef = useRef<HTMLDivElement>(null)
  const rowRefs = useRef<Array<HTMLDivElement | null>>([])

  const [caretLine, setCaretLine] = useState(1)
  const [caretColumn, setCaretColumn] = useState(1)
  const [overlayHeight, setOverlayHeight] = useState<number | undefined>(
    undefined,
  )

  const lines = useMemo(() => value.split('\n'), [value])
  const lineCount = lines.length
  const htmlRows = useMemo(() => {
    const rows = splitHighlightedHtml(highlightToHtml(value, language ?? null))
    // Defensive: the splitter preserves line count, but never render short.
    while (rows.length < lineCount) rows.push('')
    return rows.slice(0, lineCount)
  }, [value, language, lineCount])
  const gutterWidth = useMemo(
    () => Math.max(48, String(lineCount).length * 12 + GUTTER_PAD_RIGHT),
    [lineCount],
  )

  // The overlay must cover the full content height (not just the viewport)
  // so it scrolls 1:1 with the rows inside the single scroll container.
  useLayoutEffect(() => {
    const measure = () => {
      const el = rowsRef.current
      if (!el) return
      const h = el.scrollHeight
      setOverlayHeight((prev) => (prev === h ? prev : h))
    }
    measure()
    window.addEventListener('resize', measure)
    return () => window.removeEventListener('resize', measure)
  }, [value, lineCount])

  // Report the caret position whenever it moves (drives the status bar Ln/Col).
  useEffect(() => {
    onCursor?.({ line: caretLine, column: caretColumn })
  }, [caretLine, caretColumn, onCursor])

  // Keep the caret's row visible inside the scroll container.
  const ensureCaretVisible = useCallback((line: number) => {
    const scroller = scrollRef.current
    const row = rowRefs.current[line - 1]
    if (!scroller || !row) return
    const rowTop = row.offsetTop
    const rowBottom = rowTop + row.offsetHeight
    const viewTop = scroller.scrollTop
    const viewBottom = viewTop + scroller.clientHeight
    if (rowTop < viewTop + 4) {
      scroller.scrollTop = Math.max(0, rowTop - 4)
    } else if (rowBottom > viewBottom - 4) {
      scroller.scrollTop = rowBottom - scroller.clientHeight + 4
    }
  }, [])

  // Parse (selectionStart → 1-based line/column) after each interaction so the
  // active-line highlight + status bar stay in sync with the caret.
  const syncCaret = useCallback(() => {
    const ta = textareaRef.current
    if (!ta) return
    const pos = ta.selectionStart
    let line = 1
    let idx = 0
    while (idx < pos) {
      if (value.charCodeAt(idx) === 10) line++
      idx++
    }
    const lineStart = value.lastIndexOf('\n', pos - 1) + 1
    const column = pos - lineStart + 1
    setCaretLine(line)
    setCaretColumn(column)
    ensureCaretVisible(line)
  }, [value, ensureCaretVisible])

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
        syncCaret()
      })
    },
    [onChange, value, syncCaret],
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

  return (
    <div
      className={cn(
        'code-editor relative w-full overflow-hidden bg-surface-container-lowest',
        !borderless &&
          'border border-outline-variant focus-within:border-primary focus-within:shadow-[var(--shadow-focus-ring,none)]',
        fillHeight && 'h-full',
        className,
      )}
      style={fillHeight ? undefined : { minHeight }}
    >
      {/* Single scroll container — rows and overlay travel together, so no
          scroll syncing (and no horizontal scrolling) is needed. */}
      <div ref={scrollRef} className="h-full w-full overflow-y-auto overflow-x-hidden">
        <div ref={rowsRef} className="relative min-h-full" style={{ minHeight }}>
          {/* Code rows — one grid row per logical line; the row grows with
              wrapped content and the gutter number stays pinned to its top. */}
          {lines.map((_, i) => {
            const lineNo = i + 1
            const active = lineNo === caretLine
            return (
              <div
                key={lineNo}
                ref={(el) => {
                  rowRefs.current[i] = el
                }}
                className={cn(
                  'flex min-h-6',
                  active && 'bg-primary/[0.06]',
                )}
              >
                <div
                  aria-hidden="true"
                  className="shrink-0 select-none text-right text-on-surface-variant/55 [font-variant-numeric:tabular-nums] font-mono text-[13px] leading-6"
                  style={{ width: gutterWidth, paddingRight: GUTTER_PAD_RIGHT }}
                >
                  {lineNo}
                </div>
                <div
                  className={cn(
                    codeClasses,
                    'flex-1 min-w-0 text-on-surface',
                  )}
                  style={{
                    paddingLeft: CODE_PAD_X,
                    paddingRight: CODE_PAD_X,
                    paddingTop: i === 0 ? CODE_PAD_Y : 0,
                    paddingBottom: i === lineCount - 1 ? CODE_PAD_Y : 0,
                  }}
                  dangerouslySetInnerHTML={{ __html: htmlRows[i] || ' ' }}
                />
              </div>
            )
          })}

          {/* Input layer — transparent text over the code column only. Same
              font, padding, wrapping and width as the rows, so wrapped lines
              and the caret align pixel-perfect with the highlight. */}
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-y-0 right-0"
            style={{
              left: gutterWidth,
              height: overlayHeight,
            }}
          >
            <textarea
              ref={textareaRef}
              value={value}
              onChange={(e) => {
                onChange(e.target.value)
                // Recompute the caret for the new value (fires before the
                // next paint so the highlight tracks typing).
                requestAnimationFrame(syncCaret)
              }}
              onKeyDown={handleKeyDown}
              onSelect={syncCaret}
              onMouseUp={syncCaret}
              onKeyUp={syncCaret}
              readOnly={readOnly}
              spellCheck={false}
              autoCapitalize="off"
              autoComplete="off"
              autoCorrect="off"
              autoFocus={autoFocus}
              placeholder=""
              aria-label="Code editor"
              className={cn(
                codeClasses,
                'pointer-events-auto h-full w-full resize-none overflow-hidden bg-transparent ' +
                  'text-transparent caret-[rgb(var(--color-primary))] selection:bg-primary/30 ' +
                  'placeholder:text-on-surface-variant/60',
              )}
              style={{
                paddingLeft: CODE_PAD_X,
                paddingRight: CODE_PAD_X,
                paddingTop: CODE_PAD_Y,
                paddingBottom: CODE_PAD_Y,
              }}
            />
          </div>

          {value === '' && (
            <div
              aria-hidden="true"
              className={cn(
                codeClasses,
                'pointer-events-none absolute text-on-surface-variant/60 whitespace-pre-wrap',
              )}
              style={{
                left: gutterWidth,
                right: 0,
                top: 0,
                paddingLeft: CODE_PAD_X,
                paddingRight: CODE_PAD_X,
                paddingTop: CODE_PAD_Y,
              }}
            >
              {placeholder}
            </div>
          )}
        </div>
      </div>

      {/* Scoped token palette — every color derives from the active theme */}
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
