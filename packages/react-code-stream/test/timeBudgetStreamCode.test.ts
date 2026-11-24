// @vitest-environment jsdom
import { act, createElement, StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { StreamCode } from "../src/react/StreamCode";

const { highlight, dispose, initialize, getShared } = vi.hoisted(() => ({
  highlight: vi.fn((source: string) => ({
    html: `<pre><code>${source.replaceAll("<", "&lt;")}</code></pre>`,
    currentGrammarState: undefined,
  })),
  dispose: vi.fn(),
  initialize: vi.fn(),
  getShared: vi.fn(),
}));

// Manager behavior is tested separately; these tests exercise session ownership.
vi.mock("../src/core/sharedHighlighterManager", () => ({
  getSharedTimeBudgetTokenizer: getShared,
}));

beforeEach(() => {
  let pending: Promise<{ highlight: typeof highlight }> | undefined;
  initialize.mockImplementation(async () => ({ highlight, dispose }));
  getShared.mockImplementation(() => {
    pending ??= initialize().then(() => ({ highlight }));
    return pending;
  });
});

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
        createElement(StreamCode, {
          children: source,
        }),
      );
    });
  }

  try {
    for (const source of [
      "one\n".repeat(10) + "two\n".repeat(10) + "<three>",
      "one\n".repeat(10) + "two\n".repeat(10) + "<three> grows",
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
      if (source.startsWith("one")) {
        expect(host.querySelectorAll("[data-block-id]")).toHaveLength(3);
        expect(host.querySelector("[data-block-id]")?.textContent).toBe("one\n".repeat(10));
      }
    }
    await render("pending\nwork");
    const calls = highlight.mock.calls.length;
    await act(async () => root.unmount());
    await act(async () => {
      await vi.runAllTimersAsync();
    });
    expect(highlight).toHaveBeenCalledTimes(calls);
    expect(dispose).not.toHaveBeenCalled();
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

  async function render(theme: string) {
    await act(async () => {
      root.render(
        createElement(StrictMode, null,
          createElement(StreamCode, {
            children: "first\nsecond\ntail",
            theme,
          }),
        ),
      );
    });
    await act(async () => { await vi.runAllTimersAsync(); });
  }

  try {
    await render("github-light");
    expect(initialize).toHaveBeenCalledTimes(1);
    expect(dispose).not.toHaveBeenCalled();
    expect(host.querySelector("code")?.textContent).toBe("first\nsecond\ntail");
    await render("nord");
    expect(initialize).toHaveBeenCalledTimes(1);
    // Changing the theme remounts the session; Strict Mode replays its effects.
    expect(dispose).not.toHaveBeenCalled();
    expect(host.querySelector("code")?.textContent).toBe("first\nsecond\ntail");
  } finally {
    await act(async () => root.unmount());
  }
  expect(dispose).not.toHaveBeenCalled();
  expect(vi.getTimerCount()).toBe(0);
});


it("shares pending initialization and keeps surviving streams independent", async () => {
  vi.useFakeTimers();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) =>
    setTimeout(() => callback(performance.now()), 16),
  );
  vi.stubGlobal("cancelAnimationFrame", clearTimeout);
  let resolve!: (value: { highlight: typeof highlight; dispose: typeof dispose }) => void;
  initialize.mockImplementationOnce(() => new Promise((done) => { resolve = done; }));
  const hosts = [document.createElement("div"), document.createElement("div")];
  const roots = hosts.map((host) => createRoot(host));
  const onError = vi.fn();
  const renderStream = (index: number, source: string) =>
    roots[index].render(createElement(StreamCode, {
      children: source, language: "typescript", theme: "nord", onError,
    }));

  try {
    await act(async () => {
      renderStream(0, "A first\nA tail");
      renderStream(1, "B first\nB tail");
    });
    expect(initialize).toHaveBeenCalledTimes(1);
    expect(highlight).not.toHaveBeenCalled();
    // A disappears while both components are awaiting the same promise.
    await act(async () => roots[0].unmount());
    await act(async () => { resolve({ highlight, dispose }); });
    await act(async () => { await vi.runAllTimersAsync(); });
    expect(hosts[0].textContent).toBe("");
    expect(hosts[1].querySelector("code")?.textContent).toBe("B first\nB tail");
    expect(highlight.mock.calls.every(([source]) => source.startsWith("B"))).toBe(true);
    expect(dispose).not.toHaveBeenCalled();

    // Remount A from the completed cache, then remove it with an update pending.
    roots[0] = createRoot(hosts[0]);
    await act(async () => { renderStream(0, "A remount"); });
    await act(async () => { await vi.runAllTimersAsync(); });
    expect(hosts[0].querySelector("code")?.textContent).toBe("A remount");
    await act(async () => { renderStream(0, "A pending"); });
    const callsBeforeUnmount = highlight.mock.calls.length;
    await act(async () => roots[0].unmount());
    await act(async () => { await vi.runAllTimersAsync(); });
    expect(highlight).toHaveBeenCalledTimes(callsBeforeUnmount);
    await act(async () => { renderStream(1, "B first\nB tail grows"); });
    await act(async () => { await vi.runAllTimersAsync(); });
    expect(hosts[1].querySelector("code")?.textContent).toBe("B first\nB tail grows");
    expect(initialize).toHaveBeenCalledTimes(1);
    expect(onError).not.toHaveBeenCalled();
  } finally {
    await act(async () => { roots.forEach((root) => root.unmount()); });
  }
  expect(dispose).not.toHaveBeenCalled();
  expect(vi.getTimerCount()).toBe(0);
});
