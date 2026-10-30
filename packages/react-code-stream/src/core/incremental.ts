import type { GrammarState } from 'shiki'
import type { GrammarStateCodeTokenizer } from './tokenizer'

/** Highlighted source for one block, together with its continuation state. */
export interface CachedBlock {
    /** Stable identifier while the block grows and becomes complete; IDs restart after reset. */
    id: number;
    /** Source belonging only to this block, including its original newline characters. */
    source: string;
    /** Shiki-generated HTML for this block, including its own pre and code elements. */
    html: string;
    /** State for highlighting the next block, or undefined when no grammar state is available. */
    outgoingGrammarState: GrammarState | undefined;
}

/** Cache snapshot returned after processing the complete source received so far. */
export interface CacheState {
    /** Completed blocks in source order. Their objects are reused during append-only updates. */
    completedBlocks: readonly CachedBlock[];
    /** Editable remainder that has not filled a complete block, or null when no remainder exists. */
    trailingBlock: CachedBlock | null;
    /** Entire source supplied to the latest successful update, used to detect appends and edits. */
    previousSource: string;
}


/** Fixed configuration for an independent code-stream cache. */
export interface IncrementalTokenizerOptions {
    /** Reusable tokenizer initialized by the caller. */
    tokenizer: GrammarStateCodeTokenizer;
    /** Fixed language for this cache instance. */
    language: string;
    /** Number of complete, newline-terminated lines per block. Defaults to 10. */
    linesPerBlock?: number;
}

/** Public operations for maintaining highlighted blocks as source changes. */
export interface IncrementalTokenizer {
    /**
     * Process all source received so far, rather than only the newly appended text.
     * Reuse completed blocks on appends and rebuild after edits or deletions.
     * Identical source returns the existing snapshot. Callers should treat snapshots as read-only.
     */
    update(source: string): CacheState;
    /** Clear all blocks, source tracking, grammar states, and the block ID counter. */
    reset(): void;
}

/** Source partitioned into complete blocks and an optional unfinished remainder. */
interface SplitBlocksResult {
    /** Consecutive slices, each containing linesPerBlock newline-terminated lines. */
    completeBlocks: string[];
    /** Remaining source, including incomplete lines; an empty string means no trailing block. */
    trailingSource: string;
}

/**
 * Create an independent cache for one code stream.
 * This factory is synchronous because its tokenizer is already initialized.
 * Create a new instance when the stream, language, theme, or tokenizer changes.
 * Block size is fixed for the lifetime of the instance as well.
 *
 * @param options - Initialized tokenizer, language, and optional block size.
 * @returns Synchronous update and reset methods backed by private cache state.
 * @throws RangeError if linesPerBlock is not a positive safe integer.
 */
export function createIncrementalTokenizer(
    options: IncrementalTokenizerOptions,
): IncrementalTokenizer {
    const { tokenizer, language, linesPerBlock = 10 } = options;
    if (!Number.isSafeInteger(linesPerBlock) || linesPerBlock <= 0) {
        throw new RangeError('linesPerBlock must be a positive safe integer');
    }
    let state: CacheState = {
        completedBlocks: [],
        trailingBlock: null,
        previousSource: '',
    };
    let nextBlockId = 0;

    /** Start over with an empty cache and restart block IDs from zero. */
    function reset(): void {
        state = {
            completedBlocks: [],
            trailingBlock: null,
            previousSource: '',
        };
        nextBlockId = 0;
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
     * Replace the cache after an edit or deletion by highlighting all source in order.
     * Start without grammar context and assign fresh IDs to the rebuilt blocks.
     * Publish the new snapshot only after every highlight succeeds.
     */
    function rebuild(source: string): CacheState {
        // Keep IDs unique across rebuilds so React does not reuse unrelated blocks.
        const { completeBlocks, trailingSource } = splitCompleteBlocks(source);
        const completedBlocks: CachedBlock[] = [];
        let incomingState: GrammarState | undefined;
        let id = nextBlockId;

        for (const blockSource of completeBlocks) {
            const block = highlightBlock(blockSource, incomingState, id++);
            completedBlocks.push(block);
            incomingState = block.outgoingGrammarState;
        }

        const trailingBlock = trailingSource.length > 0
            ? highlightBlock(trailingSource, incomingState, id++)
            : null;

        state = { completedBlocks, trailingBlock, previousSource: source };
        nextBlockId = id;
        return state;
    }

    /**
     * Reuse completed blocks, then process the previous trailing source plus appended text.
     * Highlight newly completed blocks and the remainder from the last completed state.
     * Rebuild on non-append changes and publish state only after highlighting succeeds.
     */
    function update(source: string): CacheState {
        if (source === state.previousSource) {
            return state;
        }
        if (!source.startsWith(state.previousSource)) {
            return rebuild(source);
        }

        const appendedText = source.slice(state.previousSource.length);
        const newTrailingSource = (state.trailingBlock?.source ?? '') + appendedText;
        const { completeBlocks, trailingSource } = splitCompleteBlocks(newTrailingSource);
        // Retain completed block objects and copy the array only when it grows.
        const completedBlocks = state.completedBlocks;
        const addedBlocks: CachedBlock[] = [];
        let incomingState = state.completedBlocks[state.completedBlocks.length - 1]
            ?.outgoingGrammarState;
        let id = nextBlockId;
        let reusableId = state.trailingBlock?.id;

        /** Reuse the old trailing block's ID once, then assign IDs to additional blocks. */
        function allocateId(): number {
            if (reusableId !== undefined) {
                const existingId = reusableId;
                reusableId = undefined;
                return existingId;
            }
            return id++;
        }

        // Highlight newly completed blocks in order, passing each outgoing state
        // into the next block without reprocessing previously cached blocks.
        for (const blockSource of completeBlocks) {
            const block = highlightBlock(blockSource, incomingState, allocateId());
            addedBlocks.push(block);
            incomingState = block.outgoingGrammarState;
        }

        // Highlight the editable remainder from the last completed block's state.
        // If no source remains, there is no trailing block to store.
        const trailingBlock = trailingSource.length > 0
            ? highlightBlock(trailingSource, incomingState, allocateId())
            : null;

        state = {
            completedBlocks: addedBlocks.length > 0
                ? [...completedBlocks, ...addedBlocks]
                : completedBlocks,
            trailingBlock,
            previousSource: source,
        };
        nextBlockId = id;
        return state;
    }

    return { update, reset };
}
