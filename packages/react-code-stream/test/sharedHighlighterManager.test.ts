import type { GrammarState } from "shiki";
import { beforeEach, expect, it, vi } from "vitest";

const { initialize } = vi.hoisted(() => ({ initialize: vi.fn() }));

// Keep the real tokenizer wrapper so theme selection and grammar-state forwarding
// are exercised against the shared highlighter, rather than mocked away.
vi.mock("shiki", async (importOriginal) => ({
  ...await importOriginal<typeof import("shiki")>(),
  createHighlighter: initialize,
}));

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}

function fakeHighlighter() {
  const languages = new Set<string>();
  const themes = new Set<string>();
  return {
    getLoadedLanguages: () => [...languages],
    getLoadedThemes: () => [...themes],
    loadLanguage: vi.fn(async (language: string) => { languages.add(language); }),
    loadTheme: vi.fn(async (theme: string) => { themes.add(theme); }),
    codeToHast: vi.fn(() => ({ type: "root", children: [] })),
    getLastGrammarState: vi.fn<() => GrammarState | undefined>(() => undefined),
    dispose: vi.fn(),
  };
}

let highlighter: ReturnType<typeof fakeHighlighter>;

beforeEach(() => {
  // Isolate the singleton between tests without exposing a production reset API.
  vi.resetModules();
  vi.resetAllMocks();
  highlighter = fakeHighlighter();
  initialize.mockResolvedValue(highlighter);
});

it("shares pending initialization and missing resource loads across concurrent requests", async () => {
  const initialization = deferred<unknown>();
  const languageLoad = deferred<void>();
  const themeLoad = deferred<void>();
  initialize.mockReturnValueOnce(initialization.promise);
  highlighter.loadLanguage.mockReturnValueOnce(languageLoad.promise);
  highlighter.loadTheme.mockReturnValueOnce(themeLoad.promise);
  const { getSharedTimeBudgetTokenizer: get } = await import("../src/core/sharedHighlighterManager");
  const first = get("tsx", "github-dark");
  const second = get("tsx", "github-dark");
  let settled = false;
  void first.then(() => { settled = true; });
  expect(initialize).toHaveBeenCalledTimes(1);
  initialization.resolve(highlighter);
  // Reach both independently controlled resource loads.
  await vi.waitFor(() => {
    expect(highlighter.loadLanguage).toHaveBeenCalledExactlyOnceWith("tsx");
    expect(highlighter.loadTheme).toHaveBeenCalledExactlyOnceWith("github-dark");
  });
  expect(settled).toBe(false);
  languageLoad.resolve();
  await Promise.resolve();
  expect(settled).toBe(false);
  themeLoad.resolve();
  const wrappers = await Promise.all([first, second]);
  for (const wrapper of wrappers) expect(wrapper).not.toHaveProperty("dispose");
  expect(highlighter.dispose).not.toHaveBeenCalled();
});

it("adds languages and themes to one highlighter and reuses loaded resources", async () => {
  const { getSharedTimeBudgetTokenizer: get } = await import("../src/core/sharedHighlighterManager");
  await get("typescript", "github-dark");
  await get("html", "github-dark");
  await get("cpp", "github-dark");
  await get("html", "github-dark");
  await get("html", "github-light");
  await get(undefined, "github-dark");
  expect(initialize).toHaveBeenCalledTimes(1);
  expect(initialize).toHaveBeenCalledWith(expect.objectContaining({ langs: [], themes: [] }));
  expect(highlighter.loadLanguage.mock.calls).toEqual([["typescript"], ["html"], ["cpp"]]);
  expect(highlighter.loadTheme.mock.calls).toEqual([["github-dark"], ["github-light"]]);
});

it("keeps wrapper themes and each stream's grammar states independent", async () => {
  const { getSharedTimeBudgetTokenizer: get } = await import("../src/core/sharedHighlighterManager");
  const dark = await get("typescript", "github-dark");
  const light = await get("html", "github-light");
  const firstState = {} as GrammarState;
  const secondState = {} as typeof firstState;
  highlighter.getLastGrammarState.mockReturnValueOnce(firstState);
  expect(dark.highlight("/* start", "typescript").currentGrammarState).toBe(firstState);
  light.highlight("<div>", "html", secondState);
  dark.highlight("end */", "typescript", firstState);
  expect(highlighter.codeToHast.mock.calls).toEqual([
    ["/* start", { lang: "typescript", theme: "github-dark", grammarState: undefined }],
    ["<div>", { lang: "html", theme: "github-light", grammarState: secondState }],
    ["end */", { lang: "typescript", theme: "github-dark", grammarState: firstState }],
  ]);
  // An existing wrapper sees languages loaded after its creation.
  dark.highlight("<p>", "html");
  expect(highlighter.codeToHast).toHaveBeenLastCalledWith("<p>", {
    lang: "html", theme: "github-dark", grammarState: undefined,
  });
  dark.highlight("plain", "unknown-language");
  expect(highlighter.codeToHast).toHaveBeenLastCalledWith("plain", {
    lang: "text", theme: "github-dark", grammarState: undefined,
  });
});

it("retries failed singleton initialization for all waiting callers", async () => {
  const error = new Error("Initialization failed");
  initialize.mockRejectedValueOnce(error);
  const { getSharedTimeBudgetTokenizer: get } = await import("../src/core/sharedHighlighterManager");
  const results = await Promise.allSettled([get("tsx", "github-dark"), get("html", "github-dark")]);
  expect(results).toEqual([{ status: "rejected", reason: error }, { status: "rejected", reason: error }]);
  expect(initialize).toHaveBeenCalledTimes(1);
  await get("tsx", "github-dark");
  expect(initialize).toHaveBeenCalledTimes(2);
});

it.each(["language", "theme"] as const)("retries a failed %s load without recreating Shiki", async (resource) => {
  const error = new Error("Resource failed");
  const load = resource === "language" ? highlighter.loadLanguage : highlighter.loadTheme;
  load.mockRejectedValueOnce(error);
  const { getSharedTimeBudgetTokenizer: get } = await import("../src/core/sharedHighlighterManager");
  const results = await Promise.allSettled([get("tsx", "github-dark"), get("tsx", "github-dark")]);
  expect(results).toEqual([{ status: "rejected", reason: error }, { status: "rejected", reason: error }]);
  expect(load).toHaveBeenCalledTimes(1);
  await get("tsx", "github-dark");
  expect(load).toHaveBeenCalledTimes(2);
  const otherLoad = resource === "language" ? highlighter.loadTheme : highlighter.loadLanguage;
  expect(otherLoad).toHaveBeenCalledTimes(1);
  expect(initialize).toHaveBeenCalledTimes(1);
  expect(highlighter.dispose).not.toHaveBeenCalled();
});

it("prewarms selected resources and reuses them for subsequent stream requests", async () => {
  const { prewarmCodeStream: prewarm, getSharedTimeBudgetTokenizer: get } =
    await import("../src/core/sharedHighlighterManager");
  const options = {
    languages: ["typescript", "python", "go", "cpp"],
    themes: ["github-dark"],
  } as const;
  await Promise.all([prewarm(options), prewarm(options)]);
  await prewarm(options);
  for (const language of options.languages) await get(language, "github-dark");
  expect(initialize).toHaveBeenCalledTimes(1);
  expect(highlighter.loadLanguage.mock.calls).toEqual([
    ["typescript"], ["python"], ["go"], ["cpp"],
  ]);
  expect(highlighter.loadTheme).toHaveBeenCalledExactlyOnceWith("github-dark");
  expect(highlighter.dispose).not.toHaveBeenCalled();
});

it("shares in-flight prewarming with a stream and waits for all resources", async () => {
  const language = deferred<void>();
  const theme = deferred<void>();
  highlighter.loadLanguage.mockReturnValueOnce(language.promise);
  highlighter.loadTheme.mockReturnValueOnce(theme.promise);
  const { prewarmCodeStream: prewarm, getSharedTimeBudgetTokenizer: get } =
    await import("../src/core/sharedHighlighterManager");
  const warming = prewarm({ languages: ["typescript"], themes: ["github-dark"] });
  const stream = get("typescript", "github-dark");
  let ready = false;
  void warming.then(() => { ready = true; });
  await vi.waitFor(() => {
    expect(highlighter.loadLanguage).toHaveBeenCalledTimes(1);
    expect(highlighter.loadTheme).toHaveBeenCalledTimes(1);
  });
  expect(ready).toBe(false);
  language.resolve();
  await Promise.resolve();
  expect(ready).toBe(false);
  theme.resolve();
  await expect(warming).resolves.toBeUndefined();
  await expect(stream).resolves.toHaveProperty("highlight");
  expect(initialize).toHaveBeenCalledTimes(1);
  expect(highlighter.loadLanguage).toHaveBeenCalledTimes(1);
  expect(highlighter.loadTheme).toHaveBeenCalledTimes(1);
});

it("supports engine-only prewarming and independently optional resource arrays", async () => {
  const { prewarmCodeStream: prewarm } = await import("../src/core/sharedHighlighterManager");
  await prewarm();
  await prewarm({});
  expect(initialize).toHaveBeenCalledTimes(1);
  expect(highlighter.loadLanguage).not.toHaveBeenCalled();
  expect(highlighter.loadTheme).not.toHaveBeenCalled();
  await prewarm({ languages: ["python"] });
  expect(highlighter.loadTheme).not.toHaveBeenCalled();
  await prewarm({ themes: ["github-dark", "github-light"] });
  expect(highlighter.loadLanguage).toHaveBeenCalledExactlyOnceWith("python");
  expect(highlighter.loadTheme.mock.calls).toEqual([["github-dark"], ["github-light"]]);
});

it("propagates prewarm initialization failures and allows retry", async () => {
  const error = new Error("Engine failed");
  initialize.mockRejectedValueOnce(error);
  const { prewarmCodeStream: prewarm } = await import("../src/core/sharedHighlighterManager");
  await expect(prewarm()).rejects.toBe(error);
  await expect(prewarm()).resolves.toBeUndefined();
  expect(initialize).toHaveBeenCalledTimes(2);
});

it.each(["language", "theme"] as const)("retries failed prewarm %s loads on the same highlighter", async (resource) => {
  const error = new Error("Prewarm resource failed");
  const load = resource === "language" ? highlighter.loadLanguage : highlighter.loadTheme;
  load.mockRejectedValueOnce(error);
  const { prewarmCodeStream: prewarm, getSharedTimeBudgetTokenizer: get } =
    await import("../src/core/sharedHighlighterManager");
  const options = { languages: ["typescript"], themes: ["github-dark"] } as const;
  await expect(prewarm(options)).rejects.toBe(error);
  await expect(prewarm(options)).resolves.toBeUndefined();
  await get("typescript", "github-dark");
  expect(initialize).toHaveBeenCalledTimes(1);
  expect(load).toHaveBeenCalledTimes(2);
  const otherLoad = resource === "language" ? highlighter.loadTheme : highlighter.loadLanguage;
  expect(otherLoad).toHaveBeenCalledTimes(1);
});
