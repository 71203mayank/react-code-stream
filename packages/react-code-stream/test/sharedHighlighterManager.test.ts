import { beforeEach, expect, it, vi } from "vitest";

const { initialize, highlight, dispose } = vi.hoisted(() => ({
  initialize: vi.fn(),
  highlight: vi.fn(),
  dispose: vi.fn(),
}));

vi.mock("../src/core/tokenizer", () => ({
  createGrammarStateCodeTokenizer: initialize,
}));

beforeEach(() => {
  // Every test gets a fresh module cache without adding a production reset API.
  vi.resetModules();
  vi.resetAllMocks();
  initialize.mockResolvedValue({ highlight, dispose });
});

it("deduplicates concurrent initialization and reuses the completed tokenizer", async () => {
  let resolve!: (value: { highlight: typeof highlight; dispose: typeof dispose }) => void;
  initialize.mockImplementationOnce(() => new Promise((done) => { resolve = done; }));
  const { getSharedTimeBudgetTokenizer: get } = await import("../src/core/sharedHighlighterManager");
  const first = get("tsx", "github-dark");
  const second = get("tsx", "github-dark");
  expect(second).toBe(first);
  expect(initialize).toHaveBeenCalledExactlyOnceWith({ languages: ["tsx"], theme: "github-dark" });
  resolve({ highlight, dispose });
  const tokenizer = await first;
  expect(await second).toBe(tokenizer);
  expect(get("tsx", "github-dark")).toBe(first);
  expect(await get("tsx", "github-dark")).toBe(tokenizer);
  expect(initialize).toHaveBeenCalledTimes(1);
  expect(tokenizer.highlight).toBe(highlight);
  expect(tokenizer).not.toHaveProperty("dispose");
  expect(dispose).not.toHaveBeenCalled();
});

it("separates language/theme configurations and supports plain text", async () => {
  const { getSharedTimeBudgetTokenizer: get } = await import("../src/core/sharedHighlighterManager");
  const tsx = get("tsx", "github-dark");
  const python = get("python", "github-dark");
  const light = get("tsx", "github-light");
  const text = get(undefined, "github-dark");
  expect(new Set([tsx, python, light, text]).size).toBe(4);
  await Promise.all([tsx, python, light, text]);
  expect(initialize.mock.calls).toEqual([
    [{ languages: ["tsx"], theme: "github-dark" }],
    [{ languages: ["python"], theme: "github-dark" }],
    [{ languages: ["tsx"], theme: "github-light" }],
    [{ languages: [], theme: "github-dark" }],
  ]);
  expect(get(undefined, "github-dark")).toBe(text);
});

it("shares initialization errors and retries only the failed configuration", async () => {
  const error = new Error("Initialization failed");
  initialize.mockRejectedValueOnce(error);
  const { getSharedTimeBudgetTokenizer: get } = await import("../src/core/sharedHighlighterManager");
  const failed = get("tsx", "github-dark");
  const concurrent = get("tsx", "github-dark");
  const healthy = get("python", "github-dark");
  expect(concurrent).toBe(failed);
  await expect(failed).rejects.toBe(error);
  await expect(concurrent).rejects.toBe(error);
  await healthy;
  const retry = get("tsx", "github-dark");
  expect(retry).not.toBe(failed);
  await expect(retry).resolves.toHaveProperty("highlight", highlight);
  expect(get("python", "github-dark")).toBe(healthy);
  expect(initialize).toHaveBeenCalledTimes(3);
});
