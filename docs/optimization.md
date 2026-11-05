1. Start with time-budgeted batching, keeping ordinary small streaming updates on the existing fast path. It builds directly on your block boundaries and requires fewer changes to packaging and resource ownership.

2. Design the resumable tokenizer independently from React. That gives you a foundation you can later run inside a worker too.

3. Then evaluate a persistent worker if browser traces show that individual Shiki calls or initialization still cause unacceptable pauses. The approaches can be combined: a worker can process blocks incrementally and send batched results.


With batching:
```text
Source update
  → highlight blocks within a small time budget
  → publish progress
  → yield to the browser
  → continue pending blocks
```
The incremental tokenizer would need a resumable processing API. It would retain the pending source position, completed blocks, and grammar state between batches.

The incremental tokenizer would need a resumable processing API. It would retain the pending source position, completed blocks, and grammar state between batches.

For small updates, everything could finish in the first batch. Large loads would progressively highlight while the remaining source stays visible as plain text.

with worker
```text
Main thread                         Worker
React receives source
  → sends update                  → owns Shiki and incremental cache
                                  → highlights pending blocks
  ← receives changed-block HTML  ← sends results
React updates the DOM
```



| | Batching | Web Worker |
|---|---|---|
| Where highlighting runs | Main thread | Worker thread |
| How responsiveness improves | Yields between groups of blocks | Main thread can handle input while highlighting runs |
| Expensive individual block | Can still block the UI | Tokenization won’t block the main thread |
| Additional overhead | Scheduling and intermediate commits | Worker startup, messaging, and data transfer |
| Architecture change | Moderate | Larger |
| Total highlighting speed | Not necessarily faster | Not necessarily faster |
| DOM rendering | Main thread | Still main thread |



## Time Budgeting

```                   Incoming Source
                         │
                         ▼
                  Incremental Engine
                         │
                 Identify Dirty Blocks
                         │
                         ▼
                  Highlight Scheduler
                         │
                  ┌──────┴──────┐
                  │             │
                  ▼             ▼
              Small Work     Large Work
                  │             │
                  ▼             ▼
              Sync Path     Budgeted Path
                  │             │
                  │        Process Block
                  │             │
                  │        Save GrammarState
                  │             │
                  │        Check Time Budget
                  │             │
                  │        Yield / Resume
                  │             │
                  └──────┬──────┘
                         │
                         ▼
                   Existing Cache
                         │
                         ▼
                  Batched React Update
```

```text
                   <StreamCode />
                         │
                         ▼
                  React Adapter
                         │
                         ▼
                 Incremental Engine
                         │
                  Cache Reconciliation
                         │
                         ▼
                  Highlight Scheduler
                         │
              ┌──────────┴──────────┐
              │                     │
              ▼                     ▼
        Small Workload         Large Workload
              │                     │
              ▼                     ▼
       Synchronous Path       Budgeted Processing
              │                     │
              │              ┌──────┴──────┐
              │              │             │
              │              ▼             ▼
              │          Process        Yield
              │          Blocks         Resume
              │              │
              └──────────────┘
                         │
                         ▼
                 Highlighted Blocks
                         │
                         ▼
                  Cache Update
                         │
                         ▼
                  Batched Notify
                         │
                         ▼
                    React Render
```


Choose synchronous or budgeted processing based on the amount of outstanding work, not simply the size of the latest incoming chunk.

Once a stream enters budgeted processing, all subsequent chunks for that stream should be handled by the same processing job until it catches up with the latest source.

maintain the latest source and one processing cursor.
```text
Latest Source
     │
     ▼
[Already Highlighted][Pending Source]
                    ▲
                    │
                  Cursor
```

So overall architecture
```text
                  AI Streaming
                       │
                       ▼
                Latest Source
                       │
                       ▼
                Stream Controller
                       │
             ┌─────────┴─────────┐
             │                   │
             ▼                   ▼
        No Pending Work     Pending Work Exists
             │                   │
             ▼                   ▼
       Evaluate Workload    Extend Existing Job
             │                   │
       ┌─────┴─────┐             │
       │           │             │
       ▼           ▼             │
     Small        Large          │
       │           │             │
       ▼           ▼             │
   Sync Path   Budgeted Path ◄───┘
       │           │
       │       Process Block
       │           │
       │       Save GrammarState
       │           │
       │       Check Budget
       │           │
       │       Yield / Resume
       │           │
       └─────┬─────┘
             │
             ▼
        Block Cache
             │
             ▼
       Batched React Render
```
