import { beforeAll, describe, expect, it } from 'vitest'
import type { GrammarState } from 'shiki'
import {
  createCodeTokenizer,
  createGrammarStateCodeTokenizer,
  type CodeTokenizer,
  type GrammarStateCodeTokenizer,
} from '../src/core/tokenizer'

describe('createCodeTokenizer', () => {
  let tokenizer: CodeTokenizer

  beforeAll(async () => {
    tokenizer = await createCodeTokenizer()
  })

  it('highlights code using a loaded language', () => {
    const html = tokenizer.highlight('const answer: number = 42', 'typescript')

    expect(html).toContain('class="shiki')
    expect(html).toContain('answer')
  })

  it('handles incomplete code while it grows', () => {
    let code = ''

    for (const chunk of ['const message = ', '`hello ', '${name']) {
      code += chunk
      expect(() => tokenizer.highlight(code, 'typescript')).not.toThrow()
    }
  })

  it('uses plain text for an unknown language', () => {
    const html = tokenizer.highlight('<custom-tag>text</custom-tag>', 'not-a-language')

    expect(html).toContain('&#x3C;custom-tag>')
  })
})

describe('createGrammarStateCodeTokenizer', () => {
  let tokenizer: GrammarStateCodeTokenizer
  let fullTokenizer: CodeTokenizer

  beforeAll(async () => {
    tokenizer = await createGrammarStateCodeTokenizer()
    fullTokenizer = await createCodeTokenizer()
  })

  it('returns HTML and a grammar state for the first block', () => {
    const result = tokenizer.highlight('/* comment starts here', 'typescript')

    expect(result.html).toContain('comment starts here')
    expect(result.currentGrammarState).toBeDefined()
    expect(result.currentGrammarState?.lang).toBe('typescript')
  })

  it('carries an open multiline comment state into the next block', () => {
    const firstBlock = 'const before = 1\n/* comment begins\nstill inside comment'
    const secondBlock = 'comment continues\n*/\nconst after = 2'

    const firstResult = tokenizer.highlight(firstBlock, 'typescript')
    const secondResult = tokenizer.highlight(
      secondBlock,
      'typescript',
      firstResult.currentGrammarState,
    )

    expect(firstResult.currentGrammarState).toBeDefined()
    expect(secondResult.html).toContain('comment continues')
    expect(secondResult.currentGrammarState).toBeDefined()
    expect(secondResult.currentGrammarState?.lang).toBe('typescript')
  })

  it('preserves all source content when each block receives the previous state', () => {
    const blocks = [
      'const count = 2\n/* comment starts in this block',
      'and continues in the next block\n*/\nconst label = "ready"',
    ]
    let grammarState: GrammarState | undefined
    let chunkedHtml = ''

    for (const block of blocks) {
      const result = tokenizer.highlight(block, 'typescript', grammarState)
      chunkedHtml += result.html
      grammarState = result.currentGrammarState
    }

    const fullSourceHtml = fullTokenizer.highlight(blocks.join('\n'), 'typescript')
    const chunkedText = chunkedHtml.replace(/<[^>]*>/g, '')
    const fullSourceText = fullSourceHtml.replace(/<[^>]*>/g, '')

    expect(chunkedHtml).toContain('comment starts in this block')
    expect(chunkedHtml).toContain('and continues in the next block')
    expect(chunkedText).toContain('const label')
    expect(fullSourceHtml).toContain('comment starts in this block')
    expect(fullSourceHtml).toContain('and continues in the next block')
    expect(fullSourceText).toContain('const label')
  })

  it('falls back to plain text for an unknown language without failing', () => {
    const result = tokenizer.highlight('unrecognized <token>', 'not-a-language')

    expect(result.html).toContain('unrecognized')
    expect(result.currentGrammarState).toBeUndefined()
  })
})
