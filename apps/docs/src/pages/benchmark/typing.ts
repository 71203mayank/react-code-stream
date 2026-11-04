export type StreamStage = 'early' | 'middle' | 'late'
export interface KeySample {
  startTime: number
  progress: number
  stage: StreamStage
  delayMs: number
}
export interface EventSample extends KeySample {
  processingMs: number
  durationMs: number
}
export interface TypingResult {
  eventTimingSupported: boolean
  keydowns: KeySample[]
  events: EventSample[]
}

/** No characters or key values are retained; only trusted keydown timings. */
export function measureTyping(input: HTMLInputElement, started: number) {
  const keydowns: KeySample[] = []
  const events: EventSample[] = []
  const progress: { time: number; fraction: number }[] = [{ time: started, fraction: 0 }]
  const metadata = (time: number) => {
    let fraction = 0
    for (let index = progress.length - 1; index >= 0; index--) {
      if (progress[index].time <= time) { fraction = progress[index].fraction; break }
    }
    const stage: StreamStage = fraction < 1 / 3 ? 'early' : fraction < 2 / 3 ? 'middle' : 'late'
    return { startTime: time - started, progress: fraction, stage }
  }
  let ended = Infinity
  const keydown = (event: KeyboardEvent) => {
    const now = performance.now()
    const time = event.timeStamp > performance.timeOrigin ? event.timeStamp - performance.timeOrigin : event.timeStamp
    if (!event.isTrusted || time < started || time > ended) return
    keydowns.push({ ...metadata(time), delayMs: Math.max(0, now - time) })
  }
  input.addEventListener('keydown', keydown, { capture: true })
  let observer: PerformanceObserver | undefined
  let supported = typeof PerformanceObserver !== 'undefined' && PerformanceObserver.supportedEntryTypes.includes('event')
  const collect = (entries: PerformanceEntry[]) => {
    for (const entry of entries) {
      const timing = entry as PerformanceEventTiming
      if (timing.name !== 'keydown' || timing.target !== input || timing.startTime < started || timing.startTime > ended) continue
      events.push({
        ...metadata(timing.startTime),
        delayMs: Math.max(0, timing.processingStart - timing.startTime),
        processingMs: Math.max(0, timing.processingEnd - timing.processingStart),
        durationMs: timing.duration,
      })
    }
  }
  if (supported) {
    try {
      observer = new PerformanceObserver((list) => collect(list.getEntries()))
      observer.observe({ type: 'event', durationThreshold: 16 } as PerformanceObserverInit)
    } catch {
      observer?.disconnect()
      supported = false
    }
  }
  return {
    progress(fraction: number) { progress.push({ time: performance.now(), fraction }) },
    end(time: number) { ended = time },
    result(): TypingResult {
      collect(observer?.takeRecords() ?? [])
      return {
        eventTimingSupported: supported,
        keydowns: keydowns.filter((key) => key.startTime <= ended - started),
        events: events.filter((event) => event.startTime <= ended - started),
      }
    },
    dispose() {
      observer?.disconnect()
      input.removeEventListener('keydown', keydown, { capture: true })
    },
  }
}
