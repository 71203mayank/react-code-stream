import {
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type UIEvent,
} from "react";
import { bundledLanguages, type BundledLanguage } from "shiki";
import {
  createIncrementalTokenizer,
  type CachedBlock,
  type HighlightSnapshot,
  type TimeBudgetIncrementalTokenizer,
} from "../core/timeBudgetIncremental";
import {
  createGrammarStateCodeTokenizer,
  DEFAULT_THEME,
  FALLBACK_LANGUAGE,
} from "../core/tokenizer";
import "./StreamCode.css";

/** Public configuration for a continuous, incrementally highlighted code view. */
export interface TimeBudgetStreamCodeProps {
  /** Processing target per round, checked between whole blocks. Defaults to 8 ms. */
  sliceBudgetMs?: number;
  /** Delay before continuing unfinished highlighting. Defaults to 8 ms. */
  continuationDelayMs?: number;
  /** Entire source received so far. Supply accumulated source on every update. */
  children: string;
  /** Shiki language or alias. Unknown languages use plain text. Defaults to text. */
  language?: string;
  /** Shiki theme. Changing it initializes a new tokenizer and cache. */
  theme?: string;
  /** Complete lines per block; a positive safe integer, defaulting to 10. */
  linesPerBlock?: number;
  /** Follow new content while within 32 pixels of the bottom. Defaults to false. */
  autoScroll?: boolean;
  /** Additional class for the outer scroll container. */
  className?: string;
  /** Container styles, including width, height, or maxHeight for internal scrolling. */
  style?: CSSProperties;
  /** Reports initialization or highlighting errors; the code view is cleared. */
  onError?: (error: Error) => void;
  /** Accessible name for the keyboard-focusable scroll container. */
  "aria-label"?: string;
}

/** Fixed settings resolved by TimeBudgetStreamCode for one mounted rendering session. */
type SessionProps = TimeBudgetStreamCodeProps & {
  language: string;
  theme: string;
  linesPerBlock: number;
  sliceBudgetMs: number;
  continuationDelayMs: number;
};

// Use layout effects in browsers without requiring a DOM during server rendering.
const useCommittedLayoutEffect =
  typeof window === "undefined" ? useEffect : useLayoutEffect;

/**
 * Extract highlighted contents from trusted Shiki HTML, preserving newline text.
 * @param html - Tokenizer output containing pre/code wrappers.
 * @returns Inner code markup suitable for the shared pre/code container.
 */
function extractCodeHtml(html: string): string {
  const match = /<code\b[^>]*>([\s\S]*)<\/code>/.exec(html);
  if (!match)
    throw new Error(
      "TimeBudgetStreamCode expected Shiki HTML containing a code element",
    );
  return match[1];
}

/**
 * Render a cached entry as inline markup within the shared code container.
 * @param props.block - Cache entry retained by identity once it becomes complete.
 * Memoization skips completed blocks; extraction runs only when their HTML changes.
 */
const HighlightedBlock = memo(function HighlightedBlock({
  block,
}: {
  block: CachedBlock;
}) {
  const markup = useMemo(
    () => ({ __html: extractCodeHtml(block.html) }),
    [block.html],
  );
  return (
    <span
      className="react-code-stream__block"
      data-block-id={block.id}
      dangerouslySetInnerHTML={markup}
    />
  );
});

/**
 * Own the tokenizer, cache, animation frame, and scroll position for one configuration.
 * @param props - Source, presentation options, and fixed language/theme/block size.
 * The parent remounts this session when configuration changes, isolating old resources.
 */
const TimeBudgetStreamCodeSession = memo(function TimeBudgetStreamCodeSession({
  children,
  language,
  theme,
  linesPerBlock,
  sliceBudgetMs,
  continuationDelayMs,
  autoScroll = false,
  className,
  style,
  onError,
  "aria-label": ariaLabel = "Source code",
}: SessionProps) {
  const cacheRef = useRef<TimeBudgetIncrementalTokenizer | null>(null);
  const frameRef = useRef<number | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const sourceRef = useRef(children);
  const errorHandlerRef = useRef(onError);
  const followingRef = useRef(true);
  const failedRef = useRef(false);
  const [snapshot, setSnapshot] = useState<HighlightSnapshot | null>(null);

  /** @param reason - Any thrown value, normalized to Error for the latest error callback. */
  const reportError = useCallback((reason: unknown): void => {
    errorHandlerRef.current?.(
      reason instanceof Error ? reason : new Error(String(reason)),
    );
  }, []);

  /**
   * Submit at most one source update per animation frame using the latest committed source.
   * The scheduler owns highlighting rounds after submission. A failure clears the
   * highlighted snapshot and leaves the code view empty.
   */
  const scheduleUpdate = useCallback((): void => {
    if (!cacheRef.current || failedRef.current || frameRef.current !== null)
      return;
    frameRef.current = window.requestAnimationFrame(() => {
      frameRef.current = null;
      const cache = cacheRef.current;
      if (!cache) return;
      try {
        cache.update(sourceRef.current);
      } catch (reason) {
        failedRef.current = true;
        cache.reset();
        setSnapshot(null);
        reportError(reason);
      }
    });
  }, [reportError]);

  /** Keep refs current after commit without recreating the engine for incoming chunks. */
  useCommittedLayoutEffect(() => {
    sourceRef.current = children;
    errorHandlerRef.current = onError;
    scheduleUpdate();
  }, [children, onError, scheduleUpdate]);

  /**
   * Initialize one tokenizer and cache, then process the latest source received while loading.
   * Cleanup cancels frames, disposes the scheduler, and releases the highlighter. Late async results
   * are disposed without updating the component, including during Strict Mode effect replay.
   */
  useEffect(() => {
    let active = true;
    let dispose: (() => void) | undefined;
    failedRef.current = false;

    /** Load the selected grammar/theme and attach the cache only while this effect is active. */
    async function initialize(): Promise<void> {
      try {
        if (!Number.isSafeInteger(linesPerBlock) || linesPerBlock <= 0) {
          throw new RangeError("linesPerBlock must be a positive safe integer");
        }
        const tokenizer = await createGrammarStateCodeTokenizer({
          languages: Object.prototype.hasOwnProperty.call(
            bundledLanguages,
            language,
          )
            ? [language as BundledLanguage]
            : [],
          theme,
        });
        if (!active) {
          tokenizer.dispose?.();
          return;
        }
        dispose = () => tokenizer.dispose?.();
        const scheduler = createIncrementalTokenizer({
          tokenizer,
          language,
          linesPerBlock,
          sliceBudgetMs,
          continuationDelayMs,
          onUpdate: (nextSnapshot) => {
            if (active) setSnapshot(nextSnapshot);
          },
          onError: (error) => {
            if (!active) return;
            failedRef.current = true;
            setSnapshot(null);
            reportError(error);
          },
        });
        // Stop pending rounds before releasing the tokenizer they borrow.
        dispose = () => {
          scheduler.dispose();
          tokenizer.dispose?.();
        };
        cacheRef.current = scheduler;
        scheduleUpdate();
      } catch (reason) {
        if (active) {
          failedRef.current = true;
          reportError(reason);
        }
      }
    }

    void initialize();
    return () => {
      active = false;
      if (frameRef.current !== null)
        window.cancelAnimationFrame(frameRef.current);
      frameRef.current = null;
      dispose?.();
      cacheRef.current = null;
    };
  }, [
    language,
    theme,
    linesPerBlock,
    sliceBudgetMs,
    continuationDelayMs,
    scheduleUpdate,
    reportError,
  ]);

  /** @param event - Scroll event used to pause following when the reader moves upward. */
  const handleScroll = useCallback((event: UIEvent<HTMLDivElement>): void => {
    const element = event.currentTarget;
    followingRef.current =
      element.scrollHeight - element.clientHeight - element.scrollTop <= 32;
  }, []);

  // Scrolling follows published highlighting, which can lag the received source.
  const displayedSource = snapshot
    ? snapshot.blocks.map((block) => block.source).join("")
    : "";

  /** Follow committed content before paint only while the reader remains near the bottom. */
  useCommittedLayoutEffect(() => {
    const element = containerRef.current;
    if (autoScroll && followingRef.current && element)
      element.scrollTop = element.scrollHeight;
  }, [displayedSource, autoScroll]);

  // Reuse published block objects so unchanged highlighted blocks skip rendering.
  const completedBlocks = snapshot?.blocks;
  const completedElements = useMemo(
    () =>
      completedBlocks?.map((block) => (
        <HighlightedBlock key={block.id} block={block} />
      )),
    [completedBlocks],
  );

  const firstHtml = completedBlocks?.[0]?.html;
  const containerStyle = useMemo<CSSProperties>(() => {
    // Preserve Shiki's theme colors after removing its per-block pre wrappers.
    const themeStyle =
      firstHtml?.match(/<pre\b[^>]*\bstyle="([^"]*)"/)?.[1] ?? "";
    return {
      backgroundColor: themeStyle.match(/(?:^|;)background-color:([^;]+)/)?.[1],
      color: themeStyle.match(/(?:^|;)color:([^;]+)/)?.[1],
      ...style,
    };
  }, [firstHtml, style]);

  return (
    <div
      ref={containerRef}
      className={
        className ? `react-code-stream ${className}` : "react-code-stream"
      }
      style={containerStyle}
      onScroll={handleScroll}
      role="region"
      aria-label={ariaLabel}
      tabIndex={0}
    >
      <pre>
        <code>
          {snapshot ? (
            <>
              {completedElements}
            </>
          ) : null}
        </code>
      </pre>
    </div>
  );
});

/**
 * Render accumulated source using independent, time-budgeted highlighting rounds.
 * The target is checked between whole blocks; one block may exceed the target.
 * Published highlighting can lag incoming source until pending rounds finish.
 * @param props - Code as children, highlighting settings, and container options.
 * Use React's key prop to identify the stream; changing it remounts and resets the cache.
 * The code view stays empty until highlighting is available and after failures.
 */
export const TimeBudgetStreamCode = memo(function TimeBudgetStreamCode({
  language = FALLBACK_LANGUAGE,
  theme = DEFAULT_THEME,
  linesPerBlock = 10,
  sliceBudgetMs = 8,
  continuationDelayMs = 8,
  ...props
}: TimeBudgetStreamCodeProps) {
  const sessionKey = JSON.stringify([
    language,
    theme,
    linesPerBlock,
    sliceBudgetMs,
    continuationDelayMs,
  ]);
  return (
    <TimeBudgetStreamCodeSession
      key={sessionKey}
      {...props}
      language={language}
      theme={theme}
      linesPerBlock={linesPerBlock}
      sliceBudgetMs={sliceBudgetMs}
      continuationDelayMs={continuationDelayMs}
    />
  );
});

export default TimeBudgetStreamCode;
