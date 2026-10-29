/**
 * code-editor.lib — pure text-editing primitives for the overlay code editor.
 *
 * All offsets are UTF-16 string offsets (the same units used by textarea
 * selectionStart/selectionEnd) into LF-normalized text. Keeping the edit
 * maths here makes indentation, outdenting and auto-indent deterministic and
 * unit-testable without a DOM.
 */

export const INDENT_UNIT = '  '

export interface TextEdit {
  /** Full next value, used as the controlled fallback. */
  value: string
  selectionStart: number
  selectionEnd: number
  /** Minimal range replaced by `insertText` (for undo-preserving insertion). */
  replaceStart: number
  replaceEnd: number
  insertText: string
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max)
}

/** Offsets at which each line starts; index 0 is always 0. O(n) once per document. */
export function buildLineStarts(value: string): number[] {
  const starts = [0]
  for (let i = 0; i < value.length; i += 1) {
    if (value.charCodeAt(i) === 10) starts.push(i + 1)
  }
  return starts
}

/**
 * Maps an offset to 1-based line/column using a precomputed line-start index.
 * O(log n), safe to call on every caret/selection event in large files.
 */
export function lineColumnFromStarts(
  starts: readonly number[],
  offset: number,
  valueLength: number,
): { line: number; column: number } {
  const pos = clamp(offset, 0, valueLength)
  let low = 0
  let high = starts.length - 1
  while (low <= high) {
    const mid = (low + high) >>> 1
    if ((starts[mid] ?? 0) <= pos) low = mid + 1
    else high = mid - 1
  }
  const lineIndex = Math.max(0, high)
  const lineStart = starts[lineIndex] ?? 0
  return { line: lineIndex + 1, column: pos - lineStart + 1 }
}

/** Maps a textarea offset to a 1-based line/column pair. */
export function lineColumnAt(
  value: string,
  offset: number,
): { line: number; column: number } {
  return lineColumnFromStarts(buildLineStarts(value), offset, value.length)
}

/**
 * Visual columns of the longest line, with tabs expanded. Used for the
 * virtualized surface's horizontal content width (monospace character cells).
 */
export function longestLineColumns(value: string, tabSize = 4): number {
  let longest = 0
  let columns = 0
  for (let i = 0; i < value.length; i += 1) {
    const code = value.charCodeAt(i)
    if (code === 10) {
      if (columns > longest) longest = columns
      columns = 0
    } else if (code === 9) {
      columns += tabSize - (columns % tabSize)
    } else {
      columns += 1
    }
  }
  return Math.max(longest, columns)
}

/**
 * Visual width of a single line prefix, with tabs expanded to the next tab
 * stop. Used to place the caret horizontally without splitting the document.
 */
export function visualColumns(prefix: string, tabSize = 4): number {
  let columns = 0
  for (let i = 0; i < prefix.length; i += 1) {
    if (prefix.charCodeAt(i) === 9) {
      columns += tabSize - (columns % tabSize)
    } else {
      columns += 1
    }
  }
  return columns
}

function lineStartAt(value: string, offset: number): number {
  const pos = clamp(offset, 0, value.length)
  return value.lastIndexOf('\n', pos - 1) + 1
}

function lineEndAt(value: string, offset: number): number {
  const end = value.indexOf('\n', clamp(offset, 0, value.length))
  return end === -1 ? value.length : end
}

interface LineRange {
  firstLineStart: number
  lastLineEnd: number
}

/**
 * The lines touched by a selection. A selection ending exactly at the start
 * of a line does not include that line (standard editor behaviour).
 */
function selectedLineRange(
  value: string,
  start: number,
  end: number,
): LineRange {
  const firstLineStart = lineStartAt(value, start)
  const lastIndex = end > start && value[end - 1] === '\n' ? end - 1 : end
  const lastLineEnd = lineEndAt(value, Math.max(firstLineStart, lastIndex))
  return { firstLineStart, lastLineEnd }
}

function makeEdit(
  value: string,
  selectionStart: number,
  selectionEnd: number,
  replaceStart: number,
  replaceEnd: number,
  insertText: string,
): TextEdit {
  return {
    value,
    selectionStart,
    selectionEnd,
    replaceStart,
    replaceEnd,
    insertText,
  }
}

/** One indentation level removed from the front of a line. */
function leadingIndentWidth(line: string, unit: string): number {
  if (line.startsWith('\t')) return 1
  let width = 0
  while (width < unit.length && line[width] === ' ') width++
  return width
}

/**
 * Inserts one indent unit at the caret, or indents every selected line.
 * Selection offsets are adjusted so the same source text stays selected.
 */
export function indentSelection(
  value: string,
  start: number,
  end: number,
  unit = INDENT_UNIT,
): TextEdit {
  const from = clamp(start, 0, value.length)
  const to = clamp(end, from, value.length)

  if (from === to) {
    const next = value.slice(0, from) + unit + value.slice(to)
    return makeEdit(
      next,
      from + unit.length,
      from + unit.length,
      from,
      to,
      unit,
    )
  }

  const { firstLineStart, lastLineEnd } = selectedLineRange(value, from, to)
  const target = value.slice(firstLineStart, lastLineEnd)
  const lines = target.split('\n')
  const insertText = lines.map((line) => unit + line).join('\n')
  const next =
    value.slice(0, firstLineStart) + insertText + value.slice(lastLineEnd)

  return makeEdit(
    next,
    from + unit.length,
    to + unit.length * lines.length,
    firstLineStart,
    lastLineEnd,
    insertText,
  )
}

/**
 * Removes one indentation level from every selected line, or from the
 * caret's line when there is no selection. No-op edits are returned when the
 * line is already flush-left.
 */
export function outdentSelection(
  value: string,
  start: number,
  end: number,
  unit = INDENT_UNIT,
): TextEdit {
  const from = clamp(start, 0, value.length)
  const to = clamp(end, from, value.length)
  const { firstLineStart, lastLineEnd } = selectedLineRange(value, from, to)
  const target = value.slice(firstLineStart, lastLineEnd)
  const lines = target.split('\n')

  let removedFirst = 0
  let removedTotal = 0
  const outdented = lines.map((line, index) => {
    const removed = leadingIndentWidth(line, unit)
    if (index === 0) removedFirst = removed
    removedTotal += removed
    return line.slice(removed)
  })

  const insertText = outdented.join('\n')
  if (insertText === target) {
    return makeEdit(value, from, to, firstLineStart, lastLineEnd, target)
  }

  const next =
    value.slice(0, firstLineStart) + insertText + value.slice(lastLineEnd)
  const nextStart = Math.max(firstLineStart, from - removedFirst)
  const nextEnd = Math.max(nextStart, to - removedTotal)

  return makeEdit(
    next,
    nextStart,
    nextEnd,
    firstLineStart,
    lastLineEnd,
    insertText,
  )
}

/**
 * Enter handling with indentation. When the caret sits between a matching
 * bracket pair, the new line is opened and the caret lands on its own
 * indented blank line.
 */
export function insertNewlineWithIndent(
  value: string,
  start: number,
  end: number,
  unit = INDENT_UNIT,
): TextEdit {
  const from = clamp(start, 0, value.length)
  const to = clamp(end, from, value.length)
  const before = value.slice(0, from)
  const after = value.slice(to)

  const lineStart = lineStartAt(value, from)
  const linePrefix = value.slice(lineStart, from)
  const indent = /^[ \t]*/.exec(linePrefix)?.[0] ?? ''
  const trimmed = linePrefix.replace(/[ \t]+$/, '')
  const last = trimmed.at(-1) ?? ''
  const pairs: Record<string, string> = { '{': '}', '[': ']', '(': ')' }
  const closing = pairs[last]
  const nextNonSpace = /^[ \t]*([}\])])/.exec(after)?.[1] ?? ''

  let insertText: string
  let caretOffset: number

  if (closing && nextNonSpace === closing) {
    const inner = indent + unit
    insertText = `\n${inner}\n${indent}`
    caretOffset = 1 + inner.length
  } else {
    const extra = closing ? unit : ''
    insertText = `\n${indent}${extra}`
    caretOffset = insertText.length
  }

  const next = before + insertText + after
  const caret = from + caretOffset
  return makeEdit(next, caret, caret, from, to, insertText)
}
