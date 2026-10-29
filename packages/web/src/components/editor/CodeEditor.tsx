/**
 * CodeEditor — dependency-free source editor for the Files panels.
 *
 * The textarea is the real editing surface (selection, IME, undo, accessibility)
 * and is laid over a syntax-coloured visual layer. Both use identical
 * monospace metrics.
 *
 * Performance model:
 * - The document does not wrap. Horizontal scrolling keeps one visual row per
 *   logical line, so row offsets are arithmetic (24 px each) instead of layout
 *   measurements.
 * - Only the rows intersecting the viewport (plus overscan) are rendered. A
 *   5,000-line file therefore mounts ~50 rows, not 15,000 DOM nodes.
 * - Syntax highlighting is computed only under `CODE_HIGHLIGHT_MAX_CHARS`;
 *   larger files stay plain text but remain fully editable.
 * - Caret → line/column uses a precomputed line-start index (O(log n)), not a
 *   full document scan on every key/selection event.
 * - The textarea keeps native undo (edits go through `execCommand` with a
 *   controlled fallback), and the browser still owns selection/IME behaviour.
 *
 * Features:
 *   • Tab / Shift+Tab indent and outdent the selection (or the caret line)
 *   • Enter keeps indentation and opens bracket pairs cleanly
 *   • Ctrl/Cmd+S triggers the optional onSave callback
 *   • Inline mode grows with content; `fillHeight` fills and scrolls the parent
 */

import {
  memo,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import {
  buildLineStarts,
  indentSelection,
  insertNewlineWithIndent,
  lineColumnFromStarts,
  longestLineColumns,
  outdentSelection,
  visualColumns,
  type TextEdit,
} from '@/lib/code-editor.lib'
import {
  highlightToHtml,
  splitHighlightedHtml,
} from '@/lib/syntax-highlight.lib'
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
  /** Accessible name for the editing surface. */
  ariaLabel?: string
}

/** Documents above this stay plain text — tokenising them per keystroke is not worth the jank. */
export const CODE_HIGHLIGHT_MAX_CHARS = 80_000

/** Fixed visual row height; must match the textarea's line-height. */
const LINE_HEIGHT = 24
/** Horizontal gap between the rightmost digit and the code (GitHub-like). */
const GUTTER_PAD_RIGHT = 16
/** Inner horizontal padding of the code column, each side. */
const CODE_PAD_X = 16
/** Inner vertical padding of the whole surface, top and bottom. */
const CODE_PAD_Y = 16
/** Rows rendered beyond the viewport to avoid blank edges while fast-scrolling. */
const OVERSCAN = 12

/** Shared code metrics — MUST be identical on rows and the textarea. */
const codeClasses =
  'font-mono text-[13px] leading-6 tracking-normal [tab-size:4] ' +
  'whitespace-pre border-0 outline-none shadow-none'

/** Textareas normalise CRLF/CR to LF; do the same before rendering rows. */
function normalizeNewlines(value: string): string {
  return value.replaceAll('\r\n', '\n').replaceAll('\r', '\n')
}

/** Measures the loaded monospace advance width so horizontal extents are exact. */
function measureCharWidth(): number {
  const probe = document.createElement('span')
  probe.className = codeClasses
  probe.style.cssText =
    'position:absolute;left:-9999px;top:0;visibility:hidden;white-space:pre;'
  probe.textContent = 'M'.repeat(64)
  document.body.appendChild(probe)
  const width = probe.getBoundingClientRect().width / 64
  probe.remove()
  return Number.isFinite(width) && width > 0 ? width : 7.8
}

const CodeRow = memo(function CodeRow({
  lineNumber,
  text,
  html,
  active,
  gutterWidth,
  codeWidth,
}: {
  lineNumber: number
  text: string
  html: string | undefined
  active: boolean
  gutterWidth: number
  codeWidth: number
}) {
  return (
    <div
      className={cn(
        'absolute left-0 right-0 flex',
        active && 'bg-primary/[0.06]',
      )}
      style={{
        top: CODE_PAD_Y + (lineNumber - 1) * LINE_HEIGHT,
        height: LINE_HEIGHT,
      }}
    >
      <div
        className="sticky left-0 z-[1] shrink-0 select-none bg-surface-container-lowest text-right font-mono text-[13px] leading-6 text-on-surface-variant/55 [font-variant-numeric:tabular-nums]"
        style={{ width: gutterWidth, paddingRight: GUTTER_PAD_RIGHT }}
      >
        {lineNumber}
      </div>
      <div
        className={cn(codeClasses, 'flex-1 min-w-0 text-on-surface')}
        style={{
          width: codeWidth,
          paddingLeft: CODE_PAD_X,
          paddingRight: CODE_PAD_X,
        }}
        {...(html !== undefined
          ? { dangerouslySetInnerHTML: { __html: html || ' ' } }
          : { children: text || ' ' })}
      />
    </div>
  )
})

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
  ariaLabel = 'Code editor',
}: CodeEditorProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const pendingSelection = useRef<{ start: number; end: number } | null>(null)
  const scrollRaf = useRef<number | null>(null)
  const helpId = useId()

  const text = useMemo(() => normalizeNewlines(value), [value])
  const textRef = useRef(text)
  const lines = useMemo(() => text.split('\n'), [text])
  const lineCount = lines.length
  const lineStarts = useMemo(() => buildLineStarts(text), [text])

  const [caretLine, setCaretLine] = useState(1)
  const [caretColumn, setCaretColumn] = useState(1)
  const [scrollTop, setScrollTop] = useState(0)
  const [viewport, setViewport] = useState({ width: 800, height: 600 })
  const [charWidth, setCharWidth] = useState(7.8)

  const gutterWidth = useMemo(
    () => Math.max(48, String(lineCount).length * 12 + GUTTER_PAD_RIGHT),
    [lineCount],
  )
  const maxColumns = useMemo(() => longestLineColumns(text), [text])
  const maxLineWidth = Math.max(1, maxColumns * charWidth + CODE_PAD_X * 2)
  // Width of the code column (everything to the right of the gutter). At
  // minimum it fills the viewport; for long lines it grows to the widest line
  // so the textarea never needs to scroll internally.
  const codeWidth = Math.max(maxLineWidth, viewport.width - gutterWidth)
  const contentHeight = lineCount * LINE_HEIGHT + CODE_PAD_Y * 2

  const showHighlight =
    language != null &&
    language !== '' &&
    text.length <= CODE_HIGHLIGHT_MAX_CHARS
  const htmlRows = useMemo(() => {
    if (!showHighlight) return null
    const rows = splitHighlightedHtml(highlightToHtml(text, language ?? null))
    while (rows.length < lineCount) rows.push('')
    return rows.slice(0, lineCount)
  }, [showHighlight, text, language, lineCount])

  // Measure the real font advance and viewport; re-measure after webfonts load.
  useLayoutEffect(() => {
    const scroller = scrollRef.current
    let cancelled = false
    const measureViewport = () => {
      if (!scroller) return
      const width = scroller.clientWidth
      const height = scroller.clientHeight
      setViewport((prev) =>
        prev.width === width && prev.height === height
          ? prev
          : { width, height },
      )
    }
    const measureFont = () => {
      if (cancelled) return
      const width = measureCharWidth()
      setCharWidth((prev) => (Math.abs(prev - width) < 0.05 ? prev : width))
    }
    measureViewport()
    measureFont()
    document.fonts?.ready.then(measureFont).catch(() => undefined)

    if (!scroller || typeof ResizeObserver === 'undefined') {
      return () => {
        cancelled = true
      }
    }
    const observer = new ResizeObserver(measureViewport)
    observer.observe(scroller)
    return () => {
      cancelled = true
      observer.disconnect()
    }
  }, [])

  // Report the caret position whenever it moves (drives the status bar Ln/Col).
  useEffect(() => {
    onCursor?.({ line: caretLine, column: caretColumn })
  }, [caretLine, caretColumn, onCursor])

  // Keep the caret's row and column visible inside the scroll container.
  const ensureCaretVisible = useCallback(
    (line: number, column: number) => {
      const scroller = scrollRef.current
      if (!scroller) return
      const top = CODE_PAD_Y + (line - 1) * LINE_HEIGHT
      const bottom = top + LINE_HEIGHT
      const viewTop = scroller.scrollTop
      const viewBottom = viewTop + scroller.clientHeight
      if (top < viewTop) scroller.scrollTop = Math.max(0, top - CODE_PAD_Y)
      else if (bottom > viewBottom)
        scroller.scrollTop = bottom - scroller.clientHeight

      // Tabs occupy up to four cells; measuring the visual prefix keeps the
      // caret (and the scroll-into-view edge) correct on tab-indented lines.
      const ta = textareaRef.current
      const lineStart = lineStarts[line - 1] ?? 0
      const prefix = ta?.value.slice(lineStart, lineStart + column - 1) ?? ''
      const x = gutterWidth + CODE_PAD_X + visualColumns(prefix) * charWidth
      const viewLeft = scroller.scrollLeft + gutterWidth
      const viewRight = scroller.scrollLeft + scroller.clientWidth
      if (x < viewLeft)
        scroller.scrollLeft = Math.max(0, x - gutterWidth - CODE_PAD_X)
      else if (x > viewRight - CODE_PAD_X) {
        scroller.scrollLeft = x - scroller.clientWidth + CODE_PAD_X + charWidth
      }
    },
    [charWidth, gutterWidth, lineStarts],
  )

  const syncCaret = useCallback(() => {
    const ta = textareaRef.current
    if (!ta) return
    // A native input can beat React's commit. Mapping it with the previous
    // line index would report a wrong Ln/Col, so let the layout effect below
    // sync once the new value is committed.
    if (ta.value !== textRef.current) return
    const { line, column } = lineColumnFromStarts(
      lineStarts,
      ta.selectionStart,
      ta.value.length,
    )
    setCaretLine(line)
    setCaretColumn(column)
    ensureCaretVisible(line, column)
  }, [ensureCaretVisible, lineStarts])

  // The textarea is intentionally uncontrolled: the browser already owns the
  // value while typing, and re-assigning a multi-hundred-kilobyte `value` prop
  // on every keystroke forces an avoidable full-document update. External
  // changes (file switch, refresh, programmatic edit) are synced here.
  useLayoutEffect(() => {
    const ta = textareaRef.current
    if (!ta) return
    textRef.current = text
    if (ta.value !== text) {
      // External content replacement starts at the document top; a programmatic
      // edit's intended selection is restored from `pendingSelection` below.
      ta.value = text
      ta.setSelectionRange(0, 0)
    }

    const pending = pendingSelection.current
    if (pending) {
      pendingSelection.current = null
      const start = Math.min(pending.start, ta.value.length)
      const end = Math.min(pending.end, ta.value.length)
      ta.setSelectionRange(start, end)
    }
    syncCaret()
  }, [text, syncCaret])

  const handleScroll = useCallback(() => {
    if (scrollRaf.current !== null) return
    scrollRaf.current = requestAnimationFrame(() => {
      scrollRaf.current = null
      const scroller = scrollRef.current
      if (scroller) setScrollTop(scroller.scrollTop)
    })
  }, [])

  // The textarea is sized to the full document, so it should never scroll on
  // its own. If the browser still scrolls it to reveal the caret (wide glyphs,
  // fractional advances), transfer that delta to the real scroller and reset
  // it — otherwise the transparent text would drift away from the highlight.
  const handleTextareaScroll = useCallback(() => {
    const ta = textareaRef.current
    const scroller = scrollRef.current
    if (!ta || !scroller) return
    if (ta.scrollLeft !== 0) {
      scroller.scrollLeft += ta.scrollLeft
      ta.scrollLeft = 0
    }
    if (ta.scrollTop !== 0) {
      scroller.scrollTop += ta.scrollTop
      ta.scrollTop = 0
    }
  }, [])

  useEffect(
    () => () => {
      if (scrollRaf.current !== null) cancelAnimationFrame(scrollRaf.current)
    },
    [],
  )

  /**
   * Applies an edit through execCommand when available so the browser keeps a
   * native undo entry. The controlled value is always fed back explicitly too.
   */
  const commitEdit = useCallback(
    (edit: TextEdit) => {
      const ta = textareaRef.current
      if (!ta) return

      if (edit.value === ta.value) {
        pendingSelection.current = null
        ta.setSelectionRange(edit.selectionStart, edit.selectionEnd)
        syncCaret()
        return
      }

      pendingSelection.current = {
        start: edit.selectionStart,
        end: edit.selectionEnd,
      }
      ta.focus()
      try {
        ta.setSelectionRange(edit.replaceStart, edit.replaceEnd)
        document.execCommand('insertText', false, edit.insertText)
      } catch {
        // The controlled fallback below is authoritative.
      }
      onChange(edit.value)
    },
    [onChange, syncCaret],
  )

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault()
        onSave?.()
        return
      }

      if (e.nativeEvent.isComposing) return
      // Escape is the documented keyboard exit from the Tab-indent behaviour
      // (WCAG 2.1.2): without it, keyboard users could not Tab out of the
      // editor. It must not fire mid-composition, where Escape cancels the IME.
      if (e.key === 'Escape') {
        e.currentTarget.blur()
        return
      }

      if (readOnly) return
      if (e.ctrlKey || e.metaKey || e.altKey) return

      const ta = e.currentTarget
      if (e.key === 'Tab') {
        e.preventDefault()
        commitEdit(
          e.shiftKey
            ? outdentSelection(ta.value, ta.selectionStart, ta.selectionEnd)
            : indentSelection(ta.value, ta.selectionStart, ta.selectionEnd),
        )
        return
      }

      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault()
        commitEdit(
          insertNewlineWithIndent(ta.value, ta.selectionStart, ta.selectionEnd),
        )
      }
    },
    [commitEdit, onSave, readOnly],
  )

  const firstVisible = Math.max(
    0,
    Math.floor((scrollTop - CODE_PAD_Y) / LINE_HEIGHT) - OVERSCAN,
  )
  const lastVisible = Math.min(
    lineCount,
    Math.ceil((scrollTop + viewport.height - CODE_PAD_Y) / LINE_HEIGHT) +
      OVERSCAN,
  )

  const rows: React.ReactNode[] = []
  for (let i = firstVisible; i < lastVisible; i += 1) {
    const lineText = lines[i] ?? ''
    rows.push(
      <CodeRow
        key={i}
        lineNumber={i + 1}
        text={lineText}
        html={htmlRows ? htmlRows[i] : undefined}
        active={i + 1 === Math.min(caretLine, lineCount)}
        gutterWidth={gutterWidth}
        codeWidth={codeWidth}
      />,
    )
  }

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
      <div
        ref={scrollRef}
        onScroll={handleScroll}
        className="h-full w-full overflow-auto overscroll-contain"
        style={fillHeight ? undefined : { maxHeight: '70vh' }}
      >
        <div
          className="relative"
          style={{
            height: contentHeight,
            width: gutterWidth + codeWidth,
            minWidth: '100%',
          }}
        >
          <div aria-hidden="true">{rows}</div>

          {text === '' && (
            <div
              aria-hidden="true"
              className={cn(
                codeClasses,
                'pointer-events-none absolute text-on-surface-variant/80',
              )}
              style={{
                left: gutterWidth + CODE_PAD_X,
                top: CODE_PAD_Y,
                right: CODE_PAD_X,
              }}
            >
              {placeholder}
            </div>
          )}

          <textarea
            ref={textareaRef}
            defaultValue={text}
            onChange={(e) => onChange(e.target.value)}
            onKeyDown={handleKeyDown}
            onScroll={handleTextareaScroll}
            onSelect={syncCaret}
            onMouseUp={syncCaret}
            onKeyUp={syncCaret}
            onClick={syncCaret}
            onFocus={syncCaret}
            readOnly={readOnly}
            spellCheck={false}
            wrap="off"
            autoCapitalize="off"
            autoComplete="off"
            autoCorrect="off"
            autoFocus={autoFocus}
            placeholder=""
            aria-label={ariaLabel}
            aria-describedby={helpId}
            className={cn(
              codeClasses,
              'absolute block resize-none overflow-hidden bg-transparent ' +
                'text-transparent caret-[rgb(var(--color-primary))] selection:bg-primary/30',
            )}
            style={{
              left: gutterWidth,
              top: CODE_PAD_Y,
              width: codeWidth,
              height: lineCount * LINE_HEIGHT,
              paddingLeft: CODE_PAD_X,
              paddingRight: CODE_PAD_X,
              paddingTop: 0,
              paddingBottom: 0,
            }}
          />
          <span id={helpId} className="sr-only">
            Tab indents, Shift+Tab outdents, and Escape moves focus out of the
            editor.
          </span>
        </div>
      </div>

      {/* Scoped token palette — every colour derives from the active theme */}
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
