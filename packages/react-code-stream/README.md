# React Code Stream

A React syntax highlighter for code streamed by AI applications. Pass the growing
code string to `StreamCode`; it highlights new content and reuses completed blocks.

## Installation

```bash
npm install react-code-stream
```

Requires React `^19.2.0`. The package includes TypeScript declarations and ESM output.

## Component usage

Import the component and its stylesheet, then pass the entire accumulated code
string as children on every update:

```tsx
import { StreamCode } from 'react-code-stream'
import 'react-code-stream/styles.css'

export function CodePreview({ code, fileId }: { code: string; fileId: string }) {
  return (
    <StreamCode
      key={fileId}
      language="typescript"
      theme="github-dark"
      autoScroll
      style={{ maxHeight: 430 }}
      onError={(error) => console.error('Code highlighting failed:', error)}
    >
      {code}
    </StreamCode>
  )
}
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

To highlight a complete file, pass the full source in a single update.
Import the stylesheet once in your app.

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

## Languages and themes

Use bundled language identifiers such as `typescript`, `javascript`, `tsx`,
`python`, `html`, and `css`. See [Shiki's bundled languages](https://shiki.style/languages)
for identifiers available in Shiki; availability depends on the installed Shiki version.
The default is plain text (`text`).

Set `theme` to a bundled theme identifier such as `github-dark`, `github-light`,
or `nord`. See [Shiki's bundled themes](https://shiki.style/themes).
Languages and themes load when needed; no separate Shiki setup is required.
An invalid theme is reported through `onError`.

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

[GitHub repository](https://github.com/71203mayank/react-code-stream)
