import { describe, expect, it } from 'vitest'
import {
  buildLineStarts,
  lineColumnAt,
  lineColumnFromStarts,
  longestLineColumns,
  visualColumns,
} from '@/lib/code-editor.lib'

describe('indexed line/column mapping', () => {
  const value = 'one\ntwo\nthree'
  const starts = buildLineStarts(value)

  it('builds one line start per line', () => {
    expect(starts).toEqual([0, 4, 8])
  })

  it('matches the naive calculation at every offset', () => {
    for (let offset = 0; offset <= value.length; offset += 1) {
      expect(lineColumnFromStarts(starts, offset, value.length)).toEqual(
        lineColumnAt(value, offset),
      )
    }
  })

  it('clamps out-of-range offsets', () => {
    expect(lineColumnFromStarts(starts, -5, value.length)).toEqual({
      line: 1,
      column: 1,
    })
    expect(lineColumnFromStarts(starts, 999, value.length)).toEqual({
      line: 3,
      column: 6,
    })
  })
})

describe('longestLineColumns', () => {
  it('expands tabs to the next tab stop', () => {
    expect(longestLineColumns('a\n\tb\n12345')).toBe(5)
  })

  it('handles an empty document', () => {
    expect(longestLineColumns('')).toBe(0)
  })
})

describe('visualColumns', () => {
  it('counts plain characters one cell each', () => {
    expect(visualColumns('abc')).toBe(3)
    expect(visualColumns('')).toBe(0)
  })

  it('expands tabs to the next multiple of the tab size', () => {
    expect(visualColumns('\t')).toBe(4)
    expect(visualColumns('a\t')).toBe(4)
    expect(visualColumns('abcd\t')).toBe(8)
    expect(visualColumns('\t\tx')).toBe(9)
  })

  it('supports a custom tab size', () => {
    expect(visualColumns('ab\tc', 2)).toBe(5)
  })
})
