import { copyFile } from 'node:fs/promises'

// The package README is maintained separately for npm consumers.
await copyFile(
  new URL('../../../LICENSE', import.meta.url),
  new URL('../LICENSE', import.meta.url),
)

// Preserve the CSS module declaration referenced by the component's generated types.
await copyFile(
  new URL('../src/react/StreamCode.css.d.ts', import.meta.url),
  new URL('../dist/react/StreamCode.css.d.ts', import.meta.url),
)
