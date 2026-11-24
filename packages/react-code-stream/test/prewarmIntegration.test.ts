// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";

// Instrument real Shiki creation and loads; all grammar/theme processing stays real.
vi.mock("shiki", async (importOriginal) => {
  const actual = await importOriginal<typeof import("shiki")>();
  return {
    ...actual,
    createHighlighter: vi.fn(async (...args: Parameters<typeof actual.createHighlighter>) => {
      const highlighter = await actual.createHighlighter(...args);
      vi.spyOn(highlighter, "loadLanguage");
      vi.spyOn(highlighter, "loadTheme");
      return highlighter;
    }),
  };
});

it("prewarms real Shiki through the public API and reuses it when time-budget views mount", async () => {
  const { createHighlighter } = await import("shiki");
  const { prewarmCodeStream, StreamCode } = await import("../src/index");
  await prewarmCodeStream({
    themes: ["github-dark"], languages: ["typescript", "python", "go", "cpp"],
  });
  expect(createHighlighter).toHaveBeenCalledTimes(1);
  const highlighter = await vi.mocked(createHighlighter).mock.results[0].value;
  expect(highlighter.getLoadedLanguages()).toEqual(expect.arrayContaining(["typescript", "python", "go", "cpp"]));
  expect(highlighter.getLoadedThemes()).toContain("github-dark");
  const languageLoads = vi.mocked(highlighter.loadLanguage).mock.calls.length;
  const themeLoads = vi.mocked(highlighter.loadTheme).mock.calls.length;
  const host = document.createElement("div");
  const root = createRoot(host);
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => setTimeout(() => callback(performance.now()), 0));
  vi.stubGlobal("cancelAnimationFrame", clearTimeout);
  vi.useFakeTimers();
  const onError = vi.fn();
  try {
    const examples = [
      ["typescript", "const answer: number = 42;"],
      ["python", "answer = 42"],
      ["go", "package main"],
      ["cpp", "int answer = 42;"],
    ];
    for (const [language, source] of examples) {
      await act(async () => {
        root.render(createElement(StreamCode, {
          key: language, language, theme: "github-dark", children: source, onError,
        }));
      });
      await act(async () => { await vi.runAllTimersAsync(); });
      expect(host.querySelector("code")?.textContent).toBe(source);
      expect(host.querySelector("code span[style]")).not.toBeNull();
    }
    expect(onError).not.toHaveBeenCalled();
    expect(createHighlighter).toHaveBeenCalledTimes(1);
    expect(highlighter.loadLanguage).toHaveBeenCalledTimes(languageLoads);
    expect(highlighter.loadTheme).toHaveBeenCalledTimes(themeLoads);
  } finally {
    await act(async () => root.unmount());
    vi.useRealTimers();
    vi.unstubAllGlobals();
    // This test owns its isolated module's real highlighter.
    highlighter.dispose();
  }
}, 20000);
