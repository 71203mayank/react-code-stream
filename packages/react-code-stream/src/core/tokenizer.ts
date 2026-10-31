import {
  createHighlighter,
  type BundledLanguage,
  type Highlighter,
  type GrammarState,
  type SpecialLanguage,
  hastToHtml,
} from 'shiki'

/** Languages enabled in the first tokenizer spike. */
export const DEFAULT_LANGUAGES = [
  'javascript',
  'typescript',
  'jsx',
  'tsx',
  'python',
  'json',
  'html',
  'css',
  'shellscript',
] as const satisfies readonly BundledLanguage[]

export const DEFAULT_THEME = 'github-dark'
export const FALLBACK_LANGUAGE: SpecialLanguage = 'text'

export interface TokenizerOptions {
  /** Languages to preload when creating the tokenizer. */
  languages?: readonly BundledLanguage[]
  /** Shiki theme to use when producing HTML. */
  theme?: string
}

export interface CodeTokenizer {
  /** Highlight source into Shiki-generated HTML. Unknown languages use plain text. */
  highlight(code: string, language?: string): string
}

/**
 * Create a tokenizer once and reuse it across code updates. Initialization is
 * asynchronous; highlighting is synchronous after the selected grammar/theme load.
 */
export async function createCodeTokenizer(
  options: TokenizerOptions = {},
): Promise<CodeTokenizer> {
  const languages = options.languages ?? DEFAULT_LANGUAGES
  const theme = options.theme ?? DEFAULT_THEME
  const highlighter: Highlighter = await createHighlighter({
    langs: [...languages],
    themes: [theme],
  })
  const loadedLanguages = new Set(highlighter.getLoadedLanguages())

  return {
    highlight(code, language = FALLBACK_LANGUAGE) {
      const resolvedLanguage = loadedLanguages.has(language)
        ? language
        : FALLBACK_LANGUAGE

      return highlighter.codeToHtml(code, {
        lang: resolvedLanguage,
        theme,
      })
    },
  }
}


/** Highlights consecutive code blocks while preserving grammar context between blocks. */
export interface GrammarStateCodeTokenizer{
  /** Release resources when this tokenizer is no longer needed. */
  dispose?(): void
  /**
   * Highlight a code block and return its outgoing grammar state.
   *
   * @param code - Source code for the current block, split at complete line boundaries.
   * @param language - Language to highlight. Unsupported languages use plain text.
   * @param lastGrammarState - State returned by the preceding block. Omit for the
   * first block, and reuse states only with the same tokenizer, language, and theme.
   */
  highlight(code: string, language?: string, lastGrammarState?: GrammarState): {
    /** HTML generated from the highlighted code block. */
    html: string;
    /** State to pass to the next block, or undefined when no grammar state is available. */
    currentGrammarState: GrammarState | undefined
  }
}

/**
 * Create a reusable tokenizer for highlighting consecutive code blocks.
 * Initialization loads the configured languages and theme asynchronously.
 * Subsequent highlight calls are synchronous and derive HTML and the outgoing
 * grammar state from a single tokenization pass.
 */
export async function createGrammarStateCodeTokenizer(
  options : TokenizerOptions = {}
): Promise<GrammarStateCodeTokenizer> {
  const languages = options.languages ?? DEFAULT_LANGUAGES
  const theme = options.theme ?? DEFAULT_THEME
  const highlighter: Highlighter = await createHighlighter({
    langs: [...languages],
    themes: [theme],
  })
  const loadedLanguages = new Set(highlighter.getLoadedLanguages())

  return {
    dispose() {
      highlighter.dispose()
    },
    highlight(code, language = FALLBACK_LANGUAGE, lastGrammarState) {
      const resolvedLanguage = loadedLanguages.has(language)
        ? language as BundledLanguage
        : FALLBACK_LANGUAGE
      
      const highlightedTree = highlighter.codeToHast(code, {
        lang: resolvedLanguage,
        theme,
        grammarState: lastGrammarState,
      })

      const html = hastToHtml(highlightedTree)
      const currentGrammarState = highlighter.getLastGrammarState(highlightedTree)

      return {html, currentGrammarState}
    }
  }
}
