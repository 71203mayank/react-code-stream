1. Practice Shiki on a whole sample. Use the playground to highlight a complete code sample in a few languages. This gives you a reference result.

2. Experiment with blocks and grammar state. Split one sample into two blocks. Highlight the first, get its grammar state, and highlight the second using that state. Compare the combined output with highlighting the full sample. Try a multi-line comment or string that crosses the boundary.

3. Make the comparison repeatable. Add a Vitest test that checks block-by-block output against full-source output. Start with a few simple examples; expand as you learn what can go wrong.

4. Build incremental.ts. Have it split code into blocks, keep each block’s source, highlighted result, and grammar state, and update the changing trailing block as new text arrives. For now, assume input only appends; a new key resets the cache.

5. Test the cache against full highlighting. After each simulated append, compare the cached result with a full Shiki highlight of the same source. This is the key correctness check.

6. Build StreamCode.tsx. Connect the incremental logic to React and render each block as its own element with a stable key.

7. Measure and improve. Use larger samples and faster update intervals. See whether the cached version does less work and whether React updates only the changed blocks. Add scheduling or DOM optimizations only if your measurements show you need them.


### Block Caching
```
Block A → highlighted output + state after A
Block B → use state after A → highlighted output + state after B
Block C → use state after B → ...
```

```ts
const highlightedA = highlighter.codeToHast(blockA, { lang, theme })
const stateAfterA = highlighter.getLastGrammarState(highlightedA)

const highlightedB = highlighter.codeToHast(blockB, {
  lang,
  theme,
  grammarState: stateAfterA,
})
```
Get the grammar state after highlighting Block A, then pass it in when highlighting Block B. Repeat for later blocks.
