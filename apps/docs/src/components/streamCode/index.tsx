import { useEffect, useRef, useState } from 'react'
import { StreamCode } from 'react-code-stream'
import 'react-code-stream/styles.css'
import { simulateStream } from '../../utils/simulateStream'
import './streamCode.css'

const files = import.meta.glob<string>('../../testCorpus/*.txt', {
  query: '?raw', import: 'default', eager: true,
})

const samples = [
  { file: 'sample.ts.txt', language: 'typescript' },
  { file: 'sample.js.txt', language: 'javascript' },
  { file: 'sample.go.txt', language: 'go' },
  { file: 'sample.cpp.txt', language: 'cpp' },
  { file: 'sample.py.txt', language: 'python' },
  { file: 'sample.html.txt', language: 'html' },
  { file: 'sample.css.txt', language: 'css' },
  { file: 'sample-text.txt', language: 'text' },
]

function CorpusStream({ source, language }: { source: string; language: string }) {
  const [code, setCode] = useState('')
  const [streaming, setStreaming] = useState(false)
  const [autoScroll, setAutoScroll] = useState(true)
  const [error, setError] = useState('')
  const stopStream = useRef<(() => void) | undefined>(undefined)

  useEffect(() => () => stopStream.current?.(), [])

  function stop() {
    stopStream.current?.()
    stopStream.current = undefined
    setStreaming(false)
  }

  function start() {
    stop()
    setCode('')
    setStreaming(true)
    stopStream.current = simulateStream(source, {
      onChunk: (update) => setCode(update.source),
      onComplete: stop,
      onError: (reason) => {
        stop()
        setError(reason instanceof Error ? reason.message : String(reason))
      },
    })
  }

  function loadCompleteFile() {
    stop()
    setCode(source)
  }

  return (
    <>
      <div className="controls stream-code-demo__controls">
        <button type="button" onClick={start}>{streaming ? 'Restart stream' : 'Start stream'}</button>
        <button type="button" onClick={stop} disabled={!streaming}>Stop</button>
        <button type="button" onClick={loadCompleteFile}>Load complete file (no streaming)</button>
        <button type="button" onClick={() => { stop(); setCode('') }}>Clear</button>
        <label className="stream-code-demo__follow">
          <input type="checkbox" checked={autoScroll} onChange={(event) => setAutoScroll(event.target.checked)} />
          Auto-scroll
        </label>
      </div>
      <p className="stream-code-demo__status" role="status">
        {streaming ? 'Streaming' : code === source ? 'Complete' : 'Stopped'} · {code.length} / {source.length} source code units
      </p>
      {error && <p role="alert">Highlighting error: {error}</p>}
      <div className="panels">
        <div className="panel">
          <label htmlFor="stream-code-source">Received source (editable when stopped)</label>
          <textarea id="stream-code-source" value={code} spellCheck={false} readOnly={streaming}
            onChange={(event) => setCode(event.target.value)} />
        </div>
        <div className="panel">
          <p className="panel-label">StreamCode output · 10 lines per block</p>
          <StreamCode language={language} linesPerBlock={10} autoScroll={autoScroll}
            className="stream-code-demo__output" style={{ height: 430 }}
            onError={(reason) => setError(reason.message)} aria-label="Streamed corpus code">
            {code}
          </StreamCode>
        </div>
      </div>
    </>
  )
}

export default function StreamCodeDemo() {
  const [selected, setSelected] = useState(samples[0].file)
  const sample = samples.find((item) => item.file === selected)!
  const source = files[`../../testCorpus/${sample.file}`]

  return (
    <section className="stream-code-demo" aria-labelledby="stream-code-demo-title">
      <p className="eyebrow">React component playground</p>
      <h2 id="stream-code-demo-title">StreamCode corpus preview</h2>
      <p>Stream random 5–15 character chunks every 80 ms, load the complete file at once, or edit the received source to check highlighting after changes.</p>
      <div className="controls stream-code-demo__controls">
        <label>
          Corpus file
          <select value={selected} onChange={(event) => setSelected(event.target.value)}>
            {samples.map((item) => <option key={item.file} value={item.file}>{item.file}</option>)}
          </select>
        </label>
      </div>
      {source !== undefined && <CorpusStream key={selected} source={source} language={sample.language} />}
    </section>
  )
}
