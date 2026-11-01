import { useEffect, useMemo, useState } from 'react'
import {
  createGrammarStateCodeTokenizer,
  DEFAULT_LANGUAGES,
  type GrammarStateCodeTokenizer,
} from 'react-code-stream/tokenizer'
import type { GrammarState } from 'shiki'
import './grammarTokenizer.css'

import cppSource from '../../testCorpus/sample.cpp.txt?raw'
import cssSource from '../../testCorpus/sample.css.txt?raw'
import goSource from '../../testCorpus/sample.go.txt?raw'
import htmlSource from '../../testCorpus/sample.html.txt?raw'
import javascriptSource from '../../testCorpus/sample.js.txt?raw'
import pythonSource from '../../testCorpus/sample.py.txt?raw'
import textSource from '../../testCorpus/sample-text.txt?raw'
import typescriptSource from '../../testCorpus/sample.ts.txt?raw'

const corpus = {
  typescript: { label: 'TypeScript', language: 'typescript', source: typescriptSource },
  javascript: { label: 'JavaScript', language: 'javascript', source: javascriptSource },
  html: { label: 'HTML', language: 'html', source: htmlSource },
  css: { label: 'CSS', language: 'css', source: cssSource },
  python: { label: 'Python', language: 'python', source: pythonSource },
  go: { label: 'Go', language: 'go', source: goSource },
  cpp: { label: 'C++', language: 'cpp', source: cppSource },
  text: { label: 'Plain text', language: 'text', source: textSource },
} as const

type CorpusKey = keyof typeof corpus

const supportedCorpusLanguages = new Set<string>([
  ...DEFAULT_LANGUAGES,
  'go',
  'cpp',
])

const grammarTokenizerLanguages = [
  ...DEFAULT_LANGUAGES,
  'go',
  'cpp',
] as const

function splitIntoBlocks(source: string, blockSize: number): string[] {
  const lines = source.split('\n')
  const blocks: string[] = []
  for (let start = 0; start < lines.length; start += blockSize) {
    blocks.push(lines.slice(start, start + blockSize).join('\n'))
  }
  return blocks
}

function GrammarTokenizer() {
  const [selected, setSelected] = useState<CorpusKey>('typescript')
  const [tokenizer, setTokenizer] = useState<GrammarStateCodeTokenizer | null>(null)
  const [currentBlockHtml, setCurrentBlockHtml] = useState('')
  const [allCodeHtml, setAllCodeHtml] = useState('')
  const [loadedBlocks, setLoadedBlocks] = useState(0)
  const [isLoadingBlock, setIsLoadingBlock] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [lastGrammarState, setLastGrammarState] = useState<GrammarState | undefined>()

  const sample = corpus[selected]
  const blocks = useMemo(() => splitIntoBlocks(sample.source, 10), [sample.source])
  const loadedSource = useMemo(
    () => blocks.slice(0, loadedBlocks).join('\n'),
    [blocks, loadedBlocks],
  )
  const grammarStateDetails = useMemo(() => {
    if (!lastGrammarState) return null

    return {
      lang: lastGrammarState.lang,
      theme: lastGrammarState.theme,
      themes: lastGrammarState.themes,
      scopes: lastGrammarState.getScopes(),
    }
  }, [lastGrammarState])

  useEffect(() => {
    let active = true
    void createGrammarStateCodeTokenizer({ languages: grammarTokenizerLanguages }).then((instance) => {
      if (active) setTokenizer(instance)
    }).catch((reason: unknown) => {
      if (active) setError(reason instanceof Error ? reason.message : String(reason))
    })
    return () => {
      active = false
    }
  }, [])

  useEffect(() => {
    setLoadedBlocks(0)
    setCurrentBlockHtml('')
    setAllCodeHtml('')
    setLastGrammarState(undefined)
    setError(null)
  }, [selected])

  useEffect(() => {
    if (!tokenizer || !loadedSource) {
      setAllCodeHtml('')
      return
    }
    try {
      setAllCodeHtml(tokenizer.highlight(loadedSource, sample.language).html)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason))
    }
  }, [loadedSource, sample.language, tokenizer])

  async function loadNextBlock() {
    if (!tokenizer || isLoadingBlock || loadedBlocks >= blocks.length) return

    setIsLoadingBlock(true)
    setError(null)
    try {
      const result = tokenizer.highlight(
        blocks[loadedBlocks],
        sample.language,
        lastGrammarState,
      )
      setCurrentBlockHtml(result.html)
      setLastGrammarState(result.currentGrammarState)
      setLoadedBlocks((count) => count + 1)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason))
    } finally {
      setIsLoadingBlock(false)
    }
  }

  function resetBlocks() {
    setLoadedBlocks(0)
    setCurrentBlockHtml('')
    setAllCodeHtml('')
    setLastGrammarState(undefined)
    setError(null)
  }

  const isLanguageSupported = supportedCorpusLanguages.has(sample.language)

  return (
    <section className="grammar-tokenizer" aria-labelledby="grammar-tokenizer-title">
      <header className="grammar-tokenizer__header">
        <p className="grammar-tokenizer__eyebrow">Grammar state experiment</p>
        <h2 id="grammar-tokenizer-title">Chunk by chunk highlighting</h2>
        <p>
          Load a corpus sample in 10-line blocks. The left panel highlights only
          the newest block using the previous block’s grammar state; the right
          panel highlights all source loaded so far.
        </p>
      </header>

      <div className="grammar-tokenizer__controls">
        <label>
          Sample language
          <select
            value={selected}
            onChange={(event) => setSelected(event.target.value as CorpusKey)}
          >
            {Object.entries(corpus).map(([key, item]) => (
              <option key={key} value={key}>{item.label}</option>
            ))}
          </select>
        </label>
        <button
          type="button"
          onClick={() => void loadNextBlock()}
          disabled={!tokenizer || isLoadingBlock || loadedBlocks >= blocks.length}
        >
          {isLoadingBlock ? 'Loading…' : loadedBlocks === 0 ? 'Next block' : 'Next'}
        </button>
        <button
          type="button"
          className="grammar-tokenizer__reset"
          onClick={resetBlocks}
          disabled={isLoadingBlock || loadedBlocks === 0}
        >
          Reload
        </button>
        <span className="grammar-tokenizer__progress">
          {loadedBlocks} / {blocks.length} blocks loaded
        </span>
      </div>

      {!isLanguageSupported && (
        <p className="grammar-tokenizer__notice">
          The tokenizer has no {sample.label} grammar loaded, so this sample is
          displayed as plain text. Add that language to the tokenizer’s loaded
          language list to test its grammar state.
        </p>
      )}
      {error && <p className="grammar-tokenizer__error" role="alert">{error}</p>}

      <div className="grammar-tokenizer__panels">
        <section className="grammar-tokenizer__panel">
          <h3>Current block</h3>
          <p>Block {loadedBlocks || '—'} · previous state supplied</p>
          <div
            className="grammar-tokenizer__output"
            aria-live="polite"
            dangerouslySetInnerHTML={{ __html: currentBlockHtml }}
          />
          <section className="grammar-tokenizer__state" aria-label="Current grammar state">
            <h3>Current Grammar state</h3>
            <pre>
              {grammarStateDetails
                ? JSON.stringify(grammarStateDetails, null, 2)
                : 'No grammar state yet. Load the first block to create one.'}
            </pre>
          </section>
        </section>
        <section className="grammar-tokenizer__panel">
          <h3>All loaded blocks</h3>
          <p>{loadedBlocks > 0 ? loadedSource.split('\n').length : 0} lines loaded</p>
          <div
            className="grammar-tokenizer__output"
            aria-live="polite"
            dangerouslySetInnerHTML={{ __html: allCodeHtml }}
          />
        </section>
      </div>
    </section>
  )
}

export default GrammarTokenizer
