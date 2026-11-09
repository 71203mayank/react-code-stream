# Time-budgeted highlighting

This is the proposed design, not an implemented feature yet. It builds on our
[tokenizer](./tokenizer.md) and [block cache](./block-cache.md).

The idea is: **highlight some blocks, take a break, then continue from where we
stopped.** Small and large inputs use the same flow.

## Split code into blocks

One complete block contains 10 lines, each ending with a newline. Keep remaining
text in one unfinished block. We highlight that block too, but highlight it again
whenever it grows. Even the tenth line needs its newline to complete the block.
Preserve the original newline characters when splitting.

```text
Block 0: lines  1–10   complete
Block 1: lines 11–20   complete
Block 2: lines 21–24   unfinished; more text may arrive here
```

## Remember where to continue

Keep a cursor called `nextBlockIndex`. It points to the first block that needs
highlighting. Block numbers start at zero.

```text
Block:   0        1        2        3        4
         green    green    green    yellow   yellow
                                   ^
                         nextBlockIndex = 3
```

For each highlighted block, save its source, highlighted HTML, and outgoing
**grammar state**. Grammar state is context for the next block: for example,
“we are still inside a multiline comment.” Process blocks in order and pass that
context forward.

Keep the latest received source separately from highlighting progress. Receiving
block 4 does not mean we have highlighted block 4.

## Work for T milliseconds, then pause

For example, let `T = 20 ms`:

1. Start a clock at the beginning of a processing round.
2. Highlight the block at the cursor, including generating its HTML.
3. Save the result and move the cursor forward.
4. Check elapsed time since the round started.
5. If more work remains and elapsed time is below T, process another block.
6. If more work remains and elapsed time is at least T, continue after a T-ms timer.
7. Show the results from this round. If no work remains, wait for new code.

Each round starts a fresh clock. Waiting time does not consume its budget.
Use `performance.now()` to measure processing time.

```mermaid
flowchart TD
    A["Start round and clock"] --> B["Highlight block at cursor"]
    B --> C["Save result and advance cursor"]
    C --> D{"More blocks to highlight?"}
    D -->|No| E["Show results and wait for new code"]
    D -->|Yes| F{"Elapsed time at least T?"}
    F -->|No| B
    F -->|Yes| G["Show results and set timer for T ms"]
    G --> H["Timer fires"]
    H --> A
```

When idle, schedule the first round with a zero-delay timer. After a budget pause,
use the T-ms timer. Both run the same processing function, regardless of input size.

Internally, `sliceBudgetMs` means how long we work and `continuationDelayMs` means
how long we pause. Initially both equal T. A “slice” simply means one round.

## New code arrives while we wait

```text
T = 20 ms

Round 1: B0 takes 8 ms + B1 takes 7 ms + B2 takes 9 ms = 24 ms.
         Stop after B2. Cursor = 3. Set a timer for 20 ms.

Waiting: B3 grows. B4, B5, and B6 arrive.
         Store the latest source. Keep the same timer.

Round 2: Timer fires. Start a fresh clock.
         B3 takes 12 ms + B4 takes 10 ms = 22 ms.
         Stop after B4. Cursor = 5. Set another timer for 20 ms.
```

**Do not restart the timer whenever text arrives.** Otherwise, a continuous stream
could keep postponing highlighting. Keep at most one waiting timer.

```mermaid
flowchart TD
    A["New code arrives"] --> B["Update source blocks"]
    B --> C["Move cursor back if a highlighted block changed"]
    C --> D{"Round running or timer waiting?"}
    D -->|Yes| E["Keep work for the scheduled round"]
    D -->|No| F["Schedule first round if work remains"]
```

Normal browser events arrive between synchronous rounds, not in the middle of
highlighting a block. If an update callback sends new source during a round,
queue that update until a safe point instead of changing the active block list.

## The unfinished block needs special care

A cursor can move backward if a highlighted unfinished block grows:

```text
Before:
  B0 highlighted | B1 highlighted | B2 highlighted, unfinished
  Cursor = 3: we are caught up.

After more text:
  B0 unchanged   | B1 unchanged   | B2 changed | B3 new
  Cursor = 2: B2 needs highlighting again.
```

Rehighlight B2 using **B1's saved grammar state**, not B2's old outgoing state.
B2's old outgoing state describes its end, but we are starting again at its
beginning. After B2, continue with B3.

Keep the block's ID as it grows and becomes complete, so React recognizes it as
the same block. Reuse unchanged completed blocks and their results.

## What the user sees

Show highlighted results after each round. Show pending blocks as plain text,
so code appears immediately even if highlighting is behind. Render that text
safely through React text content or HTML escaping.

If a block changes, show its current text while its new highlighting is pending;
do not keep displaying an old version of the text. Update the view once per round
instead of once per processed block.

When streaming ends, finish pending rounds, including the unfinished final block.
When caught up, stop scheduling timers until source changes.

The current synchronous `update()` returns fully processed results. This design
will need a callback or subscription to deliver results as rounds finish.
Receiving source and finishing its highlighting become separate events.

## Cleanup: reset versus dispose

**Reset means “clear this stream and start again.”** For example, the user clicks
Clear. Cancel the timer, clear source and saved results, and move the cursor to
zero. The scheduler can be used again.

**Dispose means “stop this scheduler permanently because we no longer need it.”**
For example, the user leaves the page and React removes the code component.
Cleanup should:

- Cancel the waiting timer with `clearTimeout`.
- Prevent future rounds and view updates from this scheduler.
- Remove registered update callbacks and release saved source and results.
- Release the Shiki tokenizer if this component created it for its own use.
  Leave a shared tokenizer alive if other components still use it.

Calling dispose twice should be harmless. Create a new scheduler if needed later.
For React, stop an effect's scheduler in that effect's cleanup function. This also
needs to work when development Strict Mode runs setup and cleanup more than once.

Keep a session number too. Increase it on reset or replacement. Each scheduled
callback remembers its session number. If it no longer matches, the callback
belongs to old work and must return without updating anything.

| Situation | Action |
| --- | --- |
| More text appended | Keep completed results; queue changed or new blocks. |
| Identical source received | Leave existing work and timer alone. |
| Earlier text edited or deleted | Cancel old work and rebuild from block zero with the same timed rounds. |
| Language, theme, tokenizer, or block size changes | Replace the scheduler and start fresh. |
| Clear clicked | Reset. |
| Component removed | Dispose. |
| A block fails to highlight | Keep successful earlier blocks, report the error, and stop automatic retries. Leave the cursor at the failed block. |

Use `try/finally` to clear the “round is running” flag even on errors. Check the
session number again after notifying the view: its callback might reset or dispose
the scheduler. A callback error must not leave the scheduler stuck as running.

If Shiki finishes initializing after the component has already been removed,
do not start processing or update the view. Release that tokenizer if the removed
component owned it.

## Things to watch

- **T is a target, not a hard limit.** We check after a whole block, so one slow
  block can exceed T. Browser timers can also fire later than requested.
- **Pausing helps responsiveness.** Reusing completed results saves repeated work.
  Equal work and pause times do not guarantee a particular CPU percentage.
- **Keep the latest source, not a job for every arrival.** If an unfinished block
  changes several times during a pause, highlight its latest version.
- **Avoid scanning all old text on every append.** Split the old unfinished text
  plus new text. Keep complete source blocks, including those still pending.
- **Rendering costs time too.** HTML generation happens during the round; browser
  layout and painting happen later and need separate measurement.
- **Pending work can grow.** If input is faster than processing, keep showing
  pending text and process blocks in order without dropping source.

When implementing, check timer reuse, cursor movement, multiline comments across
blocks, cleanup, failures, and the final unfinished block. Measure representative
code and long lines before choosing T.

Reference: [Ace's background tokenizer](https://github.com/ajaxorg/ace/blob/master/src/background_tokenizer.js).
