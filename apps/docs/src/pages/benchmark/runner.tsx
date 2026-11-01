import { createRoot } from 'react-dom/client'
import { CodeView } from './renderers'
import type { Renderer } from './labels'

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

async function trial(host: HTMLElement, settings: Settings, renderer: Renderer, repetition: number, signal: AbortSignal): Promise<Result> {
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
  const longTasks: PerformanceEntry[] = []
  const gaps: number[] = []
  const longTasksSupported = typeof PerformanceObserver !== 'undefined' && PerformanceObserver.supportedEntryTypes.includes('longtask')
  const characters = Array.from(settings.source)
  const updates = settings.mode === 'complete' ? [settings.source] : Array.from(
    { length: Math.max(1, Math.ceil(characters.length / settings.chunkSize)) },
    (_, index) => characters.slice(0, (index + 1) * settings.chunkSize).join(''),
  )
  try {
    render(settings.source)
    await settle(settings.source)
    render('')
    await settle('')
    await pause(150, signal)

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
    const complete = new Promise<number>((resolve, reject) => {
      const check = () => {
        if (renderError) { reject(renderError); return }
        if (finalSubmitted && ready(settings.source)) resolve(performance.now())
      }
      domObserver = new MutationObserver(check)
      domObserver.observe(host, { subtree: true, childList: true, characterData: true, attributes: true })
      timeout = window.setTimeout(() => reject(new Error('Final highlighted output timed out')), 15000 + Array.from(settings.source).length / settings.chunkSize * settings.intervalMs)
      const abort = () => reject(signal.reason)
      signal.addEventListener('abort', abort, { once: true })
      removeAbort = () => signal.removeEventListener('abort', abort)
    })
    // Attach a rejection handler immediately while delivery is still running.
    void complete.catch(() => {})
    for (let index = 0; index < updates.length; index++) {
      const due = started + index * settings.intervalMs
      if (index > 0) await pause(Math.max(0, due - performance.now()), signal)
      signal.throwIfAborted()
      maxDeliveryDelayMs = Math.max(maxDeliveryDelayMs, performance.now() - due)
      if (index === updates.length - 1) {
        finalSubmitted = true
        finalSubmission = performance.now()
      }
      render(updates[index])
    }
    const finished = await complete
    cancelAnimationFrame(frame)
    domObserver?.disconnect()
    // Allow delivery of long-task entries, without including this wait in the result.
    await pause(80, signal)
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
    }
  } finally {
    clearTimeout(timeout)
    cancelAnimationFrame(frame)
    observer?.disconnect()
    domObserver?.disconnect()
    removeAbort()
    root.unmount()
  }
}

export async function runBenchmark(host: HTMLElement, settings: Settings, signal: AbortSignal, onTrial: (label: string) => void): Promise<Result[]> {
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
      results.push(await trial(host, settings, renderer, repetition, signal))
    }
  }
  return results
}
