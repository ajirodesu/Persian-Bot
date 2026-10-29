import { describe, expect, it } from 'vitest'
import {
  highlightToHtml,
  splitHighlightedHtml,
} from '@/lib/syntax-highlight.lib'

function openSpans(row: string): number {
  return row.match(/<span\b/g)?.length ?? 0
}

function closeSpans(row: string): number {
  return row.match(/<\/span>/g)?.length ?? 0
}

describe('highlightToHtml', () => {
  it('highlights double-quoted strings in TypeScript', () => {
    const html = highlightToHtml('const s = "hello"', 'typescript')
    expect(html).toContain('<span class="tok-keyword">const</span>')
    expect(html).toContain('<span class="tok-string">&quot;hello&quot;</span>')
  })

  it('keeps escaped quotes inside double-quoted strings', () => {
    const html = highlightToHtml('const s = "a \\"b\\" c"', 'typescript')
    expect(html).toContain(
      '<span class="tok-string">&quot;a \\&quot;b\\&quot; c&quot;</span>',
    )
  })

  it('highlights JSON keys, values, literals and numbers', () => {
    const html = highlightToHtml(
      '{"name": "cat", "ok": true, "count": 42, "none": null}',
      'json',
    )
    expect(html).toContain('<span class="tok-property">&quot;name&quot;</span>')
    expect(html).toContain('<span class="tok-string">&quot;cat&quot;</span>')
    expect(html).toContain('<span class="tok-keyword">true</span>')
    expect(html).toContain('<span class="tok-number">42</span>')
    expect(html).toContain('<span class="tok-keyword">null</span>')
  })

  it('highlights double-quoted CSS strings', () => {
    const html = highlightToHtml('.a { content: "hi"; }', 'css')
    expect(html).toContain('<span class="tok-string">&quot;hi&quot;</span>')
    expect(html).toContain('<span class="tok-property">content</span>')
  })

  it('keeps a > inside an HTML attribute from ending the tag', () => {
    const html = highlightToHtml('<div title="a > b">x</div>', 'html')
    expect(html).toContain('<span class="tok-attr">title</span>')
    expect(html).toContain(
      '<span class="tok-string">&quot;a &gt; b&quot;</span>',
    )
    expect(html).toContain('<span class="tok-tag">div</span>')
  })

  it('does not treat a tag-shaped string as JSX', () => {
    const html = highlightToHtml('const s = "<div>"', 'tsx')
    expect(html).toContain(
      '<span class="tok-string">&quot;&lt;div&gt;&quot;</span>',
    )
    expect(html).not.toContain('<span class="tok-tag">div</span>')
  })

  it('renders JSX text with apostrophes and nested expressions', () => {
    const html = highlightToHtml("const view = <p>It's {user.name}</p>", 'tsx')
    expect(html).toContain('<span class="tok-tag">p</span>')
    expect(html).toContain("It's ")
    expect(html).toContain('user.name')
    expect(html).toContain('<span class="tok-punct">&lt;/</span>')
  })

  it('does not confuse comparisons or generics with JSX', () => {
    const comparison = highlightToHtml('const ok = a < b', 'tsx')
    expect(comparison).toContain('a &lt; b')
    expect(comparison).not.toContain('tok-tag')

    const generic = highlightToHtml('foo<Bar>(value)', 'tsx')
    expect(generic).toContain('foo&lt;')
    expect(generic).not.toContain('tok-tag')

    const annotation = highlightToHtml('const xs: Array<Foo> = []', 'tsx')
    expect(annotation).not.toContain('tok-tag')

    const promise = highlightToHtml(
      'const p: Promise<Result> = load()',
      'tsx',
    )
    expect(promise).not.toContain('tok-tag')

    const genericArrow = highlightToHtml('const f = <T,>(v: T) => v', 'tsx')
    expect(genericArrow).not.toContain('tok-tag')
  })

  it('still finds JSX after return, arrows and ternaries', () => {
    for (const source of [
      'return <div>hi</div>',
      'const x = () => <div />',
      'const x = ok ? <A /> : <B />',
      'const x = <my-widget />',
    ]) {
      expect(highlightToHtml(source, 'tsx')).toContain('<span class="tok-tag">')
    }
  })

  it('supports self-closing tags, fragments and void elements', () => {
    const selfClosing = highlightToHtml('const x = <Icon size={2} />', 'tsx')
    expect(selfClosing).toContain('<span class="tok-tag">Icon</span>')

    const fragment = highlightToHtml('const x = <>hello</>', 'tsx')
    expect(fragment).toContain(
      '<span class="tok-punct">&lt;&gt;</span>hello<span class="tok-punct">&lt;/&gt;</span>',
    )

    const br = highlightToHtml('const x = <div><br />after</div>', 'tsx')
    expect(br).toContain('<span class="tok-tag">br</span>')
    expect(br).toContain('after')
  })

  it('renders plain text without tokenizing it', () => {
    expect(highlightToHtml('const x = "1" < 2', null)).toBe(
      'const x = &quot;1&quot; &lt; 2',
    )
    expect(highlightToHtml('<b>const</b>', 'text')).toBe(
      '&lt;b&gt;const&lt;/b&gt;',
    )
  })

  it('escapes source so markup cannot escape the token spans', () => {
    const html = highlightToHtml('<script>alert("x")</script>', 'html')
    expect(html).not.toContain('<script>')
    expect(html).toContain('<span class="tok-tag">script</span>')
    expect(html).toContain('&lt;/')
    expect(html).toContain('&quot;x&quot;')
  })
})

describe('splitHighlightedHtml', () => {
  it('preserves the logical line count', () => {
    const rows = splitHighlightedHtml(
      highlightToHtml('const a = 1\nconst b = 2\n', 'typescript'),
    )
    expect(rows).toHaveLength(3)
  })

  it('re-opens and closes spans that cross a line boundary', () => {
    const rows = splitHighlightedHtml(
      highlightToHtml('/* first\nsecond */\nconst x = 1', 'typescript'),
    )
    expect(rows).toHaveLength(3)
    for (const row of rows) {
      expect(openSpans(row)).toBe(closeSpans(row))
    }
    expect(rows[1]).toContain('tok-comment')
  })

  it('balances multiline template strings and JSX tags', () => {
    const template = splitHighlightedHtml(
      highlightToHtml('const s = `a\nb`\nconst x = 1', 'typescript'),
    )
    const jsx = splitHighlightedHtml(
      highlightToHtml('<div\n  title="x"\n>\n  hi\n</div>', 'tsx'),
    )

    for (const row of [...template, ...jsx]) {
      expect(openSpans(row)).toBe(closeSpans(row))
    }
  })
})
