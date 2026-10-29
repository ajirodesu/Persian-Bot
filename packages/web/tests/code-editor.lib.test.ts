import { describe, expect, it } from 'vitest'
import {
  indentSelection,
  insertNewlineWithIndent,
  lineColumnAt,
  outdentSelection,
} from '@/lib/code-editor.lib'

describe('lineColumnAt', () => {
  const value = 'abc\ndef\nghi'

  it('maps offsets to 1-based line/column pairs', () => {
    expect(lineColumnAt(value, 0)).toEqual({ line: 1, column: 1 })
    expect(lineColumnAt(value, 3)).toEqual({ line: 1, column: 4 })
    expect(lineColumnAt(value, 4)).toEqual({ line: 2, column: 1 })
    expect(lineColumnAt(value, value.length)).toEqual({ line: 3, column: 4 })
  })

  it('clamps offsets outside the text', () => {
    expect(lineColumnAt(value, -10)).toEqual({ line: 1, column: 1 })
    expect(lineColumnAt(value, 999)).toEqual({ line: 3, column: 4 })
  })
})

describe('indentSelection', () => {
  it('inserts an indent unit at a collapsed caret', () => {
    const edit = indentSelection('abc', 1, 1)
    expect(edit.value).toBe('a  bc')
    expect(edit.selectionStart).toBe(3)
    expect(edit.selectionEnd).toBe(3)
    expect(edit.insertText).toBe('  ')
  })

  it('indents a single-line selection without losing it', () => {
    const edit = indentSelection('abc', 1, 2)
    expect(edit.value).toBe('  abc')
    expect(edit.selectionStart).toBe(3)
    expect(edit.selectionEnd).toBe(4)
    expect(edit.value.slice(edit.selectionStart, edit.selectionEnd)).toBe('b')
  })

  it('indents every line touched by a multi-line selection', () => {
    const edit = indentSelection('a\nb\nc', 0, 5)
    expect(edit.value).toBe('  a\n  b\n  c')
    expect(edit.selectionStart).toBe(2)
    expect(edit.selectionEnd).toBe(11)
    expect(edit.value.slice(edit.selectionStart, edit.selectionEnd)).toBe(
      'a\n  b\n  c',
    )
  })

  it('does not indent a line that the selection only touches at its start', () => {
    const edit = indentSelection('a\nb', 0, 2)
    expect(edit.value).toBe('  a\nb')
    expect(edit.value.slice(edit.selectionStart, edit.selectionEnd)).toBe('a\n')
  })
})

describe('outdentSelection', () => {
  it('outdents the caret line when there is no selection', () => {
    const edit = outdentSelection('  abc', 4, 4)
    expect(edit.value).toBe('abc')
    expect(edit.selectionStart).toBe(2)
    expect(edit.selectionEnd).toBe(2)
  })

  it('removes a tab indent as one level', () => {
    const edit = outdentSelection('\tabc', 3, 3)
    expect(edit.value).toBe('abc')
    expect(edit.selectionStart).toBe(2)
  })

  it('outdents every selected line and preserves the selection', () => {
    const value = '  a\n    b\n  c'
    const edit = outdentSelection(value, 0, value.length)
    expect(edit.value).toBe('a\n  b\nc')
    expect(edit.value.slice(edit.selectionStart, edit.selectionEnd)).toBe(
      'a\n  b\nc',
    )
  })

  it('is a no-op for a flush-left line', () => {
    const edit = outdentSelection('abc', 1, 1)
    expect(edit.value).toBe('abc')
    expect(edit.selectionStart).toBe(1)
    expect(edit.selectionEnd).toBe(1)
    expect(edit.insertText).toBe('abc')
  })
})

describe('insertNewlineWithIndent', () => {
  it('keeps the current line indentation', () => {
    const edit = insertNewlineWithIndent('  const x = 1', 13, 13)
    expect(edit.value).toBe('  const x = 1\n  ')
    expect(edit.selectionStart).toBe(16)
    expect(edit.selectionEnd).toBe(16)
  })

  it('adds one level after an opening brace', () => {
    const edit = insertNewlineWithIndent('if (x) {', 8, 8)
    expect(edit.value).toBe('if (x) {\n  ')
    expect(edit.selectionStart).toBe(11)
  })

  it('opens a blank indented line between matching brackets', () => {
    const edit = insertNewlineWithIndent('if (x) {}', 8, 8)
    expect(edit.value).toBe('if (x) {\n  \n}')
    expect(edit.selectionStart).toBe(11)
    expect(edit.selectionEnd).toBe(11)
  })

  it('respects the indentation of a nested bracket pair', () => {
    const edit = insertNewlineWithIndent('  if (x) {}', 10, 10)
    expect(edit.value).toBe('  if (x) {\n    \n  }')
    expect(edit.selectionStart).toBe(15)
  })

  it('replaces a selection before applying indentation', () => {
    const edit = insertNewlineWithIndent('abc\ndef', 1, 5)
    expect(edit.value).toBe('a\nef')
    expect(edit.selectionStart).toBe(2)
  })

  it('does not add an indent after a non-opening line', () => {
    const edit = insertNewlineWithIndent('const x = 1', 11, 11)
    expect(edit.value).toBe('const x = 1\n')
    expect(edit.selectionStart).toBe(12)
  })
})
