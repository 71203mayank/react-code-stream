import { rendererNames, type Renderer } from './labels'
import { percentile, type Result } from './runner'
import type { StreamStage } from './typing'

export default function TypingResults({ results }: { results: Result[] }) {
  const renderers = (['streamcode', 'syntax-highlighter'] as Renderer[]).filter((renderer) => results.some((run) => run.renderer === renderer))
  const summary = (values: number[]) => values.length
    ? `${percentile(values, .5).toFixed(2)} / ${percentile(values, .95).toFixed(2)} ms (n=${values.length})`
    : 'No samples'
  return <section aria-labelledby="typing-results-title">
    <h3 id="typing-results-title">Typing responsiveness</h3>
    <p>Values are median / p95 across pooled keydown samples. Stages use the amount of source submitted when the key event occurred.</p>
    <div className="table-scroll"><table>
      <thead><tr><th>Metric</th>{renderers.map((renderer) => <th key={renderer}>{rendererNames[renderer]}</th>)}</tr></thead>
      <tbody>
        <tr><th scope="row">Trusted keydowns recorded</th>{renderers.map((renderer) => <td key={renderer}>{results.filter((run) => run.renderer === renderer).reduce((sum, run) => sum + run.typing.keydowns.length, 0)}</td>)}</tr>
        {(['all', 'early', 'middle', 'late'] as const).map((stage) => <tr key={stage}>
          <th scope="row">Keydown dispatch delay · {stage === 'all' ? 'all source sizes' : `${stage} third`}</th>
          {renderers.map((renderer) => <td key={renderer}>{summary(results.filter((run) => run.renderer === renderer)
            .flatMap((run) => run.typing.keydowns).filter((key) => stage === 'all' || key.stage === (stage as StreamStage)).map((key) => key.delayMs))}</td>)}
        </tr>)}
        <tr><th scope="row">Event Timing input delay · reported keydowns only</th>{renderers.map((renderer) => {
          const runs = results.filter((run) => run.renderer === renderer)
          return <td key={renderer}>{runs.some((run) => run.typing.eventTimingSupported)
            ? summary(runs.flatMap((run) => run.typing.events).map((event) => event.delayMs)) : 'Not supported'}</td>
        })}</tr>
        <tr><th scope="row">Event Timing event-to-next-paint duration · reported keydowns only</th>{renderers.map((renderer) => {
          const runs = results.filter((run) => run.renderer === renderer)
          return <td key={renderer}>{runs.some((run) => run.typing.eventTimingSupported)
            ? summary(runs.flatMap((run) => run.typing.events).map((event) => event.durationMs)) : 'Not supported'}</td>
        })}</tr>
      </tbody>
    </table></div>
    <p>Dispatch delay is an approximation from the event timestamp to our native capture handler. Event Timing uses browser processing timestamps, but only exposes events meeting its 16 ms duration threshold; those samples are a filtered subset, not all keystrokes. No samples does not mean zero delay. These measurements are not INP.</p>
  </section>
}
