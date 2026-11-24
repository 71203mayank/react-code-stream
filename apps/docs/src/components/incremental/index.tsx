import { memo, useEffect, useMemo, useRef, useState } from 'react'
import {
  createIncrementalTokenizer,
  type CachedBlock,
  type HighlightSnapshot,
} from 'react-code-stream/incremental'
import {
  createGrammarStateCodeTokenizer,
  type GrammarStateCodeTokenizer,
} from 'react-code-stream/tokenizer'
import './incremental.css'
import { simulateStream } from '../../utils/simulateStream'

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

// Completed block props keep their identity while the trailing source changes.
const HighlightedBlock = memo(function HighlightedBlock({ block }: { block: CachedBlock }) {
  return (
    <article className="incremental-demo__block">
      <p>Block #{block.id} · {block.source.length} source characters</p>
      <div dangerouslySetInnerHTML={{ __html: block.html }} />
    </article>
  )
})

function CacheStream({ tokenizer, source, language }: {
  tokenizer: GrammarStateCodeTokenizer
  source: string
  language: string
}) {
  const cacheRef = useRef<ReturnType<typeof createIncrementalTokenizer> | null>(null)
  const characters = useMemo(() => Array.from(source), [source])
  const [snapshot, setSnapshot] = useState<HighlightSnapshot>({ blocks: [] })
  const [streaming, setStreaming] = useState(false)
  const [finished, setFinished] = useState(false)
  const [chunk, setChunk] = useState('')
  const [chunkCount, setChunkCount] = useState(0)
  const [receivedCharacters, setReceivedCharacters] = useState(0)
  const [error, setError] = useState('')
  const stopStream = useRef<(() => void) | undefined>(undefined)

  useEffect(() => {
    const cache = createIncrementalTokenizer({ tokenizer, language, onUpdate: setSnapshot,
      onError: (reason) => setError(reason.message) })
    cacheRef.current = cache
    return () => { cache.dispose(); cacheRef.current = null }
  }, [tokenizer, language])

  useEffect(() => () => stopStream.current?.(), [])

  function clearCache() {
    stopStream.current?.()
    stopStream.current = undefined
    cacheRef.current?.reset()
    setStreaming(false)
    setFinished(false)
    setChunk('')
    setChunkCount(0)
    setReceivedCharacters(0)
    setError('')
  }

  function startStream() {
    clearCache()
    setStreaming(true)
    stopStream.current = simulateStream(source, {
      onChunk: (update) => {
        cacheRef.current?.update(update.source)
        setChunk(update.chunk)
        setChunkCount((count) => count + 1)
        setReceivedCharacters(update.receivedCharacters)
      },
      onComplete: () => {
        stopStream.current = undefined
        setStreaming(false)
        setFinished(true)
      },
      onError: (reason) => {
        stopStream.current = undefined
        setStreaming(false)
        setError(reason instanceof Error ? reason.message : String(reason))
      },
    })
  }

  const completedBlocks = snapshot.blocks.filter((block) => (block.source.match(/\n/g) ?? []).length === 10)
  const trailingBlock = snapshot.blocks.find((block) => (block.source.match(/\n/g) ?? []).length < 10)
  const lastCompleted = completedBlocks[completedBlocks.length - 1]
  function blockDetails(block: CachedBlock | null | undefined) {
    return block ? {
      id: block.id,
      sourceLength: block.source.length,
      completedLines: (block.source.match(/\n/g) ?? []).length,
      outgoingScopes: block.outgoingGrammarState?.getScopes() ?? null,
    } : null
  }
  const metadata = {
    status: streaming ? 'Streaming' : finished ? 'Finished' : 'Ready',
    linesPerBlock: 10,
    completedBlockCount: completedBlocks.length,
    completedBlockIds: completedBlocks.map((block) => block.id),
    lastCompletedBlock: blockDetails(lastCompleted),
    activeTrailingBlock: blockDetails(trailingBlock),
    chunksReceived: chunkCount,
    receivedCharacters,
    totalCharacters: characters.length,
    lastChunkSize: Array.from(chunk).length,
    lastChunk: chunk,
  }

  return (
    <>
      <div className="controls incremental-demo__controls">
        <button type="button" onClick={startStream} disabled={streaming}>
          {streaming ? 'Streaming…' : finished ? 'Restart stream' : 'Start stream'}
        </button>
        <button type="button" onClick={clearCache}>Clear cache</button>
        <span>{receivedCharacters} / {metadata.totalCharacters} characters · {metadata.status}</span>
      </div>
      {error && <p role="alert">{error}</p>}
      <div className="incremental-demo__views">
        <section>
          <h3>Completed cache blocks</h3>
          <div className="incremental-demo__output">
            {completedBlocks.length === 0 && <p className="incremental-demo__empty">No completed blocks yet.</p>}
            {completedBlocks.map((block) => <HighlightedBlock key={block.id} block={block} />)}
          </div>
        </section>
        <section>
          <h3>Trailing block</h3>
          <div className="incremental-demo__output">
            {trailingBlock
              ? <HighlightedBlock key={trailingBlock.id} block={trailingBlock} />
              : <p className="incremental-demo__empty">No active trailing block.</p>}
          </div>
          <p className="incremental-demo__hint">The final remainder stays here when streaming finishes.</p>
        </section>
        <section>
          <h3>Cache metadata</h3>
          <pre className="incremental-demo__metadata">{JSON.stringify(metadata, null, 2)}</pre>
        </section>
      </div>
    </>
  )
}

export default function IncrementalDemo() {
  const [selected, setSelected] = useState(samples[0].file)
  const [tokenizer, setTokenizer] = useState<GrammarStateCodeTokenizer | null>(null)
  const [error, setError] = useState('')
  const sample = samples.find((item) => item.file === selected)!
  const source = files[`../../testCorpus/${sample.file}`]

  useEffect(() => {
    let active = true
    void createGrammarStateCodeTokenizer({
      languages: ['typescript', 'javascript', 'go', 'cpp', 'python', 'html', 'css'],
    }).then((instance) => {
      if (active) setTokenizer(instance)
    }).catch((reason: unknown) => {
      if (active) setError(reason instanceof Error ? reason.message : String(reason))
    })
    return () => { active = false }
  }, [])

  return (
    <section className="incremental-demo" aria-labelledby="incremental-demo-title">
      <p className="eyebrow">Incremental cache experiment</p>
      <h2 id="incremental-demo-title">Watch blocks become cached</h2>
      <p>Each tick streams a new random 5–15 character chunk. Every 10 complete lines become a cached block.</p>
      <div className="controls incremental-demo__selector">
        <label>
          Corpus file
          <select value={selected} onChange={(event) => setSelected(event.target.value)}>
            {samples.map((item) => <option key={item.file} value={item.file}>{item.file}</option>)}
          </select>
        </label>
      </div>
      {error && <p role="alert">{error}</p>}
      {!tokenizer && !error && <p>Loading tokenizer…</p>}
      {tokenizer && source !== undefined && (
        <CacheStream key={selected} tokenizer={tokenizer} source={source} language={sample.language} />
      )}
    </section>
  )
}
