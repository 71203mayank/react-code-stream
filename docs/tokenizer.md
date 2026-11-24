# How the tokenizer works

The tokenizer turns source code into highlighted HTML. Its implementation lives in
[`tokenizer.ts`](../packages/react-code-stream/src/core/tokenizer.ts).

For streaming code, the goal is to highlight new blocks while reusing the output
of completed blocks. To do that correctly, each block needs the grammar context
left by the previous block.

## The problem with highlighting blocks independently

Consider a comment that crosses a block boundary:

```text
Block 1                       Block 2
------------------------      ------------------------
const count = 2;              still inside the comment
/* a comment starts here      */
                              const label = "ready";
```

If block 2 is highlighted from a fresh state, the highlighter does not know that
block 1 opened a comment. It may treat `still inside the comment` as ordinary
code. Multiline strings can have the same problem.

```mermaid
flowchart LR
    A[Block 1] --> B[Highlight from a fresh state]
    C[Block 2] --> D[Highlight from a fresh state]
    D --> E[Missing context from block 1]
```

Highlighting all accumulated source again would restore that context, but it
would also repeat work on completed blocks whenever more text arrives.

## Why we use Shiki

We use Shiki because it provides language grammars, themes, and an API for
continuing highlighting from a previous grammar state. It handles the language
rules, so this project can focus on splitting, caching, and rendering blocks.

A grammar state records the context at the end of a block, such as whether a
multiline comment is still open. Passing that state into the next block lets
Shiki continue with the context it needs.

Shiki does not inherently highlight without state. The problem arises when we
highlight separate blocks independently and discard their context. Its grammar
state API lets us preserve that context explicitly.

```mermaid
flowchart LR
    A[Block 1 + no previous state] --> B[Highlight block 1]
    B --> C[HTML for block 1]
    B --> D[State after block 1]
    D --> E[Highlight block 2 with its source]
    E --> F[HTML for block 2]
    E --> G[State after block 2]
    G --> H[Continue with block 3]
```

## JavaScript regex engine

The standalone tokenizer factories and shared highlighter manager explicitly use:

```ts
engine: createJavaScriptRegexEngine({ forgiving: true })
```

Shiki's JavaScript engine converts TextMate grammar patterns to native JavaScript
regular expressions. This avoids requiring the Oniguruma WebAssembly engine for
highlighting. It does not make initialization or tokenization free: grammar/theme
loading and regex conversion still have costs.

`forgiving: true` suppresses unsupported-pattern conversion errors for best-effort
highlighting. Some patterns may therefore produce highlighting mismatches; it does
not guarantee identical results to Oniguruma or suppress every highlighting error.
Runtime regex support can also affect grammar compatibility. See
[Shiki's regex engine guide](https://shiki.style/guide/regex-engines) for engine
behavior and compatibility details.

## Shared versus independently owned tokenizers

`StreamCode` uses the shared manager described in the
[architecture](./architecture.md#shared-initialization-and-prewarming), rather than
creating a new highlighter for every mount. `prewarmCodeStream` loads languages
and themes into that same shared highlighter. Its tokenizer wrappers capture a
theme but retain no per-stream grammar state and expose no disposal method.

The factories below create independent highlighters. Calling
`createGrammarStateCodeTokenizer` does not reuse resources loaded by
`prewarmCodeStream`; dispose that owned tokenizer when finished.
`createGrammarStateTokenizerFromHighlighter` instead borrows an existing
highlighter whose languages and theme must already be loaded. The owner controls
that highlighter's lifetime.

## The two tokenizer functions

| Function | Purpose | Returns |
| --- | --- | --- |
| `createCodeTokenizer` | Highlight a complete source string from a fresh state. | HTML |
| `createGrammarStateCodeTokenizer` | Highlight a block with optional context from the previous block. | HTML and the outgoing grammar state |

Both functions initialize Shiki asynchronously and preload the configured
languages and theme. After initialization, their `highlight` methods are
synchronous. Reuse the tokenizer instance across updates.

The default theme is `github-dark`. If a requested language is not loaded, the
tokenizer falls back to plain text.

## Highlighting a block in one pass

`createGrammarStateCodeTokenizer` accepts the block's source, its language, and
an optional `lastGrammarState`. Omit the state for the first block.

```mermaid
flowchart TD
    A[Block source + language + optional previous state] --> B[Resolve language or fall back to plain text]
    B --> C[Shiki codeToHast with grammarState]
    C --> D[Highlighted tree: HAST]
    D --> E[hastToHtml]
    D --> F[highlighter.getLastGrammarState]
    E --> G[Return html and currentGrammarState]
    F --> G
```

HAST is a tree representation of HTML. Shiki tokenizes the source and builds
this highlighted tree once. We then serialize the tree into an HTML string and
retrieve the grammar state associated with that same tree.

Previously, calling `codeToHtml` and `codeToTokens` separately tokenized the same
block twice. Using `codeToHast` removes that duplicate tokenization. HTML
serialization is still required; the actual speed improvement depends on the
source and should be measured.

```ts
const tokenizer = await createGrammarStateCodeTokenizer();

const first = tokenizer.highlight('/* comment begins', 'typescript');
const second = tokenizer.highlight(
  'comment ends */\nconst count = 2;',
  'typescript',
  first.currentGrammarState,
);

// first.html and second.html can be rendered as separate blocks.
// second.currentGrammarState is the input state for the next block.
```

`currentGrammarState` can be `undefined`, including for plain-text output. Treat
the state as an opaque object: keep it for continuation rather than trying to
reconstruct it from its displayed JSON fields.

## How this supports block caching

The tokenizer provides the pieces needed by a cache. It does not store or
invalidate cached blocks itself.

```mermaid
flowchart TD
    A[New source arrives] --> B[Update the unfinished trailing block]
    B --> C[Highlight using the previous completed block's state]
    C --> D[Store source, HTML, and outgoing state]
    D --> E[Reuse completed blocks on later updates]
```

Follow these rules when adding the cache:

- Split blocks at complete line boundaries. An arbitrary character boundary can
  cut through a token; a grammar state is not a general cursor for resuming in
  the middle of a line.
- Keep the unfinished trailing block editable. When it grows, highlight it again
  using the state from the previous completed block, not its own previous result.
- Reuse states within the same tokenizer instance, language, and theme. Reset
  the cache when those settings change.
- If an earlier block changes, recompute it and the dependent blocks after it.
- Each tokenizer result includes `pre` and `code` wrappers. `StreamCode` extracts
  their inner markup and renders block spans inside a single `pre`/`code` container.

`StreamCode` fixes the block size at ten newline-terminated lines. Long lines can
still make an individual block expensive; the time budget is checked only after
a whole block has been highlighted.

