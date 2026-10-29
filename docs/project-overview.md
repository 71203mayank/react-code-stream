# Project overview

`react-code-stream` is a personal learning project: a small React code highlighter for code that arrives a little at a time, such as an AI response.

The project is a monorepo:

- `packages/react-code-stream` contains the reusable React package and its core logic.
- `apps/docs` is a playground for trying the highlighter in a browser.

The package uses Shiki for syntax highlighting. The main idea we want to explore is **block caching**: keep the highlighted output for code that has already arrived, and update only the blocks affected by new text.

Shiki also provides **grammar state**, which carries syntax context from one piece of code into the next. We will experiment with using that state between cached blocks, especially for syntax that spans multiple lines. The cache should be compared with Shiki highlighting the complete source so we can see whether the output stays consistent.

Along the way, the project is a place to learn React components, npm workspaces, package structure, Vitest, syntax tokenizers, caching, and rendering performance.
