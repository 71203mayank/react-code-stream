// @vitest-environment jsdom
import { act, createElement, StrictMode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { StreamCode, type StreamCodeProps } from '../src/react/StreamCode'
import { createGrammarStateCodeTokenizer, type GrammarStateCodeTokenizer } from '../src/core/tokenizer'

vi.mock('../src/core/tokenizer', () => ({
  DEFAULT_THEME: 'github-dark',
  FALLBACK_LANGUAGE: 'text',
  createGrammarStateCodeTokenizer: vi.fn(),
}))

const initialize = vi.mocked(createGrammarStateCodeTokenizer)

describe('StreamCode', () => {
  let host: HTMLDivElement
  let root: Root
  let frames: Map<number, FrameRequestCallback>
  let frameId: number
  let dispose: ReturnType<typeof vi.fn<() => void>>
  let highlight: ReturnType<typeof vi.fn<GrammarStateCodeTokenizer['highlight']>>

  beforeEach(() => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    frames = new Map()
    frameId = 0
    vi.stubGlobal('requestAnimationFrame', vi.fn((callback: FrameRequestCallback) => {
      frames.set(++frameId, callback)
      return frameId
    }))
    vi.stubGlobal('cancelAnimationFrame', vi.fn((id: number) => frames.delete(id)))
    dispose = vi.fn()
    highlight = vi.fn((source: string) => ({
      html: `<pre style="background-color:#24292e;color:#ffffff"><code>${source
        .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')}</code></pre>`,
      currentGrammarState: undefined,
    }))
    initialize.mockReset()
    initialize.mockResolvedValue({ highlight, dispose })
    host = document.createElement('div')
    document.body.append(host)
    root = createRoot(host)
  })

  afterEach(async () => {
    await act(async () => root.unmount())
    host.remove()
    vi.unstubAllGlobals()
  })

  async function render(source: string, props: Omit<StreamCodeProps, 'children'> = {}) {
    await act(async () => {
      root.render(createElement(StreamCode, { ...props, children: source }))
    })
  }

  async function flushFrame() {
    await act(async () => {
      const callbacks = [...frames.values()]
      frames.clear()
      callbacks.forEach((callback) => callback(0))
    })
  }

  it('shows escaped source during initialization and renders one shared pre/code pair', async () => {
    const source = '<script>alert("hello")</script>\n'
    await render(source)
    expect(host.textContent).toBe(source)
    expect(host.querySelector('script')).toBeNull()
    await flushFrame()
    expect(host.textContent).toBe(source)
    expect(host.querySelectorAll('pre')).toHaveLength(1)
    expect(host.querySelectorAll('code')).toHaveLength(1)
    expect(host.querySelector('[role="region"]')?.getAttribute('aria-label')).toBe('Source code')
    expect((host.firstElementChild as HTMLElement).style.backgroundColor).toBe('rgb(36, 41, 46)')
  })

  it('combines pending updates and highlights the latest committed source', async () => {
    await render('c')
    await render('cons')
    await render('const answer = 42')
    expect(frames.size).toBe(1)
    expect(highlight).not.toHaveBeenCalled()
    await flushFrame()
    expect(highlight).toHaveBeenCalledTimes(1)
    expect(highlight.mock.calls[0][0]).toBe('const answer = 42')
    expect(host.textContent).toBe('const answer = 42')
  })

  it('leaves completed block contents untouched while the trailing block grows', async () => {
    await render('first\nsecond\nthird', { linesPerBlock: 1 })
    await flushFrame()
    const completed = [...host.querySelectorAll('[data-block-id]')].slice(0, 2)
    const originalTextNodes = completed.map((block) => block.firstChild)
    const mutations: MutationRecord[] = []
    const observer = new MutationObserver((records) => mutations.push(...records))
    completed.forEach((block) => observer.observe(block, { childList: true, characterData: true, subtree: true }))
    highlight.mockClear()
    await render('first\nsecond\nthird grows', { linesPerBlock: 1 })
    await flushFrame()
    observer.disconnect()
    const blocks = host.querySelectorAll('[data-block-id]')
    completed.forEach((block, index) => {
      expect(blocks[index]).toBe(block)
      expect(block.firstChild).toBe(originalTextNodes[index])
    })
    expect(mutations).toHaveLength(0)
    expect(highlight).toHaveBeenCalledTimes(1)
    expect(highlight.mock.calls[0][0]).toBe('third grows')
    expect(host.textContent).toBe('first\nsecond\nthird grows')
  })

  it('preserves exact text across block completion, edits, and deletion', async () => {
    for (const source of ['one\ntw', 'one\ntwo\nthree', 'edited\ntwo\nthree', 'edited', '']) {
      await render(source, { linesPerBlock: 1 })
      await flushFrame()
      expect(host.textContent).toBe(source)
    }
    expect(initialize).toHaveBeenCalledTimes(1)
  })

  it.each([
    { language: 'typescript' },
    { theme: 'github-light' },
    { linesPerBlock: 2 },
  ])('reinitializes and disposes the old tokenizer when configuration changes: %o', async (props) => {
    await render('hello')
    await flushFrame()
    await render('hello', props)
    await flushFrame()
    expect(initialize).toHaveBeenCalledTimes(2)
    expect(dispose).toHaveBeenCalledTimes(1)
    expect(host.textContent).toBe('hello')
  })

  it('reports initialization errors and continues displaying escaped source', async () => {
    const error = new Error('Could not load grammar')
    initialize.mockRejectedValueOnce(error)
    const onError = vi.fn()
    await render('<tag>', { onError })
    expect(onError).toHaveBeenCalledWith(error)
    await render('<tag>more', { onError })
    expect(host.textContent).toBe('<tag>more')
    expect(host.querySelector('tag')).toBeNull()
  })

  it('falls back to plain text after highlighting fails and stops retrying', async () => {
    const onError = vi.fn()
    await render('first', { onError })
    await flushFrame()
    highlight.mockImplementationOnce(() => { throw new Error('Highlight failed') })
    await render('<broken>', { onError })
    await flushFrame()
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ message: 'Highlight failed' }))
    expect(host.textContent).toBe('<broken>')
    expect(host.querySelector('[data-block-id]')).toBeNull()
    const calls = highlight.mock.calls.length
    await render('new source', { onError })
    await flushFrame()
    expect(highlight).toHaveBeenCalledTimes(calls)
    expect(host.textContent).toBe('new source')
  })

  it('rejects an invalid block size without initializing Shiki', async () => {
    const onError = vi.fn()
    await render('source', { linesPerBlock: 0, onError })
    expect(onError).toHaveBeenCalledWith(expect.any(RangeError))
    expect(initialize).not.toHaveBeenCalled()
    expect(host.textContent).toBe('source')
  })

  it('cancels queued highlighting and disposes the tokenizer on unmount', async () => {
    await render('pending')
    expect(frames.size).toBe(1)
    await act(async () => root.render(null))
    expect(frames.size).toBe(0)
    expect(dispose).toHaveBeenCalledTimes(1)
    expect(highlight).not.toHaveBeenCalled()
  })

  it('follows new content only while the reader is near the bottom', async () => {
    await render('first', { autoScroll: true })
    await flushFrame()
    const region = host.firstElementChild as HTMLElement
    Object.defineProperties(region, {
      scrollHeight: { configurable: true, value: 1000 },
      clientHeight: { configurable: true, value: 100 },
    })
    await render('first grows', { autoScroll: true })
    await flushFrame()
    expect(region.scrollTop).toBe(1000)

    await act(async () => {
      region.scrollTop = 100
      region.dispatchEvent(new Event('scroll'))
    })
    await render('first grows more', { autoScroll: true })
    await flushFrame()
    expect(region.scrollTop).toBe(100)

    await act(async () => {
      region.scrollTop = 900
      region.dispatchEvent(new Event('scroll'))
    })
    await render('first grows more again', { autoScroll: true })
    await flushFrame()
    expect(region.scrollTop).toBe(1000)
  })

  it('disposes initialization results that arrive after unmount', async () => {
    let resolve!: (tokenizer: Awaited<ReturnType<typeof createGrammarStateCodeTokenizer>>) => void
    initialize.mockReturnValueOnce(new Promise((done) => { resolve = done }))
    await render('loading')
    await act(async () => root.render(null))
    await act(async () => resolve({ highlight, dispose }))
    expect(dispose).toHaveBeenCalledTimes(1)
    expect(frames.size).toBe(0)
  })

  it('releases both tokenizer instances during Strict Mode effect replay', async () => {
    const abandonedDispose = vi.fn()
    const currentDispose = vi.fn()
    initialize.mockResolvedValueOnce({ highlight, dispose: abandonedDispose })
    initialize.mockResolvedValueOnce({ highlight, dispose: currentDispose })
    await act(async () => {
      root.render(createElement(StrictMode, null, createElement(StreamCode, { children: 'source' })))
    })
    expect(initialize).toHaveBeenCalledTimes(2)
    expect(abandonedDispose).toHaveBeenCalledTimes(1)
    expect(currentDispose).not.toHaveBeenCalled()
    expect(frames.size).toBe(1)
    await flushFrame()
    expect(host.textContent).toBe('source')
    await act(async () => root.render(null))
    expect(currentDispose).toHaveBeenCalledTimes(1)
    expect(abandonedDispose).toHaveBeenCalledTimes(1)
    expect(frames.size).toBe(0)
  })

  it('disposes a stale initialization without replacing the newer session', async () => {
    let resolveOld!: (tokenizer: GrammarStateCodeTokenizer) => void
    initialize.mockReturnValueOnce(new Promise((resolve) => { resolveOld = resolve }))
    await render('old', { language: 'typescript' })
    await render('current', { language: 'javascript' })
    await flushFrame()
    const oldHighlight = vi.fn<GrammarStateCodeTokenizer['highlight']>()
    const oldDispose = vi.fn()
    await act(async () => resolveOld({ highlight: oldHighlight, dispose: oldDispose }))
    expect(oldDispose).toHaveBeenCalledTimes(1)
    expect(oldHighlight).not.toHaveBeenCalled()
    expect(host.textContent).toBe('current')
    expect(frames.size).toBe(0)
    expect(dispose).not.toHaveBeenCalled()
  })

  it('releases each tokenizer and pending frame across repeated mount/unmount cycles', async () => {
    const releases = Array.from({ length: 12 }, () => vi.fn())
    for (const release of releases) {
      initialize.mockResolvedValueOnce({ highlight, dispose: release })
      await render('first\nsecond\ntail', { linesPerBlock: 1 })
      await flushFrame()
      await render('first\nsecond\ntail grows', { linesPerBlock: 1 })
      expect(frames.size).toBe(1)
      await act(async () => root.render(null))
      expect(frames.size).toBe(0)
      expect(host.childElementCount).toBe(0)
      expect(release).toHaveBeenCalledTimes(1)
    }
    releases.forEach((release) => expect(release).toHaveBeenCalledTimes(1))
  })
})
