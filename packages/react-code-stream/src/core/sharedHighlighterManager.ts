import {
  createHighlighter,
  createJavaScriptRegexEngine,
  type BundledLanguage,
  type BundledTheme,
  type Highlighter,
} from "shiki";

import {
    // createGrammarStateCodeTokenizer,
    createGrammarStateTokenizerFromHighlighter,
    type GrammarStateCodeTokenizer,
} from "./tokenizer";


type SharedTokenizer = Pick<GrammarStateCodeTokenizer, "highlight">

// Module lifetime ownership: component unmounts must not dispose this highlighter.
// Cache the pending initialization too, so simultaneous mounts create it only once.
let highlighterPromise: Promise<Highlighter> | undefined;

// These maps track only in-flight loads; Shiki retains successfully loaded resources.
// Keys are the bundled language/theme identifiers supplied by callers.
const pendingLanguages = new Map<string, Promise<void>>();
const pendingThemes = new Map<string, Promise<void>>();

/** Create one highlighter, shared by every time-budget session */
function getHighlighter() : Promise<Highlighter> {
    if(highlighterPromise) return highlighterPromise;

    const pending = createHighlighter({
        langs: [],
        themes: [],
        engine: createJavaScriptRegexEngine({
            forgiving: true,
        }),
    });

    highlighterPromise = pending;

    // A failed initialization should not permanently poison the cache
    void pending.catch(() => {
        if(highlighterPromise === pending) {
            highlighterPromise = undefined;
        }
    })

    return pending;
}

/** Deduplicate an asynchronous resource load and allow retries. */
function loadOnce(
    pendingLoads: Map<string, Promise<void>>,
    key: string,
    load: () => Promise<void>,
): Promise<void> {
    const existing = pendingLoads.get(key);
    if (existing) return existing;

    // Schedule loading after the promise has been stored in the map.
    const pending = Promise.resolve().then(load);
    pendingLoads.set(key, pending);

    // Only remove our own entry, preserving any replacement operation for this key.
    const cleanup = () => {
        if(pendingLoads.get(key) === pending){
            pendingLoads.delete(key);
        }
    }

    // Clean up on success and failure without creating an unhandled rejection.
    void pending.then(cleanup, cleanup);

    return pending;
}

/** Skip loaded grammars; concurrent requests for a missing grammar share its load. */
function ensureLanguage(
    highlighter: Highlighter,
    language: BundledLanguage,
): Promise<void> {
    if(highlighter.getLoadedLanguages().includes(language)){
        return Promise.resolve();
    }

    return loadOnce(pendingLanguages, language, async () => {
        await highlighter.loadLanguage(language);
    })
}

/** Load a bundled theme once without replacing themes used by other sessions. */
function ensureTheme(
    highlighter : Highlighter,
    theme: string,
): Promise<void> {
    if(highlighter.getLoadedThemes().includes(theme)){
        return Promise.resolve();
    }

    return loadOnce(pendingThemes, theme, async () => {
        // The public API accepts strings; this cast does not validate theme names.
        // Shiki rejects unknown bundled themes, and loadOnce permits a later retry.
        await highlighter.loadTheme(theme as BundledTheme);
    })
}

/**
 * Ensure resources are ready before returning a synchronous highlighting wrapper.
 * Undefined language means plain text and requires no grammar load. Each wrapper
 * captures its own theme; stream grammar states remain owned by each scheduler.
 * Resource failures reject this request without discarding the shared highlighter.
 */
export async function getSharedTimeBudgetTokenizer(
    language: BundledLanguage | undefined,
    theme: string,
): Promise<SharedTokenizer> {
    const highlighter = await getHighlighter();

    await Promise.all([
        language
            ? ensureLanguage(highlighter, language)
            : Promise.resolve(),
        ensureTheme(highlighter, theme),
    ]);

    // Wrappers are cheap and intentionally omit disposal of the shared resource.
    return createGrammarStateTokenizerFromHighlighter(
        highlighter,
        theme,
    )
}


/** prewarmnig react code stream */
export interface PrewarmCodeStreamOptions {
    languages?: readonly BundledLanguage[];
    themes?: readonly BundledTheme[];
}

/**
 * Initialize the shared time-budget highlighter and load selected resources.
 * Resolves when all requested resources are ready; rejects on loading failure.
 */
export async function prewarmCodeStream(
    options: PrewarmCodeStreamOptions = {},
): Promise<void> {
    const highlighter = await getHighlighter();

    await Promise.all([
        ...(options.languages ?? []).map((language) => 
            ensureLanguage(highlighter, language),
        ),
        ...(options.themes ?? []).map((theme) =>
            ensureTheme(highlighter, theme),
        ),
    ]);
}