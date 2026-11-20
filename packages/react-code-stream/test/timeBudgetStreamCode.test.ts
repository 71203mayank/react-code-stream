// @vitest-environment jsdom
import { act, createElement, StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { TimeBudgetStreamCode } from "../src/react/TimeBudgetStreamCode";

const { highlight, dispose } = vi.hoisted(() => ({
  highlight: vi.fn((source: string) => ({
    html: `<pre><code>${source.replaceAll("<", "&lt;")}</code></pre>`,
    currentGrammarState: undefined,
  })),
  dispose: vi.fn(),
}));

vi.mock("../src/core/tokenizer", () => ({
  DEFAULT_THEME: "github-dark",
  FALLBACK_LANGUAGE: "text",
  createGrammarStateCodeTokenizer: vi.fn(async () => ({ highlight, dispose })),
}));

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

it("finishes queued blocks, preserves replacements, and cancels work on unmount", async () => {
  vi.useFakeTimers();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) =>
    setTimeout(() => callback(performance.now()), 16),
  );
  vi.stubGlobal("cancelAnimationFrame", clearTimeout);
  const host = document.createElement("div");
  const root = createRoot(host);

  async function render(source: string) {
    await act(async () => {
      root.render(
        createElement(TimeBudgetStreamCode, {
          children: source,
          linesPerBlock: 1,
        }),
      );
    });
  }

  try {
    for (const source of [
      "one\ntwo\n<three>",
      "one\ntwo\n<three> grows",
      "replacement",
      "",
    ]) {
      await render(source);
      if (!highlight.mock.calls.length) {
        expect(host.querySelector("code")?.textContent).toBe("");
        expect(host.querySelector("[data-block-id]")).toBeNull();
      }
      await act(async () => {
        await vi.runAllTimersAsync();
      });
      expect(host.querySelector("code")?.textContent).toBe(source);
      expect(host.querySelector("three")).toBeNull();
    }
    await render("pending\nwork");
    const calls = highlight.mock.calls.length;
    await act(async () => root.unmount());
    await act(async () => {
      await vi.runAllTimersAsync();
    });
    expect(highlight).toHaveBeenCalledTimes(calls);
    expect(dispose).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  } finally {
    // root.unmount is idempotent, including after a failed assertion.
    await act(async () => root.unmount());
  }
});

it("releases independent scheduler sessions on configuration changes and Strict Mode replay", async () => {
  vi.useFakeTimers();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) =>
    setTimeout(() => callback(performance.now()), 16),
  );
  vi.stubGlobal("cancelAnimationFrame", clearTimeout);
  const host = document.createElement("div");
  const root = createRoot(host);

  async function render(sliceBudgetMs: number) {
    await act(async () => {
      root.render(
        createElement(StrictMode, null,
          createElement(TimeBudgetStreamCode, {
            children: "first\nsecond\ntail",
            linesPerBlock: 1,
            sliceBudgetMs,
          }),
        ),
      );
    });
    await act(async () => { await vi.runAllTimersAsync(); });
  }

  try {
    await render(8);
    expect(dispose).toHaveBeenCalledTimes(1);
    expect(host.querySelector("code")?.textContent).toBe("first\nsecond\ntail");
    await render(4);
    // Changing the budget remounts the session; Strict Mode replays its effects.
    expect(dispose).toHaveBeenCalledTimes(3);
    expect(host.querySelector("code")?.textContent).toBe("first\nsecond\ntail");
  } finally {
    await act(async () => root.unmount());
  }
  expect(dispose).toHaveBeenCalledTimes(4);
  expect(vi.getTimerCount()).toBe(0);
});
