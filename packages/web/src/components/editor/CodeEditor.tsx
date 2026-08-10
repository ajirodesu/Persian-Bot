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

import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { highlightToHtml } from '@/lib/syntax-highlight.lib'
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
  /** Renders a lightweight minimap on the right edge (Replit-style). */
  showMinimap?: boolean
}

/** Shared metrics — MUST be identical on both layers for alignment. */
const surfaceClasses =
  'font-mono text-[13px] leading-6 tracking-normal [tab-size:4] p-4 ' +
  'whitespace-pre border-0 outline-none shadow-none'

/** Line height (leading-6 = 1.5rem = 24px) and total vertical padding (p-4). */
const LINE_HEIGHT = 24
const V_PADDING = 32

/** Horizontal gap between the rightmost digit and the code (GitHub-like). */
const GUTTER_PAD_RIGHT = 16

/** Width reserved for the right-edge minimap when enabled. */
const MINIMAP_WIDTH = 44

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
  showMinimap = true,
}: CodeEditorProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const preRef = useRef<HTMLPreElement>(null)
  const gutterRef = useRef<HTMLDivElement>(null)

  const [scrollTop, setScrollTop] = useState(0)
  const [caretLine, setCaretLine] = useState(1)
  const [caretColumn, setCaretColumn] = useState(1)
  const [showMinimapState, setShowMinimapState] = useState(true)

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
    () => Math.max(48, String(lineCount).length * 12 + GUTTER_PAD_RIGHT),
    [lineCount],
  )

  // Report the caret position whenever it moves (drives the status bar Ln/Col).
  useEffect(() => {
    onCursor?.({ line: caretLine, column: caretColumn })
  }, [caretLine, caretColumn, onCursor])

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
    setCaretLine(line)
    setCaretColumn(pos - lineStart + 1)
  }, [value])

  // Keep the highlight layer and the gutter in lockstep with the caret.
  const handleScroll = useCallback(() => {
    const ta = textareaRef.current
    const pre = preRef.current
    const gutter = gutterRef.current
    if (ta) setScrollTop(ta.scrollTop)
    if (ta && pre) {
      pre.scrollTop = ta.scrollTop
      pre.scrollLeft = ta.scrollLeft
    }
    if (ta && gutter) {
      gutter.scrollTop = ta.scrollTop
      gutter.style.transform = `translate3d(${-ta.scrollLeft}px, 0, 0)`
    }
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
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        // Ctrl/Cmd+K toggles the minimap (Replit-adjacent convenience).
        e.preventDefault()
        setShowMinimapState((p) => !p)
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

  // Minimap: one strip per line whose width mirrors the line's character
  // count (capped) so the map roughly reflects the file's shape. Follows the
  // textarea scroll via the shared scrollTop state.
  const minimapLines = useMemo(() => {
    const lines = value.split('\n')
    return lines.map((line) => ({
      width: Math.min(1, line.replace(/\s/g, '').length / 60),
      hasContent: line.trim().length > 0,
    }))
  }, [value])

  const activeLineIndicatorTop =
    V_PADDING / 2 + (caretLine - 1) * LINE_HEIGHT - scrollTop

  return (
    <div
      className={cn(
        'code-editor relative w-full overflow-hidden ' +
          'border border-outline-variant bg-surface-container-lowest ' +
          'focus-within:border-primary focus-within:shadow-[var(--shadow-focus-ring,none)]',
        fillHeight && 'h-full',
        className,
      )}
      style={fillHeight ? undefined : { minHeight, height: contentHeight }}
    >
      {/* Active-line highlight — tracks the caret, Replit/VS Code style */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 z-[0] h-6 bg-primary/[0.06]"
        style={{ top: activeLineIndicatorTop }}
      />

      {/* Line-number gutter — shares font metrics so numbers stay aligned.
          Like GitHub, it scrolls horizontally together with the code (translated
          by -scrollLeft in handleScroll) and stays locked to the left of each
          line as both slide out of view. Opaque background keeps the numbers
          readable while the code scrolls beneath. */}
      <div
        ref={gutterRef}
        aria-hidden="true"
        className={cn(
          surfaceClasses,
          'absolute left-0 top-0 bottom-0 z-[1] overflow-hidden select-none pointer-events-none ' +
            'border-r border-outline-variant/50 bg-surface-container-highest text-right ' +
            'text-on-surface-variant/55 [font-variant-numeric:tabular-nums] whitespace-pre',
        )}
        style={{ width: gutterWidth, paddingRight: GUTTER_PAD_RIGHT, paddingLeft: 0 }}
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
        style={{
          paddingLeft: gutterWidth,
          paddingRight: showMinimap && showMinimapState ? MINIMAP_WIDTH : 0,
        }}
        dangerouslySetInnerHTML={{ __html: highlighted }}
      />

      {/* Input layer — transparent text, visible caret */}
      <textarea
        ref={textareaRef}
        value={value}
        onChange={(e) => {
          onChange(e.target.value)
          // Recompute the caret for the new value (fires before the next
          // paint so the active-line highlight tracks typing).
          requestAnimationFrame(syncCaret)
        }}
        onScroll={handleScroll}
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
        style={{
          paddingLeft: gutterWidth,
          paddingRight: showMinimap && showMinimapState ? MINIMAP_WIDTH : 0,
        }}
      />

      {/* Minimap — Replit-style right-edge file overview */}
      {showMinimap && showMinimapState && (
        <div
          aria-hidden="true"
          className="absolute inset-y-0 right-0 z-[1] w-11 overflow-hidden border-l border-outline-variant/20 bg-surface-container-highest/70 pointer-events-none select-none"
        >
          <div className="relative h-full w-full">
            {minimapLines.map((line, ln) => (
              <div
                key={ln}
                className="absolute left-0.5 right-0.5"
                style={{ top: ln * 3 - scrollTop * (3 / LINE_HEIGHT), height: 2 }}
              >
                <div
                  className={cn(
                    'h-full rounded-[1px]',
                    line.hasContent ? 'bg-on-surface/25' : 'bg-on-surface/10',
                  )}
                  style={{ width: `${line.width * 100}%` }}
                />
              </div>
            ))}
            {/* Viewport indicator */}
            <div
              className="absolute inset-x-0 border-y border-primary/40 bg-primary/10"
              style={{ top: scrollTop * (3 / LINE_HEIGHT), height: 72 }}
            />
          </div>
        </div>
      )}

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
