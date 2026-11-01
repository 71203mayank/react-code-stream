import { lazy, Suspense } from 'react'

const Playground = lazy(() => import('./App'))
const Benchmark = lazy(() => import('./pages/benchmark'))

export default function Routes() {
  const Page = window.location.pathname.replace(/\/$/, '') === '/benchmark' ? Benchmark : Playground
  return <Suspense fallback={<p>Loading…</p>}><Page /></Suspense>
}
