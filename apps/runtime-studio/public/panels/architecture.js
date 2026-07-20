import { h, panelHeader, notice, loadHistory } from "../shared.js";

// The real request path, verified against source (this Studio's own
// repository README documents the same path, sourced from
// packages/middleware/src/pipeline.ts, orchestrator.ts, and
// strategy-layer.ts). Strategy Layer is drawn dashed/optional since it's
// off by default and this Studio cannot know if the target deployment
// has it enabled.
const STAGES = [
  { id: "auth", label: "Auth" },
  { id: "ratelimit", label: "Rate limit" },
  { id: "cache", label: "Cache check" },
  { id: "orchestrator", label: "Orchestrator" },
  { id: "strategy", label: "Strategy Layer", optional: true },
  { id: "policy", label: "Policy Engine" },
  { id: "credential", label: "Credential Resolver" },
  { id: "reliability", label: "Reliability" },
  { id: "provider", label: "Provider Adapter" },
];

export function renderArchitecture(root) {
  function lastCompletedRequest() {
    return loadHistory().find((e) => e.ok && (e.panel === "execute" || e.panel === "pipeline"));
  }

  function buildDiagram() {
    const nodeW = 96;
    const nodeH = 40;
    const gapX = 16;
    const totalW = STAGES.length * nodeW + (STAGES.length - 1) * gapX;
    const svgNS = "http://www.w3.org/2000/svg";
    const svg = document.createElementNS(svgNS, "svg");
    svg.setAttribute("viewBox", `0 0 ${totalW} 120`);
    svg.setAttribute("class", "arch-diagram");
    svg.setAttribute("width", "100%");

    STAGES.forEach((stage, i) => {
      const x = i * (nodeW + gapX);
      const g = document.createElementNS(svgNS, "g");
      g.setAttribute("id", `arch-node-${stage.id}`);
      g.setAttribute("class", "arch-node");
      g.setAttribute("opacity", "0.55");

      const rect = document.createElementNS(svgNS, "rect");
      rect.setAttribute("x", x);
      rect.setAttribute("y", 20);
      rect.setAttribute("width", nodeW);
      rect.setAttribute("height", nodeH);
      rect.setAttribute("rx", 4);
      rect.setAttribute("fill", "var(--surface-raised)");
      rect.setAttribute("stroke", stage.optional ? "var(--accent-warn)" : "var(--border)");
      if (stage.optional) rect.setAttribute("stroke-dasharray", "3,2");
      g.append(rect);

      const text = document.createElementNS(svgNS, "text");
      text.setAttribute("x", x + nodeW / 2);
      text.setAttribute("y", 44);
      text.setAttribute("text-anchor", "middle");
      text.setAttribute("font-size", "10");
      text.setAttribute("class", "arch-node-label");
      text.textContent = stage.label;
      g.append(text);

      if (stage.optional) {
        const optText = document.createElementNS(svgNS, "text");
        optText.setAttribute("x", x + nodeW / 2);
        optText.setAttribute("y", 15);
        optText.setAttribute("text-anchor", "middle");
        optText.setAttribute("font-size", "8");
        optText.setAttribute("fill", "var(--accent-warn)");
        optText.textContent = "if enabled";
        g.append(optText);
      }

      svg.append(g);

      if (i < STAGES.length - 1) {
        const line = document.createElementNS(svgNS, "line");
        line.setAttribute("x1", x + nodeW);
        line.setAttribute("y1", 40);
        line.setAttribute("x2", x + nodeW + gapX);
        line.setAttribute("y2", 40);
        line.setAttribute("stroke", "var(--border)");
        svg.append(line);
      }
    });

    return svg;
  }

  async function replay(svg) {
    const entry = lastCompletedRequest();
    const totalMs = entry?.response?.execution?.latencyMs ?? 900;
    // Illustrative pacing only — see the notice below. We do not have
    // real per-stage timing from the API, so this divides the one real
    // number we do have (end-to-end latency) evenly across stages.
    const perStage = Math.max(60, Math.round(totalMs / STAGES.length));

    for (const stage of STAGES) {
      const node = svg.querySelector(`#arch-node-${stage.id}`);
      node.setAttribute("opacity", "1");
      node.querySelector("rect").setAttribute("stroke", "var(--accent)");
      await new Promise((r) => setTimeout(r, perStage));
      node.querySelector("rect").setAttribute("stroke", stage.optional ? "var(--accent-warn)" : "var(--border)");
    }
  }

  function render() {
    root.replaceChildren();
    root.append(
      panelHeader(
        "Architecture",
        "The real request path a call to POST /v1/execute takes through this repository's own packages — sourced from packages/middleware/src/pipeline.ts, orchestrator.ts, and strategy-layer.ts, the same three files this repository's own README diagram is built from.",
        "Orienting yourself in the codebase, or explaining to someone else what actually runs between a request and a response.",
      ),
    );

    root.append(
      notice(
        [
          h("strong", {}, "The “Replay” animation below paces evenly using one real number "),
          "(the last successful request's end-to-end ", h("code", {}, "execution.latencyMs"), "), divided across stages — it is illustrative pacing, not measured per-stage timing. The public API doesn't report how long any individual stage took, so this Studio doesn't pretend to show that.",
        ],
        "info",
      ),
    );

    const svg = buildDiagram();
    const card = h("div", { class: "card" }, [
      h("div", { class: "card-title" }, "Request flow"),
      svg,
      h("div", { class: "btn-row", style: "margin-top: 14px" }, [
        h("button", { class: "btn btn--secondary", onClick: () => replay(svg) }, "Replay last successful request"),
      ]),
      h("p", { class: "field-hint" }, "Strategy Layer is drawn dashed because it's off by default and this Studio has no way to know whether the target deployment has ENABLE_STRATEGY_LAYER=true."),
    ]);
    root.append(card);
  }

  render();
}
