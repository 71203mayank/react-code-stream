import { copyFile } from 'node:fs/promises'

for (const name of ['README.md', 'LICENSE']) {
  await copyFile(new URL(`../../../${name}`, import.meta.url), new URL(`../${name}`, import.meta.url))
}

// Preserve the CSS module declaration referenced by the component's generated types.
await copyFile(
  new URL('../src/react/StreamCode.css.d.ts', import.meta.url),
  new URL('../dist/react/StreamCode.css.d.ts', import.meta.url),
)
