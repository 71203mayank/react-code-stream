export interface StreamUpdate {
  source: string
  chunk: string
  receivedCharacters: number
  totalCharacters: number
}

interface StreamOptions {
  onChunk: (update: StreamUpdate) => void
  onComplete?: () => void
  onError?: (reason: unknown) => void
  intervalMs?: number
}

/** Stream a fresh random 5–15 Unicode code points per tick. Returns an idempotent stop function. */
export function simulateStream(source: string, {
  onChunk, onComplete, onError, intervalMs = 80,
}: StreamOptions): () => void {
  const characters = Array.from(source)
  let position = 0
  let accumulated = ''
  const timer = window.setInterval(() => {
    const size = 5 + Math.floor(Math.random() * 11)
    const chunk = characters.slice(position, position + size).join('')
    position = Math.min(position + size, characters.length)
    accumulated += chunk
    try {
      onChunk({ source: accumulated, chunk, receivedCharacters: position, totalCharacters: characters.length })
      if (position === characters.length) {
        stop()
        onComplete?.()
      }
    } catch (reason) {
      stop()
      onError?.(reason)
    }
  }, intervalMs)

  function stop() {
    window.clearInterval(timer)
  }
  return stop
}
