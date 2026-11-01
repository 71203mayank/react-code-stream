import * as React from 'react'
import { rendererNames, type Renderer } from './labels'
import { percentile, runBenchmark, type Result, type Settings } from './runner'
import './style.css'

const files = import.meta.glob<string>('../../testCorpus/*.txt', { query: '?raw', import: 'default', eager: true })
const samples = [
  ['sample.ts.txt', 'typescript'], ['sample.js.txt', 'javascript'], ['sample.py.txt', 'python'],
  ['sample.cpp.txt', 'cpp'], ['sample.go.txt', 'go'], ['sample.html.txt', 'html'],
  ['sample.css.txt', 'css'], ['sample-text.txt', 'text'],
]

interface Report {
  settings: Omit<Settings, 'source'>
  results: Result[]
  userAgent: string
  timestamp: string
  production: boolean
  viewport: { width: number; height: number; devicePixelRatio: number }
  hardwareConcurrency: number
  sourceCodePoints: number
}

function Results({ report }: { report: Report }) {
  function download() {
    const url = URL.createObjectURL(new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' }))
    const link = document.createElement('a')
    link.href = url
    link.download = `benchmark-${report.settings.file}-${Date.now()}.json`
    link.click()
    URL.revokeObjectURL(url)
  }
  const ms = (value: number) => `${value.toFixed(2)} ms`
  return <section aria-labelledby="results-title">
    <h2 id="results-title">Results</h2>
    <p>{report.settings.file} · {report.settings.mode} · {report.production ? 'Production build' : 'Development build'} · {report.settings.repetitions} measured runs per renderer</p>
    <div className="table-scroll"><table>
      <thead><tr><th>Metric</th>{(['streamcode', 'syntax-highlighter'] as Renderer[]).filter((renderer) => report.results.some((result) => result.renderer === renderer)).map((renderer) => <th key={renderer}>{rendererNames[renderer]}</th>)}</tr></thead>
      <tbody>{[
        ['Final DOM latency · median', (runs: Result[]) => ms(percentile(runs.map((run) => run.finalLatencyMs), .5))],
        ['Final DOM latency · p95', (runs: Result[]) => ms(percentile(runs.map((run) => run.finalLatencyMs), .95))],
        ['Elapsed duration · median', (runs: Result[]) => ms(percentile(runs.map((run) => run.durationMs), .5))],
        ['Long tasks >50 ms · median count', (runs: Result[]) => runs[0].longTaskCount === null ? 'Not supported' : String(percentile(runs.map((run) => run.longTaskCount!), .5))],
        ['Long-task duration · median', (runs: Result[]) => runs[0].longTaskMs === null ? 'Not supported' : ms(percentile(runs.map((run) => run.longTaskMs!), .5))],
        ['Frame gaps >50 ms · median count', (runs: Result[]) => String(percentile(runs.map((run) => run.frameGapCount), .5))],
        ['Largest observed frame gap', (runs: Result[]) => ms(Math.max(...runs.map((run) => run.maxFrameGapMs)))],
        ['Largest input delivery delay', (runs: Result[]) => ms(Math.max(...runs.map((run) => run.maxDeliveryDelayMs)))],
        ['Source preserved', (runs: Result[]) => runs.every((run) => run.sourcePreserved) ? 'PASS' : 'FAIL'],
      ].map(([label, format]) => <tr key={label as string}><th scope="row">{label as string}</th>{(['streamcode', 'syntax-highlighter'] as Renderer[]).map((renderer) => {
        const runs = report.results.filter((run) => run.renderer === renderer)
        return runs.length ? <td key={renderer}>{(format as (runs: Result[]) => string)(runs)}</td> : null
      })}</tr>)}</tbody>
    </table></div>
    <button onClick={download}>Download raw results (JSON)</button>
  </section>
}

export default function BenchmarkPage() {
  const [file, setFile] = React.useState(samples[0][0])
  const [renderer, setRenderer] = React.useState<Renderer | 'both'>('both')
  const [mode, setMode] = React.useState<'stream' | 'complete'>('stream')
  const [chunkSize, setChunkSize] = React.useState(10)
  const [intervalMs, setIntervalMs] = React.useState(80)
  const [repetitions, setRepetitions] = React.useState(5)
  const [status, setStatus] = React.useState('Ready')
  const [running, setRunning] = React.useState(false)
  const [report, setReport] = React.useState<Report | null>(null)
  const host = React.useRef<HTMLDivElement>(null)
  const controller = React.useRef<AbortController | null>(null)
  const mounted = React.useRef(true)

  React.useEffect(() => {
    mounted.current = true
    const hidden = () => {
      if (document.hidden) controller.current?.abort(new Error('Run cancelled because the tab became hidden. Keep this tab visible.'))
    }
    document.addEventListener('visibilitychange', hidden)
    return () => {
      mounted.current = false
      controller.current?.abort(new Error('Benchmark unmounted'))
      document.removeEventListener('visibilitychange', hidden)
    }
  }, [])

  async function start() {
    if (!host.current || running) return
    const abort = new AbortController()
    controller.current = abort
    setRunning(true)
    setReport(null)
    const language = samples.find(([name]) => name === file)![1]
    const settings: Settings = { file, language, source: files[`../../testCorpus/${file}`], renderer, mode, chunkSize, intervalMs, repetitions }
    try {
      if (document.hidden) throw new Error('Keep the benchmark tab visible.')
      const results = await runBenchmark(host.current, settings, abort.signal, (label) => {
        if (mounted.current) setStatus(label)
      })
      if (mounted.current) {
        const saved = { file, language, renderer, mode, chunkSize, intervalMs, repetitions }
        setReport({
          settings: saved, results, userAgent: navigator.userAgent,
          timestamp: new Date().toISOString(), production: import.meta.env.PROD,
          viewport: { width: innerWidth, height: innerHeight, devicePixelRatio },
          hardwareConcurrency: navigator.hardwareConcurrency,
          sourceCodePoints: Array.from(settings.source).length,
        })
        setStatus('Complete')
      }
    } catch (reason) {
      if (mounted.current) setStatus(reason instanceof Error ? reason.message : String(reason))
    } finally {
      controller.current = null
      if (mounted.current) setRunning(false)
    }
  }

  const sourceLength = Array.from(files[`../../testCorpus/${file}`]).length
  const scheduledSeconds = mode === 'stream'
    ? Math.max(0, Math.ceil(sourceLength / chunkSize) - 1) * intervalMs / 1000 * repetitions * (renderer === 'both' ? 2 : 1)
    : 0

  return <main className="benchmark-page">
    <a href="/">← Back to playground</a>
    <p className="eyebrow">React Code Stream</p>
    <h1>Highlighting benchmark</h1>
    <p>Compare warm full-file and streaming rendering using the existing docs corpus. Each trial warms up its renderer before measurement. Results update after all runs finish.</p>
    {!import.meta.env.PROD && <p className="notice">Development build: use the production preview for reportable results.</p>}
    <fieldset disabled={running}>
      <legend>Benchmark settings</legend>
      <label>Renderer<select value={renderer} onChange={(event) => setRenderer(event.target.value as Renderer | 'both')}>
        <option value="both">Run both (alternating order)</option>
        {Object.entries(rendererNames).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
      </select></label>
      <label>Corpus<select value={file} onChange={(event) => setFile(event.target.value)}>{samples.map(([name]) => <option key={name}>{name}</option>)}</select></label>
      <label>Mode<select value={mode} onChange={(event) => setMode(event.target.value as 'stream' | 'complete')}><option value="stream">Streaming</option><option value="complete">Complete file</option></select></label>
      <label>Chunk size (Unicode code points)<input type="number" min="1" max="10000" value={chunkSize} disabled={mode === 'complete'} onChange={(event) => setChunkSize(Math.max(1, Math.min(10000, Number(event.target.value) || 1)))} /></label>
      <label>Chunk interval (ms)<input type="number" min="1" max="1000" value={intervalMs} disabled={mode === 'complete'} onChange={(event) => setIntervalMs(Math.max(1, Math.min(1000, Number(event.target.value) || 1)))} /></label>
      <label>Repetitions per renderer<input type="number" min="1" max="20" value={repetitions} onChange={(event) => setRepetitions(Math.max(1, Math.min(20, Number(event.target.value) || 1)))} /></label>
    </fieldset>
    <p>{sourceLength.toLocaleString()} Unicode code points · {scheduledSeconds.toFixed(1)} seconds of scheduled delivery across all trials, plus warmup and rendering time.</p>
    <div className="actions"><button onClick={() => void start()} disabled={running}>Run benchmark</button><button onClick={() => controller.current?.abort(new Error('Cancelled by user'))} disabled={!running}>Cancel</button></div>
    <p role="status">{status}</p>
    <h2>Measured renderer</h2>
    <div ref={host} className="output" />
    {report && <Results report={report} />}
    <section className="notes"><h2>Reading the results</h2>
      <ul>
        <li>Final DOM latency measures the last source submission until matching highlighted text is observed in the DOM. It does not measure pixel presentation or every chunk's latency.</li>
        <li>Elapsed duration includes the scheduled streaming time. It is not a CPU-time score.</li>
        <li>Frame gaps over 50 ms indicate slow animation-frame delivery, not an exact dropped-frame count. Very short runs may have no frame samples.</li>
        <li>Long tasks are browser-wide main-thread tasks during measurement, not component-specific CPU time. Unsupported browsers show “Not supported”.</li>
        <li>Keep this tab visible, close DevTools and other busy tabs, and use the same browser, viewport, and machine for comparisons. Auto-scroll is disabled.</li>
        <li>Each trial starts with a fresh component and an unmeasured full-file warmup. StreamCode uses 10 lines per block; PrismLight uses registered corpus languages. Engines and themes differ.</li>
        <li>p95 is calculated across repeated final-update measurements. Use more repetitions for a more useful distribution.</li>
      </ul>
    </section>
  </main>
}

