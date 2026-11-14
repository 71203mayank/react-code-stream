import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createIncrementalTokenizer, type HighlightSnapshot } from '../src/core/timeBudgetIncremental';
import type { GrammarStateCodeTokenizer } from '../src/core/tokenizer';

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
});

function setup(onUpdate = vi.fn<(snapshot: HighlightSnapshot) => void>()) {
    const highlight = vi.fn<GrammarStateCodeTokenizer['highlight']>(source => ({ html: source, currentGrammarState: undefined }));
    const engine = createIncrementalTokenizer({
        tokenizer: { highlight }, language: 'text', linesPerBlock: 1, onUpdate,
    });
    return { engine, highlight, onUpdate };
}

describe('time-budgeted source updates', () => {
    it('rehighlights a growing tail while preserving completed results and tail ID', () => {
        const { engine, highlight, onUpdate } = setup();
        engine.update('a\nb');
        vi.runAllTimers();
        const first = onUpdate.mock.calls.at(-1)![0];
        engine.update('a\nbc\nd');
        vi.runAllTimers();
        const next = onUpdate.mock.calls.at(-1)![0];
        expect(next.blocks[0]).toBe(first.blocks[0]);
        expect(next.blocks[1].id).toBe(first.blocks[1].id);
        expect(next.blocks.map(block => block.source).join('')).toBe('a\nbc\nd');
        expect(highlight.mock.calls.map(call => call[0])).toEqual(['a\n', 'b', 'bc\n', 'd']);
        expect(first.blocks[1].source).toBe('b');
    });

    it('keeps the continuation timer when more source arrives during a pause', () => {
        let now = 0;
        vi.spyOn(performance, 'now').mockImplementation(() => now);
        const { engine, highlight, onUpdate } = setup();
        highlight.mockImplementation(source => {
            now += 9;
            return { html: source, currentGrammarState: undefined };
        });
        engine.update('a\nb');
        vi.advanceTimersByTime(0);
        expect(highlight).toHaveBeenCalledTimes(1);
        vi.advanceTimersByTime(4);
        engine.update('a\nbc');
        engine.update('a\nbc');
        expect(vi.getTimerCount()).toBe(1);
        vi.advanceTimersByTime(4);
        expect(highlight.mock.calls.map(call => call[0])).toEqual(['a\n', 'bc']);
        expect(onUpdate.mock.calls.at(-1)![0].blocks).toHaveLength(2);
        expect(vi.getTimerCount()).toBe(0);
    });

    it('cancels old pending work, clears the view, and rebuilds with fresh IDs', () => {
        const { engine, highlight, onUpdate } = setup();
        engine.update('old');
        vi.runAllTimers();
        const oldId = onUpdate.mock.calls.at(-1)![0].blocks[0].id;
        engine.update('old pending');
        engine.update('new\ntail');
        expect(onUpdate.mock.calls.at(-1)![0].blocks).toEqual([]);
        expect(vi.getTimerCount()).toBe(1);
        vi.runAllTimers();
        const blocks = onUpdate.mock.calls.at(-1)![0].blocks;
        expect(blocks.map(block => block.source)).toEqual(['new\n', 'tail']);
        expect(blocks[0].id).toBeGreaterThan(oldId);
        expect(highlight.mock.calls.map(call => call[0])).not.toContain('old pending');
        expect(highlight.mock.calls[1][2]).toBeUndefined();
    });

    it('does not schedule replacement work after its empty-view callback disposes it', () => {
        const { engine, highlight, onUpdate } = setup();
        engine.update('old');
        vi.runAllTimers();
        onUpdate.mockImplementation(snapshot => {
            if (snapshot.blocks.length === 0) engine.dispose();
        });
        engine.update('replacement');
        expect(vi.getTimerCount()).toBe(0);
        expect(highlight).toHaveBeenCalledTimes(1);
    });

    it('handles deletion to empty without scheduling an empty round', () => {
        const { engine, onUpdate } = setup();
        engine.update('old');
        vi.runAllTimers();
        engine.update('');
        expect(onUpdate.mock.calls.at(-1)![0].blocks).toEqual([]);
        expect(vi.getTimerCount()).toBe(0);
        engine.update('next');
        vi.runAllTimers();
        expect(onUpdate.mock.calls.at(-1)![0].blocks[0].source).toBe('next');
    });
});
