import { describe, expect, it, vi } from 'vitest'
import type { GrammarState } from 'shiki'
import { createIncrementalTokenizer } from '../src/core/incremental'
import type { GrammarStateCodeTokenizer } from '../src/core/tokenizer'

/** Use distinct state objects to verify the exact state passed between blocks. */
function setup(linesPerBlock = 2) {
  const highlight = vi.fn<GrammarStateCodeTokenizer['highlight']>(() => {
    const currentGrammarState: GrammarState = {
      lang: 'typescript',
      theme: 'github-dark',
      themes: ['github-dark'],
      getInternalStack: () => undefined,
      getScopes: () => [],
    }
    return { html: '<pre>highlighted</pre>', currentGrammarState }
  })
  const cache = createIncrementalTokenizer({
    tokenizer: { highlight },
    language: 'typescript',
    linesPerBlock,
  })
  return { cache, highlight }
}

describe('createIncrementalTokenizer', () => {
  // Reject invalid sizes rather than silently generating incorrect block boundaries.
  it.each([0, -1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1])(
    'rejects an invalid block size: %s',
    (size) => {
      expect(() => setup(size)).toThrow(RangeError)
    },
  )

  // An empty document needs neither a rendered block nor a tokenizer call.
  it('starts with an empty cache', () => {
    const { cache, highlight } = setup()
    expect(cache.update('')).toEqual({
      completedBlocks: [],
      trailingBlock: null,
      previousSource: '',
    })
    expect(highlight).not.toHaveBeenCalled()
  })

  // The default threshold is ten complete lines; an unfinished tenth line stays editable.
  it('defaults to ten newline-terminated lines per completed block', () => {
    const { highlight } = setup()
    const cache = createIncrementalTokenizer({
      tokenizer: { highlight },
      language: 'typescript',
    })
    const source = 'line\n'.repeat(9) + 'last'
    expect(cache.update(source).completedBlocks).toHaveLength(0)
    const result = cache.update(source + '\n')
    expect(result.completedBlocks).toHaveLength(1)
    expect(result.completedBlocks[0].source).toBe(source + '\n')
    expect(result.trailingBlock).toBeNull()
  })

  // Identical input should return the same snapshot without any highlighting work.
  it('reuses the snapshot when the source is unchanged', () => {
    const { cache, highlight } = setup()
    const first = cache.update('a\nb\nc')
    highlight.mockClear()
    expect(cache.update('a\nb\nc')).toBe(first)
    expect(highlight).not.toHaveBeenCalled()
  })

  // Splitting must preserve original bytes, even when CRLF arrives in separate updates.
  it('preserves mixed newlines, blank lines, and a split CRLF sequence', () => {
    const { cache } = setup()
    cache.update('a\r')
    const source = 'a\r\n\nb\r\nc\npartial'
    const result = cache.update(source)
    expect(result.completedBlocks.map((block) => block.source)).toEqual([
      'a\r\n\n',
      'b\r\nc\n',
    ])
    expect(result.trailingBlock?.source).toBe('partial')
    expect(result.completedBlocks.map((block) => block.source).join('')
      + result.trailingBlock?.source).toBe(source)
    expect(result.previousSource).toBe(source)
  })

  // One update may complete several blocks; each must receive its immediate predecessor's state.
  it('chains grammar states through a batch of blocks and its remainder', () => {
    const { cache, highlight } = setup()
    const result = cache.update('a\nb\nc\nd\ne')
    const [first, second] = result.completedBlocks
    expect(highlight).toHaveBeenCalledTimes(3)
    expect(highlight).toHaveBeenNthCalledWith(1, 'a\nb\n', 'typescript', undefined)
    expect(highlight).toHaveBeenNthCalledWith(
      2, 'c\nd\n', 'typescript', first.outgoingGrammarState,
    )
    expect(highlight.mock.calls[1][2]).toBe(first.outgoingGrammarState)
    expect(highlight.mock.calls[2][2]).toBe(second.outgoingGrammarState)
    expect(result.trailingBlock?.outgoingGrammarState)
      .toBe(highlight.mock.results[2].value.currentGrammarState)
    expect(first.html).toBe('<pre>highlighted</pre>')
  })

  // Re-highlighting a growing tail must start from the completed block, not the old tail's state.
  it('only re-highlights the trailing block while retaining completed blocks', () => {
    const { cache, highlight } = setup()
    const first = cache.update('a\nb\nc')
    highlight.mockClear()
    const second = cache.update('a\nb\ncd')
    expect(highlight).toHaveBeenCalledTimes(1)
    expect(highlight.mock.calls[0][0]).toBe('cd')
    expect(highlight.mock.calls[0][2]).toBe(first.completedBlocks[0].outgoingGrammarState)
    expect(second.completedBlocks).toBe(first.completedBlocks)
    expect(second.trailingBlock?.id).toBe(first.trailingBlock?.id)
    expect(first.trailingBlock?.source).toBe('c')
    expect(second.trailingBlock?.source).toBe('cd')
  })

  // A tail keeps its ID when promoted, while additional blocks receive unique IDs.
  it('preserves block identity when an append completes multiple blocks', () => {
    const { cache, highlight } = setup()
    const first = cache.update('a\nb\nc')
    highlight.mockClear()
    const second = cache.update('a\nb\nc\nd\ne\nf\ng')
    expect(highlight).toHaveBeenCalledTimes(3)
    expect(second.completedBlocks[0]).toBe(first.completedBlocks[0])
    expect(second.completedBlocks[1].id).toBe(first.trailingBlock?.id)
    const ids = [...second.completedBlocks, second.trailingBlock!].map((block) => block.id)
    expect(new Set(ids).size).toBe(ids.length)
    expect(first.completedBlocks).toHaveLength(1)
  })

  // An exact boundary should produce no empty tail, and the next append must resume its state.
  it('handles appends after an exact completed-block boundary', () => {
    const { cache, highlight } = setup()
    const first = cache.update('a\nb\n')
    expect(first.trailingBlock).toBeNull()
    highlight.mockClear()
    const second = cache.update('a\nb\nc')
    expect(highlight.mock.calls[0][2]).toBe(first.completedBlocks[0].outgoingGrammarState)
    expect(second.trailingBlock?.source).toBe('c')
    expect(second.trailingBlock?.id).not.toBe(first.completedBlocks[0].id)
  })

  // Length alone cannot detect edits: replacement text of equal length requires a full rebuild.
  it('rebuilds from a fresh grammar state after an edit of the same length', () => {
    const { cache, highlight } = setup()
    const first = cache.update('a\nb\nc')
    highlight.mockClear()
    const second = cache.update('x\nb\nc')
    expect(highlight).toHaveBeenCalledTimes(2)
    expect(highlight.mock.calls[0]).toEqual(['x\nb\n', 'typescript', undefined])
    expect(second.completedBlocks[0]).not.toBe(first.completedBlocks[0])
    expect(second.completedBlocks[0].id).toBeGreaterThan(first.trailingBlock!.id)
    expect(highlight.mock.calls[1][2]).toBe(second.completedBlocks[0].outgoingGrammarState)
    expect(second.previousSource).toBe('x\nb\nc')
  })

  // Removing text invalidates dependent blocks, including when the document becomes empty.
  it('rebuilds after deletion and clears all blocks when the source is emptied', () => {
    const { cache, highlight } = setup()
    cache.update('a\nb\nc\nd\ne')
    const shortened = cache.update('a\n')
    expect(shortened.completedBlocks).toEqual([])
    expect(shortened.trailingBlock?.source).toBe('a\n')
    highlight.mockClear()
    expect(cache.update('')).toEqual({
      completedBlocks: [], trailingBlock: null, previousSource: '',
    })
    expect(highlight).not.toHaveBeenCalled()
  })

  // Reset must discard old context and restart the block ID sequence.
  it('resets source tracking, grammar state, and IDs', () => {
    const { cache, highlight } = setup()
    cache.update('a\nb\nc')
    cache.reset()
    expect(cache.update('').trailingBlock).toBeNull()
    highlight.mockClear()
    const result = cache.update('next')
    expect(result.trailingBlock?.id).toBe(0)
    expect(result.completedBlocks).toEqual([])
    expect(highlight.mock.calls[0][2]).toBeUndefined()
  })

  // Plain-text tokenizers can return no state; the cache must still split and reuse their output.
  it('supports tokenizer results without a grammar state', () => {
    const { cache, highlight } = setup()
    highlight.mockImplementation(() => ({ html: '<pre>text</pre>', currentGrammarState: undefined }))
    const result = cache.update('a\nb\nc')
    expect(result.completedBlocks[0].outgoingGrammarState).toBeUndefined()
    expect(result.trailingBlock?.html).toBe('<pre>text</pre>')
    expect(highlight.mock.calls[1][2]).toBeUndefined()
  })

  // Failed highlighting must not publish partial blocks or consume IDs; retry remains safe.
  it.each(['append', 'rebuild'] as const)('preserves the previous snapshot after a failed %s', (mode) => {
    const { cache, highlight } = setup()
    const originalSource = 'a\nb\nc'
    const original = cache.update(originalSource)
    const nextSource = mode === 'append' ? originalSource + '\nd\ne' : 'x\nb\nc\nd\ne'
    highlight.mockImplementationOnce(() => ({
      html: '<pre>temporary</pre>', currentGrammarState: undefined,
    })).mockImplementationOnce(() => { throw new Error('Highlight failed') })

    expect(() => cache.update(nextSource)).toThrow('Highlight failed')
    expect(cache.update(originalSource)).toBe(original)
    const retried = cache.update(nextSource)
    expect(retried.previousSource).toBe(nextSource)
    expect(retried.completedBlocks).toHaveLength(2)
    expect(retried.completedBlocks[1].id).toBe(mode === 'append' ? 1 : 3)
  })
})
