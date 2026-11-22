import type { BundledLanguage } from "shiki";

import {
    createGrammarStateCodeTokenizer,
    type GrammarStateCodeTokenizer,
} from "./tokenizer";


type SharedTokenizer = Pick<GrammarStateCodeTokenizer, "highlight">

const tokenizers = new Map<string, Promise<SharedTokenizer>>();

export function getSharedTimeBudgetTokenizer(
    language: BundledLanguage | undefined,
    theme: string,
): Promise<SharedTokenizer> {
    const key = JSON.stringify([language ?? null, theme]);

    const existing = tokenizers.get(key);
    if(existing) return existing;


    const pending = createGrammarStateCodeTokenizer({
        languages: language ? [language] : [],
        theme,
    }).then((tokenizers) => ({
        highlight: tokenizers.highlight,
    }));

    tokenizers.set(key, pending);

    // Allow a later mount to retry after initialization fails
    void pending.catch(() => {
        if(tokenizers.get(key) === pending){
            tokenizers.delete(key);
        }
    });

    return pending;
}