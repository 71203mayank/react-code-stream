# React Code Stream

[![npm version](https://img.shields.io/npm/v/react-code-stream)](https://www.npmjs.com/package/react-code-stream)

A React syntax highlighter designed for code streamed by AI applications.

React Code Stream uses [Shiki](https://shiki.style/) for syntax highlighting and caches completed blocks to avoid reparsing and highlighting the entire code on every incoming stream chunk.

## Features

- Incremental highlighting for streamed code, with support for loading complete code samples too.
- Cached, memoized blocks that keep completed content unchanged during append-only updates.
- Animation-frame scheduling to combine rapid incoming updates.
- Optional auto-scroll that pauses when the reader scrolls away from the bottom.
- Plain-text fallback for unknown languages; highlighting errors are reported through `onError`.

## Local setup

Use Node.js 22.12 or later in the Node.js 22 release line, or Node.js 24, with npm.

```bash
git clone https://github.com/71203mayank/react-code-stream.git
cd react-code-stream
npm ci
```

Start the local playground:

```bash
npm run build:lib
npm run dev --workspace=docs
```

Open the local URL printed by Vite. The **StreamCode corpus preview** lets you choose a sample, simulate streaming, load the complete file, and edit source alongside the highlighted output.

Run the package tests:

```bash
npm run test --workspace=react-code-stream
```

Run the component tests in watch mode:

```bash
npm run test:watch --workspace=react-code-stream -- test/timeBudgetStreamCode.test.ts
```

Build and preview the playground:

```bash
npm run build --workspace=docs
npm run preview --workspace=docs
```

## Component usage

The StreamCode playground uses the built local workspace package. Import the component and its stylesheet:

```tsx
import { StreamCode } from 'react-code-stream'
import 'react-code-stream/styles.css'
```

The lower-level APIs used by the tokenizer and cache demos are also available:

```ts
import { createGrammarStateCodeTokenizer } from 'react-code-stream/tokenizer'
import { createIncrementalTokenizer } from 'react-code-stream/incremental'
```

The package provides ESM output and TypeScript declarations, and currently targets React 19.2. Pass the entire accumulated code string as children on each update:

```tsx
<StreamCode
  key={fileId}
  language="typescript"
  autoScroll
  style={{ maxHeight: 430 }}
>
  {code}
</StreamCode>
```

**Required for distinguishing files: pass a stable, unique file or stream ID as
React's `key`.** Keep it unchanged for every chunk of the same file so its
highlighting cache is preserved. Change it when starting a different file or a new
stream, even if the language and theme stay the same. React then remounts the
component, clears the previous cache, and cancels pending highlighting work.

```tsx
<StreamCode key={fileId} language="typescript">
  {code}
</StreamCode>
```

Do not use the code contents, chunk number, or a randomly generated value as the
key: changing it on each update discards the cache. The internal language/theme
key cannot distinguish two files with the same language and theme. `key` is a
special React attribute, not a field in `StreamCodeProps`.

To highlight a complete file, pass its full contents as `code` in one update.

### Props

| Prop | Default | Purpose |
| --- | --- | --- |
| `children` | Required | Entire source received so far, as a string. |
| `language` | `text` | Language to highlight. Unknown languages use plain text. |
| `theme` | `github-dark` | Shiki theme identifier. |
| `autoScroll` | `false` | Follow updates while the reader is near the bottom. |
| `className` | — | Additional class for the scroll container. |
| `style` | — | Container styles, such as `height` or `maxHeight`. |
| `onError` | — | Receives initialization or highlighting errors; the code view clears. |
| `aria-label` | `Source code` | Accessible name for the scroll container. |

Blocks contain ten complete lines. Block size, the 8 ms processing target, and
the 8 ms continuation delay are fixed internally. The target is checked between
whole blocks, so a slow block can exceed it. Highlighted output
can lag incoming source while pending work finishes.

## Prewarming (optional)

The first code view needs to load its language and theme before it can highlight
code. Prewarming starts that work earlier, so a code view opened later can reuse
those resources.

Import `useEffect` and `prewarmCodeStream`:

```tsx
import { useEffect } from 'react'
import { prewarmCodeStream } from 'react-code-stream'
```

Place this `useEffect` inside your app or component to prewarm when it mounts:

```tsx
useEffect(() => {
  void prewarmCodeStream({
    languages: ['typescript', 'tsx'],
    themes: ['github-dark'],
  }).catch((error: unknown) => {
    console.error('Could not preload code highlighting resources:', error)
  })
}, [])
```

Choose the languages and themes your code views will use. Both lists are optional;
without options, the call initializes the shared highlighter only.

**Prewarming is optional.** `StreamCode` loads any missing resources automatically.
If it mounts while prewarming is still running, it shares the pending work.
Calling prewarm from the same component as the code view is safe, but starting it
in an earlier-mounted parent gives loading more time to finish.

Prewarming loads resources; it does not highlight code in advance. The promise
resolves when the requested resources are ready and rejects if loading fails.

## Package development

Build the library's JavaScript, stylesheet, and TypeScript declarations:

```bash
npm run build:lib
```

Run type checking, tests, a build, and a package contents preview:

```bash
npm run check --workspace=react-code-stream
```

Create a local package archive for testing in another app:

```bash
npm pack --workspace=react-code-stream
```

The archive includes the built files, README, and license. Tests stay in the repository and are excluded from the archive.

## Repository structure

| Directory | Purpose |
| --- | --- |
| [`packages/react-code-stream`](packages/react-code-stream) | The React component, Shiki tokenizer, incremental block cache, and tests. |
| [`apps/docs`](apps/docs) | The documentation playground and shared sample code files. |
| [`docs`](docs) | Project notes explaining the design, tokenizer, and block cache. |

Start with the [project overview](docs/project-overview.md) and [architecture](docs/architecture.md) for more detail.

## License

[MIT](LICENSE).

The local-only [benchmark app](apps/benchmark/docs/README.md) compares StreamCode with PrismLight. Run `npm run benchmark` and open the local preview URL.
