import { h, panelHeader, notice, loadHistory, formatCost, formatMs } from "../shared.js";

export function renderTelemetry(root) {
  function render() {
    root.replaceChildren();
    root.append(
      panelHeader(
        "Telemetry",
        "Per-request execution facts, drawn from this Studio's own Request History (every field below comes from a real ExecuteResponse this browser actually received — nothing is generated).",
        "Reviewing what actually happened across several recent calls — provider distribution, retry rates, cost — without re-reading each raw response individually.",
      ),
    );

    root.append(
      notice(
        [
          h("strong", {}, "Not shown, because the API doesn't return it: "),
          "which Runtime Profile or Execution Profile was effectively applied, and a per-middleware timing breakdown (auth/rate-limit/cache/orchestrator each have internal timing, but ",
          h("code", {}, "ExecuteResponse"), " reports only the end-to-end ", h("code", {}, "execution.latencyMs"), "). See the Runtime Profiles and Execution Profiles panels for why.",
        ],
        "info",
      ),
    );

    const history = loadHistory().filter((h) => h.panel === "execute" || h.panel === "streaming" || h.panel === "pipeline");

    if (history.length === 0) {
      root.append(h("div", { class: "card" }, [h("div", { class: "empty-state" }, "No requests yet — run something from Execute, Streaming, or Pipeline first.")]));
      return;
    }

    const table = h("table", { style: "width:100%; border-collapse: collapse; font-size: 12px; font-family: var(--font-mono)" }, [
      h("thead", {}, h("tr", {}, ["Time", "Panel", "Request ID", "Provider", "Latency", "Retries", "Tokens", "Cost", "Status"].map((label) =>
        h("th", { style: "text-align:left; padding:6px; border-bottom:1px solid var(--border); font-family: var(--font-ui); color: var(--text-faint); font-size: 11px; text-transform: uppercase" }, label),
      ))),
      h("tbody", {}, history.slice(0, 20).map((entry) => {
        const exec = entry.response?.execution;
        const usage = entry.response?.usage;
        return h("tr", {}, [
          new Date(entry.at).toLocaleTimeString(),
          entry.panel,
          entry.response?.requestId ?? "—",
          exec?.providerId ?? "—",
          formatMs(exec?.latencyMs ?? entry.latencyMs),
          exec?.retries ?? "—",
          usage ? `${usage.inputTokens}/${usage.outputTokens}` : "—",
          formatCost(usage?.estimatedCostUsd ?? entry.costUsd),
          entry.ok ? "ok" : "error",
        ].map((cell) => h("td", { style: "padding:6px; border-bottom:1px solid var(--border-soft)" }, String(cell))));
      })),
    ]);

    root.append(h("div", { class: "card" }, [h("div", { class: "card-title" }, `Last ${Math.min(history.length, 20)} requests`), table]));
  }

  window.addEventListener("studio:history-changed", render);
  render();
}
