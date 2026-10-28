import {
  createHighlighter,
  type BundledLanguage,
  type Highlighter,
  type GrammarState,
  type SpecialLanguage,
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


// export interface GrammarStateCodeTokenizerOption {
//   /** Languages to preload when creating the tokenizer. */
//   languages?: readonly BundledLanguage[]
//   /** Shiki theme to use when producing HTML. */
//   theme?: string

//   /** Shiki grammar state */
//   grammerState?: GrammarState
// }

export interface GrammarStateCodeTokenizer{
  highlight(code: string, language?: string, lastGrammarState?: GrammarState): {
    html: string;
    currentGrammarState: GrammarState | undefined
  }
}

/** Create grammar state tokenizer, 3rd params the grammar of the prevous state will be passed
 *  which will help to hilight the current block
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
    highlight(code, language = FALLBACK_LANGUAGE, lastGrammarState) {
      const resolvedLanguage = loadedLanguages.has(language)
        ? language as BundledLanguage
        : FALLBACK_LANGUAGE
      
      const html = highlighter.codeToHtml(code, {
        lang: resolvedLanguage,
        theme,
        grammarState: lastGrammarState,
      })

      const tokens = highlighter.codeToTokens(code, {
        lang: resolvedLanguage,
        theme,
        grammarState: lastGrammarState,
      })
      const currentGrammarState = highlighter.getLastGrammarState(tokens.tokens)

      return {html, currentGrammarState}
    }
  }
}
