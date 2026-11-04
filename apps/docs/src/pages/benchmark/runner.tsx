import { createRoot } from 'react-dom/client'
import { CodeView } from './renderers'
import type { Renderer } from './labels'
import { measureTyping, type TypingResult } from './typing'

export interface Settings {
  file: string
  language: string
  source: string
  mode: 'stream' | 'complete'
  chunkSize: number
  intervalMs: number
  repetitions: number
  renderer: Renderer | 'both'
}

export interface Result {
  renderer: Renderer
  repetition: number
  durationMs: number
  finalLatencyMs: number
  frameGapCount: number
  maxFrameGapMs: number
  longTaskCount: number | null
  longTaskMs: number | null
  maxDeliveryDelayMs: number
  sourcePreserved: boolean
  typing: TypingResult
}

export function percentile(values: number[], fraction: number): number {
  if (!values.length) return 0
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.max(0, Math.ceil(sorted.length * fraction) - 1)]
}

function pause(ms: number, signal: AbortSignal): Promise<void> {
  signal.throwIfAborted()
  return new Promise((resolve, reject) => {
    const abort = () => { clearTimeout(timer); reject(signal.reason) }
    const timer = window.setTimeout(() => { signal.removeEventListener('abort', abort); resolve() }, ms)
    signal.addEventListener('abort', abort, { once: true })
  })
}

async function trial(host: HTMLElement, input: HTMLInputElement, settings: Settings, renderer: Renderer, repetition: number, signal: AbortSignal): Promise<Result> {
  const root = createRoot(host)
  let renderError: Error | undefined
  const onError = (error: Error) => { renderError = error }
  const render = (code: string) => root.render(<CodeView renderer={renderer} code={code} language={settings.language} onError={onError} />)
  const ready = (code: string) => {
    if (host.querySelector('code')?.textContent !== code) return false
    return renderer !== 'streamcode' || !code || !!host.querySelector('[data-block-id]')
  }
  // Poll only during warmup; measured completion uses DOM mutation notifications.
  async function settle(code: string) {
    const deadline = performance.now() + 15000
    do {
      await pause(20, signal)
      if (renderError) throw renderError
      if (ready(code)) return
    } while (performance.now() < deadline)
    throw new Error('Highlighting warmup timed out')
  }

  let frame = 0
  let observer: PerformanceObserver | undefined
  let domObserver: MutationObserver | undefined
  let timeout: number | undefined
  let removeAbort = () => {}
  let typing: ReturnType<typeof measureTyping> | undefined
  const longTasks: PerformanceEntry[] = []
  const gaps: number[] = []
  const longTasksSupported = typeof PerformanceObserver !== 'undefined' && PerformanceObserver.supportedEntryTypes.includes('longtask')
  const characters = Array.from(settings.source)
  // Store one source string and offsets rather than every accumulated prefix.
  // This keeps the larger corpus from giving the harness quadratic memory use.
  const ends: number[] = []
  let offset = 0
  for (let index = 0; index < characters.length; index++) {
    offset += characters[index].length
    if ((index + 1) % settings.chunkSize === 0 || index === characters.length - 1) ends.push(offset)
  }
  if (settings.mode === 'complete' || ends.length === 0) ends.splice(0, ends.length, settings.source.length)
  try {
    render(settings.source)
    await settle(settings.source)
    render('')
    await settle('')
    await pause(150, signal)
    input.value = ''
    input.focus({ preventScroll: true })

    if (longTasksSupported) {
      observer = new PerformanceObserver((list) => longTasks.push(...list.getEntries()))
      observer.observe({ entryTypes: ['longtask'] })
    }
    let previousFrame: number | undefined
    const sampleFrame = (time: number) => {
      if (previousFrame !== undefined) gaps.push(time - previousFrame)
      previousFrame = time
      frame = requestAnimationFrame(sampleFrame)
    }
    frame = requestAnimationFrame(sampleFrame)

    let finalSubmitted = false
    let finalSubmission = 0
    let maxDeliveryDelayMs = 0
    const started = performance.now()
    typing = measureTyping(input, started)
    input.dataset.measuring = 'true'
    let startWatchdog = () => {}
    const complete = new Promise<number>((resolve, reject) => {
      const check = () => {
        if (renderError) { reject(renderError); return }
        if (finalSubmitted && ready(settings.source)) resolve(performance.now())
      }
      domObserver = new MutationObserver(check)
      domObserver.observe(host, { subtree: true, childList: true, characterData: true, attributes: true })
      const abort = () => reject(signal.reason)
      signal.addEventListener('abort', abort, { once: true })
      removeAbort = () => signal.removeEventListener('abort', abort)
      // Start the final-output watchdog after delivery, so slower streaming
      // under load is measured rather than mistaken for a missing final render.
      startWatchdog = () => {
        timeout = window.setTimeout(() => reject(new Error('Final highlighted output timed out')), 15000)
      }
    })
    // Attach a rejection handler immediately while delivery is still running.
    void complete.catch(() => {})
    for (let index = 0; index < ends.length; index++) {
      const due = started + index * settings.intervalMs
      if (index > 0) await pause(Math.max(0, due - performance.now()), signal)
      signal.throwIfAborted()
      maxDeliveryDelayMs = Math.max(maxDeliveryDelayMs, performance.now() - due)
      if (index === ends.length - 1) {
        finalSubmitted = true
        finalSubmission = performance.now()
        startWatchdog()
      }
      typing.progress(settings.source.length ? ends[index] / settings.source.length : 1)
      render(settings.source.slice(0, ends[index]))
    }
    const finished = await complete
    typing.end(finished)
    input.dataset.measuring = 'false'
    cancelAnimationFrame(frame)
    domObserver?.disconnect()
    // Allow delivery of long-task entries, without including this wait in the result.
    await pause(200, signal)
    longTasks.push(...(observer?.takeRecords() ?? []))
    const measuredTasks = longTasks.filter((task) => task.startTime >= started && task.startTime < finished)
    return {
      renderer, repetition,
      durationMs: finished - started,
      finalLatencyMs: finished - finalSubmission,
      frameGapCount: gaps.filter((gap) => gap > 50).length,
      maxFrameGapMs: gaps.length ? Math.max(...gaps) : 0,
      longTaskCount: longTasksSupported ? measuredTasks.length : null,
      longTaskMs: longTasksSupported ? measuredTasks.reduce((sum, task) => sum + task.duration, 0) : null,
      maxDeliveryDelayMs,
      sourcePreserved: host.querySelector('code')?.textContent === settings.source,
      typing: typing.result(),
    }
  } finally {
    clearTimeout(timeout)
    cancelAnimationFrame(frame)
    observer?.disconnect()
    domObserver?.disconnect()
    removeAbort()
    typing?.dispose()
    input.dataset.measuring = 'false'
    root.unmount()
  }
}

export async function runBenchmark(host: HTMLElement, input: HTMLInputElement, settings: Settings, signal: AbortSignal, onTrial: (label: string) => void): Promise<Result[]> {
  const results: Result[] = []
  for (let repetition = 1; repetition <= settings.repetitions; repetition++) {
    const order: Renderer[] = settings.renderer === 'both'
      ? (repetition % 2 ? ['streamcode', 'syntax-highlighter'] : ['syntax-highlighter', 'streamcode'])
      : [settings.renderer]
    for (const renderer of order) {
      signal.throwIfAborted()
      onTrial(`${renderer} · repetition ${repetition}/${settings.repetitions} (includes warmup)`)
      // Let the UI update before warmup and measurement begin.
      await pause(100, signal)
      results.push(await trial(host, input, settings, renderer, repetition, signal))
    }
  }
  return results
}
