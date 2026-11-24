import { createRoot } from "react-dom/client";
import BenchmarkPage from "./index";

// The benchmark has one renderer implementation; keep the time-budget route.
if (window.location.pathname.replace(/\/$/, "") === "/streamcode") {
  window.location.replace("/time-budget");
} else {
  createRoot(document.getElementById("root")!).render(<BenchmarkPage />);
}
