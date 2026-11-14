import type { CachedBlock } from './incremental';
import type { GrammarStateCodeTokenizer } from './tokenizer';
import type { GrammarState } from 'shiki'

/** Received source, independent of highlighting progress. */
export interface SourceBlock {
    /** Stable as the unfinished block grows and becomes complete. */
    id: number;
    /** Exact text for this block, preserving original newlines. */
    source: string;
    /** True after linesPerBlock newline-terminated lines have accumulated. */
    complete: boolean;
}

/** Published highlighted prefix; excludes source still waiting for highlighting. */
export interface HighlightSnapshot {
    /** Source order. Never mutate an array already published to a consumer. */
    blocks: readonly CachedBlock[];
}

/** Fixed configuration for one scheduler instance. */
export interface TimeBudgetIncrementalOptions {
    /** Borrowed tokenizer: the caller owns its disposal. */
    tokenizer: GrammarStateCodeTokenizer;
    /** Fixed language; replace the scheduler when language/tokenizer changes. */
    language: string;
    /** Positive safe integer; defaults to 10. */
    linesPerBlock?: number;
    /** Finite positive processing target per round; defaults to 8 ms. */
    sliceBudgetMs?: number;
    /** Finite nonnegative continuation delay; defaults to 8 ms. */
    continuationDelayMs?: number;
    /** Receives round results and an empty view on reset/replacement. */
    onUpdate(snapshot: HighlightSnapshot): void;
    /** Reports failures; automatic processing stops until reset or replacement. */
    onError?(error: Error): void;
}

export interface TimeBudgetIncrementalTokenizer {
    /** Receive the entire accumulated source; highlighting finishes asynchronously. */
    update(fullSource: string): void;
    /** Clear this stream while keeping the scheduler reusable. */
    reset(): void;
    /** Stop permanently; repeated calls are harmless. */
    dispose(): void;
}

/** Source partitioned into complete blocks and an optional unfinished remainder. */
interface SplitBlocksResult {
    /** Consecutive slices, each containing linesPerBlock newline-terminated lines. */
    completeBlocks: string[];
    /** Remaining source, including incomplete lines; an empty string means no trailing block. */
    trailingSource: string;
}

/**
 * Maintain source blocks and highlight pending work in time-budgeted rounds.
 * Configuration is fixed for the lifetime of this scheduler.
 */
export function createIncrementalTokenizer(
    options: TimeBudgetIncrementalOptions,
): TimeBudgetIncrementalTokenizer {
    const {
        tokenizer, language, linesPerBlock = 10,
        sliceBudgetMs = 8, continuationDelayMs = 8,
    } = options;

    if (!Number.isSafeInteger(linesPerBlock) || linesPerBlock <= 0) {
        throw new RangeError('linesPerBlock must be a positive safe integer');
    }
    if (!Number.isFinite(sliceBudgetMs) || sliceBudgetMs <= 0) {
        throw new RangeError('sliceBudgetMs must be finite and positive');
    }
    if (!Number.isFinite(continuationDelayMs) || continuationDelayMs < 0) {
        throw new RangeError('continuationDelayMs must be finite and nonnegative');
    }

    /** Entire latest accepted source, including text not highlighted yet. */
    let latestSource = '';

    /** All received blocks, including complete source blocks still awaiting work. */
    let sourceBlocks: SourceBlock[] = [];

    /** Valid highlighted prefix of sourceBlocks; truncate when a highlighted tail changes. */
    let results: CachedBlock[] = [];

    /** This is the cursor */
    /** First block needing highlighting; sourceBlocks.length means caught up. */
    let nextBlockIndex = 0;

    /** Sole waiting timer. New arrivals must not restart an existing timer. */
    let timer: ReturnType<typeof setTimeout> | null = null;

    /** True throughout processing and notification; prevents reentrant rounds. */
    let running = false;

    /** Permanent shutdown flag; update/reset must never revive a disposed instance. */
    let disposed = false;

    /** Stops automatic retries after failure; reset/replacement clears it. */
    let failed = false;

    /** Increment on reset/replacement/disposal to invalidate old callbacks. */
    let session = 0;

    /** Next fresh ID; preserve old tail IDs and keep IDs unique across replacements. */
    let nextBlockId = 0;

    /**
     * Latest full input received reentrantly while running, applied at a safe point.
     * null means no queued input; empty string is valid input. Clear on session changes.
     * 
     * Mainly protects against a callback calling update() while runRound() is still executing.
     * Clear immediately after acceptance 
     */
    let queuedSource: string | null = null;

    /** Mutable callback references so dispose() can release consumer closures. */
    let onUpdate: TimeBudgetIncrementalOptions['onUpdate'] | undefined = options.onUpdate;
    let onError: TimeBudgetIncrementalOptions['onError'] = options.onError;


    /**
     * Split at every linesPerBlock LF boundaries, retaining original LF or CRLF sequences.
     * An unfinished final line remains in trailingSource, and empty blocks are never emitted.
     */
    function splitCompleteBlocks(source: string): SplitBlocksResult {
        const completeBlocks: string[] = [];
        let blockStart = 0;
        let lineCount = 0;

        // Slice the original source to preserve both LF and CRLF sequences.
        for (let index = 0; index < source.length; index++) {
            if (source[index] !== '\n') continue;
            lineCount++;
            if (lineCount === linesPerBlock) {
                completeBlocks.push(source.slice(blockStart, index + 1));
                blockStart = index + 1;
                lineCount = 0;
            }
        }

        return { completeBlocks, trailingSource: source.slice(blockStart) };
    }

    /**
     * Highlight one block from its predecessor's state and package the result for caching.
     * The caller supplies the ID so an existing trailing block can retain its identity.
     */
    function highlightBlock(
        source: string,
        incomingState: GrammarState | undefined,
        id: number,
    ): CachedBlock {
        const result = tokenizer.highlight(source, language, incomingState);
        return {
            id,
            source,
            html: result.html,
            outgoingGrammarState: result.currentGrammarState,
        };
    }

    /**
     * Receive ENTIRE accumulated source, never only the new chunk.
     * 1. Ignore calls after disposal.
     * 2. While running, save only the latest input in queuedSource.
     * 3. Otherwise call handleSourceUpdate().
     */
    function update(fullSource: string): void {
        if (disposed) return;

        // Consumer callbacks can supply input while a round is notifying the view.
        // Keep only their latest full source until the active round reaches a safe point.
        if (running) {
            queuedSource = fullSource;
            return;
        }

        handleSourceUpdate(fullSource);
    }

    /**
     * Compare input with latestSource when source blocks can safely change.
     * 1. Ignore identical input without disturbing pending work or its timer.
     * 2. If fullSource starts with latestSource, call extendSourceBlocks().
     * 3. Otherwise call rebuildSourceBlocks() for edits/deletions.
     * 4. If idle with work remaining and no failure, schedule the first round at 0 ms.
     * When consuming queued input after a budget pause, preserve the continuation delay.
     */
    function handleSourceUpdate(fullSource: string): void {
        if (disposed || fullSource === latestSource) return;

        if (!fullSource.startsWith(latestSource)) {
            // Replacement advances the session exactly once. Its empty-view callback
            // may reset, dispose, or replace again; never resume that invalidated request.
            const replacementSession = session + 1;
            rebuildSourceBlocks(fullSource);
            if (disposed || session !== replacementSession) return;
        } else {
            extendSourceBlocks(fullSource);
        }

        // The cursor, not whether the tail is complete, determines pending work.
        // scheduleRound also preserves an existing timer and rejects failed/running work.
        scheduleRound(0);
    }

    /**
     * Extend blocks from the entire updated source, without highlighting.
     * 1. Extract appended text with fullSource.slice(latestSource.length).
     * 2. Split only the unfinished SOURCE block plus appended text at LF boundaries,
     *    preserving original LF/CRLF characters and excluding empty blocks.
     * 3. Keep all complete source blocks, even those not highlighted yet.
     * 4. Reuse the old tail ID for its first replacement; allocate additional IDs.
     * 5. Move the cursor back to the changed block if necessary and truncate results.
     * 6. Save latestSource; let the consumer retain its last view until the next publication.
     */
    function extendSourceBlocks(fullSource: string): void {
        const appendedText = fullSource.slice(latestSource.length);

        const lastBlock = sourceBlocks[sourceBlocks.length - 1];
        const unfinishedBlock = lastBlock && !lastBlock.complete ? lastBlock : undefined;

        // Only the final source block can be unfinished. It may already be highlighted,
        // or still pending: source completion and highlighting progress are independent.
        // If there is no unfinished tail, new work begins after all existing blocks.
        const changedIndex = unfinishedBlock ? sourceBlocks.length - 1 : sourceBlocks.length;

        const textToSplit = (unfinishedBlock?.source ?? "") + appendedText;

        // Preserve existing complete source blocks; split only the growing tail and new text.
        const {completeBlocks, trailingSource} = splitCompleteBlocks(textToSplit);


        // Replace the old tail, preserving its identity for the first replacement block.
        if(unfinishedBlock){
            sourceBlocks.pop();
        }

        let reusableId = unfinishedBlock?.id;

        function allocateId() : number {
            if(reusableId !== undefined){
                const id = reusableId;
                reusableId = undefined;
                return id;
            }

            return nextBlockId++;
        }

        for(const source of completeBlocks){
            sourceBlocks.push({
                id: allocateId(),
                source,
                complete: true,
            })
        }

        if(trailingSource.length > 0){
            sourceBlocks.push({
                id: allocateId(),
                source: trailingSource,
                complete: false,
            })
        }

        // Rewind for a changed highlighted tail, but never skip earlier pending blocks.
        // Previously published arrays remain intact because publish() copied the array.
        nextBlockIndex = Math.min(nextBlockIndex, changedIndex);
        results.length = nextBlockIndex;

        // Track accepted input immediately, independently of highlighting progress.
        latestSource = fullSource;

    }

    /**
     * Prepare a fresh source list after an edit/deletion; do not highlight here.
     * 1. Cancel the timer, increment session, clear queued input and failure state.
     * 2. Clear results/cursor and split the entire input into source blocks.
     * 3. Allocate fresh IDs without rewinding nextBlockId and save latestSource.
     * 4. Publish an empty view so unrelated old results disappear immediately.
     * Recheck session/disposed after notification before the caller schedules work.
     */
    function rebuildSourceBlocks(fullSource: string): void {
        if (disposed) return;

        // Neither pending timers nor outgoing grammar states from the old source apply.
        cancelTimer();
        const replacementSession = ++session;
        queuedSource = null;
        failed = false;
        sourceBlocks = [];
        results = [];
        nextBlockIndex = 0;

        // Keep allocating fresh IDs so React cannot confuse new blocks with old ones.
        // Unlike reset(), replacement does not restart the ID counter.
        const { completeBlocks, trailingSource } = splitCompleteBlocks(fullSource);
        for (const source of completeBlocks) {
            sourceBlocks.push({ id: nextBlockId++, source, complete: true });
        }
        if (trailingSource.length > 0) {
            sourceBlocks.push({ id: nextBlockId++, source: trailingSource, complete: false });
        }
        latestSource = fullSource;

        // Commit all source state BEFORE notifying the consumer: callbacks may reenter.
        // Clearing the view happens immediately; highlighting still uses timed rounds.
        try {
            publish();
        } catch (reason) {
            // An old notification must not mark a newer session as failed.
            if (disposed || session !== replacementSession) return;
            failed = true;
            cancelTimer();
            onError?.(reason instanceof Error ? reason : new Error(String(reason)));
        }
        // No work after notification: handleSourceUpdate checks the session and schedules.
    }

    /**
     * Maintain at most one waiting timer.
     * 1. Return if disposed, failed, running, already scheduled, or caught up.
     * 2. Capture session and request setTimeout with the supplied delay.
     * 3. Check captured session/disposed BEFORE changing shared state in the callback.
     * 4. Clear the handle and call runRound(capturedSession).
     */
    function scheduleRound(delay: number): void {
        if(
            disposed ||
            failed ||
            running ||
            timer !== null ||
            nextBlockIndex >= sourceBlocks.length
        ) {
            return;
        }


        // Appends keep this session and timer; replacements invalidate both.
        const scheduledSession = session;

        timer = setTimeout(() => {
            // Check before clearing the handle: a stale callback must not erase a new timer.
            if (disposed || scheduledSession !== session) return;

            timer = null;

            runRound(scheduledSession);
        }, delay);
    }

    /**
     * Process sequential whole blocks within one fresh time budget.
     * 1. Reject stale work; set running and record performance.now().
     * 2. Highlight the cursor block, including HTML generation, using the preceding
     *    RESULT's outgoing grammar state (undefined for block zero).
     * 3. Store the result and advance the cursor only after success.
     * 4. After each whole block, check elapsed time; stop at budget if work remains.
     * 5. Publish once per round, including successful results before a highlight failure.
     * 6. On failure, keep the cursor at the failed block and stop automatic retries.
     *    Handle notification failures separately and normalize errors for onError.
     * 7. Recheck session/disposed after each notification, which may reset/dispose.
     * 8. Always clear running in finally, even if a callback throws.
     * 9. If still current, consume queued input at a safe point.
     * 10. If work remains and retries are allowed, ensure one continuation timer;
     *     use continuationDelayMs after budget exhaustion, even with queued input.
     * No further input is needed to finish pending work, including the final tail.
     */
    function runRound(capturedSession: number): void {
        if (disposed || failed || running || capturedSession !== session) {
            return;
        }

        running = true;
        let changed = false;
        let budgetExhausted = false;
        // Use a separate flag because JavaScript can throw null or undefined too.
        let hasError = false;
        let roundError: unknown;

        try {
            const startedAt = performance.now();

            while (nextBlockIndex < sourceBlocks.length) {
                const index = nextBlockIndex;
                const block = sourceBlocks[index];

                try {
                    // Restart a changed tail from its predecessor's state, never its own.
                    const incomingState = index === 0
                        ? undefined
                        : results[index - 1].outgoingGrammarState;
                    const result = highlightBlock(block.source, incomingState, block.id);

                    // Custom tokenizer code may have reset/disposed the scheduler.
                    if (disposed || capturedSession !== session) return;

                    // Commit only successful blocks; on failure the cursor stays here.
                    results[index] = result;
                    nextBlockIndex++;
                    changed = true;
                } catch (error) {
                    if (disposed || capturedSession !== session) return;
                    failed = true;
                    hasError = true;
                    roundError = error;
                    break;
                }

                // A whole highlight call, including HTML generation, counts toward T.
                // Catching up requires no continuation, even if the final block was slow.
                if (
                    nextBlockIndex < sourceBlocks.length &&
                    performance.now() - startedAt >= sliceBudgetMs
                ) {
                    budgetExhausted = true;
                    break;
                }
            }

            if (changed) {
                try {
                    // Publish successful earlier blocks even if a later block failed.
                    publish();
                } catch (error) {
                    if (disposed || capturedSession !== session) return;
                    failed = true;
                    // Preserve the original highlight error if both operations failed.
                    if (!hasError) {
                        hasError = true;
                        roundError = error;
                    }
                }
            }

            // Consumer callbacks may have invalidated this round synchronously.
            if (disposed || capturedSession !== session) return;

            if (hasError) {
                const error = roundError instanceof Error
                    ? roundError
                    : new Error(String(roundError));
                // If onError throws, finally still clears running; no retry is scheduled.
                onError?.(error);
                if (disposed || capturedSession !== session) return;
            }

            if (queuedSource !== null) {
                // Clear BEFORE acceptance: any new reentrant update gets its own slot.
                // Use the normal input path because queued input can be an edit or clear.
                const fullSource = queuedSource;
                queuedSource = null;

                // Keep running true during acceptance so handleSourceUpdate's request
                // for a 0-ms timer cannot override this round's continuation delay.
                handleSourceUpdate(fullSource);
            }
        } finally {
            // Always release the guard, including callback failures and early returns.
            running = false;
        }

        // Recompute pending work: accepting queued input may rewind the cursor or add blocks.
        // A queued replacement may also start a new session; schedule its current work.
        // Early returns above prevent an old round from scheduling after callback reset.
        if (!disposed && !failed && nextBlockIndex < sourceBlocks.length) {
            scheduleRound(budgetExhausted ? continuationDelayMs : 0);
        }
    }

    /**
     * Publish an immutable snapshot of the valid highlighted prefix.
     * 1. Copy the results array, retaining unchanged CachedBlock object identities.
     * 2. Call onUpdate only while active; the consumer retains the published view.
     * 3. Let the caller handle callback errors and check for session invalidation.
     * Reset/replacement also use this method to publish an empty view.
     */
    function publish(): void {
        if (disposed) return;

        // Copy the array of references, not the source text or HTML inside each block.
        onUpdate?.({ blocks: results.slice() });
    }

    /** Clear the waiting timer if present, then set its handle to null. */
    function cancelTimer(): void {
        if (timer === null) return;

        clearTimeout(timer);
        timer = null;
    }

    /**
     * Clear the stream while leaving this scheduler reusable.
     * 1. Ignore calls after disposal; cancel the timer and increment session.
     * 2. Clear source, blocks, results, cursor, queued input, failed, and ID counter.
     * 3. Publish an empty snapshot; retain configuration, tokenizer, and callbacks.
     * A reentrant reset must leave running for the active round's finally to clear.
     */
    function reset(): void {
        if (disposed) return;

        // Invalidate an executing round as well as canceling any waiting callback.
        session++;
        cancelTimer();

        latestSource = '';
        sourceBlocks = [];
        results = [];
        nextBlockIndex = 0;
        queuedSource = null;
        failed = false;
        nextBlockId = 0;

        // Keep callbacks and the borrowed tokenizer available for the next stream.
        // Do not change running: an active round releases it in its finally block.
        publish();
    }

    /**
     * Permanently shut down; repeated calls are harmless.
     * 1. Mark disposed, increment session, and cancel the timer.
     * 2. Release source, blocks, results, and queued input without publishing a view.
     * 3. Clear callback references without notifying the consumer.
     * 4. Leave the borrowed tokenizer alive; its creator owns its disposal.
     * An active round must observe session invalidation before publishing again.
     */
    function dispose(): void {
        if (disposed) return;

        // Mark shutdown first so future calls and stale rounds cannot resume work.
        disposed = true;
        session++;
        cancelTimer();

        latestSource = '';
        sourceBlocks = [];
        results = [];
        nextBlockIndex = 0;
        queuedSource = null;
        nextBlockId = 0;
        failed = false;

        // Unmount cleanup must not notify React or retain its callback closures.
        onUpdate = undefined;
        onError = undefined;
        // The creator of the supplied tokenizer remains responsible for disposing it.
    }

    return { update, reset, dispose };
}
