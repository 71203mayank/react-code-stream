export type Renderer = "streamcode" | "syntax-highlighter";

export const rendererNames: Record<Renderer, string> = {
  streamcode: "StreamCode",
  "syntax-highlighter": "react-syntax-highlighter (PrismLight)",
};

/** Keep result labels explicit while retaining stable comparator IDs in raw data. */
export function namesForVariant(variant: "streamcode" | "time-budget") {
  return {
    ...rendererNames,
    streamcode:
      variant === "time-budget" ? "TimeBudgetStreamCode" : "StreamCode",
  };
}
