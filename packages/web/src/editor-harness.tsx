/* eslint-disable react-refresh/only-export-components -- standalone Vite entry, mounted directly */
import { useState } from 'react'
import { createRoot } from 'react-dom/client'
import CodeEditor from '@/components/editor/CodeEditor'
import '@/styles/globals.css'

const SAMPLE = `import { useMemo } from 'react'

interface User {
  id: number
  name: string
}

/** A deliberately long line to verify wrapped rows keep their gutter number and caret aligned: ${'x'.repeat(160)} */
export function Greeting({ user }: { user: User }) {
  const label = useMemo(() => \`Hello, \${user.name}!\`, [user.name])

  return (
    <section className="greeting" data-id={user.id}>
      <h1>{label}</h1>
      <p>It's a > b && c < d — "quotes" stay inside strings.</p>
      <input type="text" value={user.name} />
    </section>
  )
}

// A multiline comment starts here
// and continues on the next line.
const json = '{"name": "cat", "ok": true}'
`

function Harness() {
  const [value, setValue] = useState(SAMPLE)
  return (
    <div className="min-h-dvh bg-surface p-8">
      <div className="mx-auto h-[640px] w-[960px] max-w-full">
        <CodeEditor
          value={value}
          onChange={setValue}
          language="tsx"
          ariaLabel="Harness code editor"
          fillHeight
          autoFocus
        />
      </div>
    </div>
  )
}

createRoot(document.getElementById('root')!).render(<Harness />)
