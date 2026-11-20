# Local highlighting benchmark

Run `npm ci` at the repository root, then `npm run benchmark`. Open the local
preview URL printed by Vite. This command builds the library and benchmark in
production mode. The app is for local use; no hosting is required.

- `/streamcode`: StreamCode versus react-syntax-highlighter's PrismLight.
- `/time-budget`: TimeBudgetStreamCode versus the same PrismLight comparator.

Navigation reloads the page and cancels any ongoing trial. Corpus files remain
in `apps/docs/src/testCorpus`; Vite bundles those exact files as raw text.

## Workloads and controls

Streaming submits accumulated source in Unicode code-point chunks against an
absolute delivery schedule. Chunk size and interval control offered load. Late
input is delivered rather than silently discarded; maximum delivery delay shows
when the browser cannot keep up. Complete-file mode submits the entire file once,
measuring bulk rendering rather than incremental performance. Corpus languages
exercise grammar differences; the large TypeScript sample exposes growing-file
costs. These fixtures are representative examples, not an exhaustive workload.

Both package components use ten lines per block with auto-scroll disabled.
TimeBudgetStreamCode uses an 8 ms processing target and an 8 ms continuation delay.
The target is checked between blocks: one expensive block can exceed it. React
rendering, DOM work, and grammar initialization are not bounded by that target.

Full-file warmup is enabled by default. Each trial mounts a fresh component,
renders the full file outside measurement, then clears it and waits before
submitting the measured workload. Disable warmup to start delivery on an unmounted
renderer: component initialization and asynchronous Shiki setup then count toward
completion. No full-file pre-render happens in this mode. Source fixture loading
is outside measurement in both modes. Neither mode resets browser module, network,
JIT, or engine caches. For an exploratory first-use measurement, reload the page
and record a single trial; do not call repeated no-warmup trials cold starts.

## Measurements and relevance

| Measurement | Meaning and practical relevance |
| --- | --- |
| Final DOM latency | Time from final source submission to observing exact highlighted text. Measures catch-up at stream end; excludes pixel presentation and does not describe every chunk. |
| Elapsed duration | First submission scheduling to final DOM completion. Includes intentional delivery waits; it is not CPU time. |
| Long tasks | Browser tasks starting within measurement and exceeding 50 ms. Indicates main-thread contention; includes harness and unrelated browser work. Unsupported APIs return null. Full task duration is counted even if it crosses the end boundary. |
| Frame gaps | Animation-frame gaps exceeding 50 ms and maximum observed gap. Suggests responsiveness problems; not a dropped-frame count. Short trials can have no frame samples. |
| Delivery delay | Largest lateness against the intended input schedule. Reveals overload that could otherwise hide behind slow input delivery. |
| Source preserved | Exact final code text matches the original source, including newlines. A failed check invalidates a performance comparison. This does not prove token-color correctness. |
| Typing dispatch delay | Trusted key event timestamp to capture-handler execution. Approximates input queue delay while highlighting. Stages reflect the submitted source fraction, not highlighted progress. |
| Event Timing | Browser-reported keyboard input delay and event-to-next-paint duration, where supported. The 16 ms reporting threshold filters samples; missing events do not mean zero latency. This is not INP. |

Final completion requires text equality plus highlighted block markup for package
renderers, so completion requires published highlighting rather than just an empty
loading container. DOM mutations trigger completion checks. A 15-second
watchdog after final submission rejects incomplete runs. Errors and cancellation
produce no completed report. Each trial releases its React root and observers.

## Reproducibility and interpretation

Use production preview, keep the tab visible, close DevTools and busy applications,
and keep browser version, power mode, hardware, viewport, corpus, and delivery
settings fixed. Hidden tabs abort the run. Repeat measurements in multiple fresh
sessions. Comparators alternate first position across repetitions, reducing order
bias without eliminating thermal or cache effects. The two component routes run
separately: compare exported reports with identical settings and alternate route
order across sessions.

The default five repetitions are exploratory. Median and nearest-rank p95 are
computed across trial-level final latencies, not per-chunk latencies. With fewer
than twenty trials p95 is effectively the maximum; even twenty is a small tail
sample. Inspect raw runs rather than claiming statistical significance from a
small difference. Typing summaries pool trusted keydown samples, so runs with
more typing carry more weight. Manual typing is exploratory; repeatable input
comparisons need a fixed real-keyboard automation schedule. Synthetic JavaScript
keyboard events are excluded. Typed text and key values are not exported.

JSON exports retain settings (including route variant and warmup), individual
trials, timestamp, production flag, user agent, hardware concurrency, viewport,
and source length. Retain the repository commit and machine/power details with
published results. Engines and themes differ (Shiki github-dark versus Prism
vscDarkPlus), so this measures these configured integrations, not a controlled
comparison of identical tokenization engines. No heap or CPU attribution is claimed.
