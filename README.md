# React Code Stream

A React syntax highlighter designed for code streamed by AI applications.

🚧 **Experimental and under active development.** 🚧

React Code Stream uses [Shiki](https://shiki.style/) for syntax highlighting and caches completed blocks to avoid reparsing and highlighting the entire code on every incoming stream chunk.

## Features

- Incremental highlighting for streamed code, with support for loading complete code samples too.
- Cached, memoized blocks that keep completed content unchanged during append-only updates.
- Animation-frame scheduling to combine rapid incoming updates.
- Optional auto-scroll that pauses when the reader scrolls away from the bottom.
- Plain-text fallback when highlighting fails.

## Local setup

Use Node.js 22.12 or later in the Node.js 22 release line, or Node.js 24, with npm.

```bash
git clone https://github.com/71203mayank/react-code-stream.git
cd react-code-stream
npm ci
```

Start the local playground:

```bash
npm run dev --workspace=docs
```

Open the local URL printed by Vite. The **StreamCode corpus preview** lets you choose a sample, simulate streaming, load the complete file, and edit source alongside the highlighted output.

Run the package tests:

```bash
npm run test --workspace=react-code-stream
```

Run the component tests in watch mode:

```bash
npm run test:watch --workspace=react-code-stream -- test/streamcode.test.ts
```

Build and preview the playground:

```bash
npm run build --workspace=docs
npm run preview --workspace=docs
```

## Component usage

The playground imports `StreamCode` directly from the package source. Pass the entire accumulated code string as children on each update:

```tsx
<StreamCode
  key={fileID}
  language="typescript"
  linesPerBlock={10}
  autoScroll
  style={{ maxHeight: 430 }}
>
  {code}
</StreamCode>
```

Keep the key stable while streaming the same file. Change it to start a new highlighting session. To highlight a complete file, pass its full contents as `code` in one update.

## Repository structure

| Directory | Purpose |
| --- | --- |
| [`packages/react-code-stream`](packages/react-code-stream) | The React component, Shiki tokenizer, incremental block cache, and tests. |
| [`apps/docs`](apps/docs) | The local playground with interactive demos and sample code files. |
| [`docs`](docs) | Project notes explaining the design, tokenizer, and block cache. |

Start with the [project overview](docs/project-overview.md) and [architecture](docs/architecture.md) for more detail.

## License

[MIT](LICENSE).
