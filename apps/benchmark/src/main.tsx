import { createRoot } from "react-dom/client";
import BenchmarkPage from "./index";

// Full-page navigation gives each variant a fresh harness and cancels active trials.
// Both routes deliberately share the same workload and measurement implementation.
const path = window.location.pathname.replace(/\/$/, "");
const variant = path === "/time-budget" ? "time-budget" : "streamcode";

createRoot(document.getElementById("root")!).render(
  <BenchmarkPage variant={variant} />,
);
