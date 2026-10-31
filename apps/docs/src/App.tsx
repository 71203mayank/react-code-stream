import { useEffect, useRef, useState } from 'react'
import {
  createCodeTokenizer,
  DEFAULT_LANGUAGES,
  type CodeTokenizer,
} from '../../../packages/react-code-stream/src/core/tokenizer'
import './App.css'
import GrammarTokenizer from './components/grammarTokenizer'
import IncrementalDemo from './components/incremental'
import StreamCodeDemo from './components/streamCode'

const initialCode = `type Message = {
  role: 'assistant' | 'user'
  content: string
}

export function greet(name: string): Message {
  return {
    role: 'assistant',
    content: \`Hello, \${name}!\`,
  }
}`

function App() {
  const [code, setCode] = useState(initialCode)
  const [language, setLanguage] = useState<string>('typescript')
  const [tokenizer, setTokenizer] = useState<CodeTokenizer | null>(null)
  const [highlightedHtml, setHighlightedHtml] = useState('')
  const [isStreaming, setIsStreaming] = useState(false)
  const streamTimer = useRef<number | undefined>(undefined)

  useEffect(() => {
    let active = true

    void createCodeTokenizer().then((instance) => {
      if (active) setTokenizer(instance)
    })

    return () => {
      active = false
      window.clearInterval(streamTimer.current)
    }
  }, [])

  useEffect(() => {
    if (!tokenizer) return
    setHighlightedHtml(tokenizer.highlight(code, language))
  }, [code, language, tokenizer])

  function simulateStream() {
    window.clearInterval(streamTimer.current)
    setCode('')
    setIsStreaming(true)

    let position = 0
    streamTimer.current = window.setInterval(() => {
      position = Math.min(position + 5, initialCode.length)
      setCode(initialCode.slice(0, position))

      if (position >= initialCode.length) {
        window.clearInterval(streamTimer.current)
        setIsStreaming(false)
      }
    }, 45)
  }

  return (
    <main className="playground">
      <header className="page-header">
        <p className="eyebrow">Tokenizer playground</p>
        <h1>React Code Stream</h1>
        <p className="subtitle">
          Explore Shiki output and watch highlighting update as code arrives.
        </p>
      </header>

      <section className="controls" aria-label="Tokenizer controls">
        <label>
          Language
          <select
            value={language}
            onChange={(event) => setLanguage(event.target.value)}
          >
            {DEFAULT_LANGUAGES.map((item) => (
              <option key={item} value={item}>
                {item}
              </option>
            ))}
          </select>
        </label>
        <button type="button" onClick={simulateStream} disabled={!tokenizer || isStreaming}>
          {isStreaming ? 'Streaming…' : 'Simulate stream'}
        </button>
        {!tokenizer && <span className="status">Loading tokenizer…</span>}
      </section>

      <section className="panels">
        <div className="panel">
          <label htmlFor="source-code">Source code</label>
          <textarea
            id="source-code"
            spellCheck={false}
            value={code}
            onChange={(event) => setCode(event.target.value)}
          />
        </div>
        <div className="panel">
          <p className="panel-label">Highlighted output</p>
          <div
            className="highlighted-output"
            aria-live="polite"
            dangerouslySetInnerHTML={{ __html: highlightedHtml }}
          />
        </div>
      </section>
      <StreamCodeDemo />
      <GrammarTokenizer />
      <IncrementalDemo />
    </main>
  )
}

export default App
