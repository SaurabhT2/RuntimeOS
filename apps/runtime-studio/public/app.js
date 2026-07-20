import { h, clear, apiHealth, apiMeta } from "./shared.js";
import { renderExecute } from "./panels/execute.js";
import { renderStreaming } from "./panels/streaming.js";
import { renderPipeline } from "./panels/pipeline.js";
import { renderRuntimeProfiles } from "./panels/runtime-profiles.js";
import { renderExecutionProfiles } from "./panels/execution-profiles.js";
import { renderStrategyLayer } from "./panels/strategy-layer.js";
import { renderBudgetGovernance } from "./panels/budget-governance.js";
import { renderTelemetry } from "./panels/telemetry.js";
import { renderHistory } from "./panels/history.js";
import { renderArchitecture } from "./panels/architecture.js";

const PANELS = [
  { id: "execute", icon: "▶", label: "Execute", render: renderExecute },
  { id: "streaming", icon: "≋", label: "Streaming", render: renderStreaming },
  { id: "pipeline", icon: "⛓", label: "Pipeline", render: renderPipeline },
  { id: "runtime-profiles", icon: "◧", label: "Runtime Profiles", render: renderRuntimeProfiles },
  { id: "execution-profiles", icon: "◨", label: "Execution Profiles", render: renderExecutionProfiles },
  { id: "strategy-layer", icon: "◆", label: "Strategy Layer", render: renderStrategyLayer },
  { id: "budget-governance", icon: "$", label: "Budget Governance", render: renderBudgetGovernance },
  { id: "telemetry", icon: "▤", label: "Telemetry", render: renderTelemetry },
  { id: "history", icon: "↺", label: "Request History", render: renderHistory },
  { id: "architecture", icon: "▦", label: "Architecture", render: renderArchitecture },
];

const sidebar = document.getElementById("sidebar");
const workspace = document.getElementById("workspace");

function currentPanelId() {
  const hash = window.location.hash.replace(/^#\/?/, "");
  return PANELS.some((p) => p.id === hash) ? hash : "execute";
}

function renderSidebar() {
  clear(sidebar);
  sidebar.append(h("div", { class: "nav-group-label" }, "RuntimeOS capabilities"));
  const active = currentPanelId();
  for (const panel of PANELS) {
    sidebar.append(
      h(
        "button",
        {
          class: `nav-item${panel.id === active ? " active" : ""}`,
          onClick: () => {
            window.location.hash = `/${panel.id}`;
          },
        },
        [h("span", { class: "nav-icon" }, panel.icon), panel.label],
      ),
    );
  }
}

function renderWorkspace() {
  clear(workspace);
  const panel = PANELS.find((p) => p.id === currentPanelId());
  panel.render(workspace);
}

function route() {
  renderSidebar();
  renderWorkspace();
}

window.addEventListener("hashchange", route);
route();

// --- Health status, polled against the real target gateway's
// GET /v1/health (via the Studio's own proxy) — never fabricated.
const healthDot = document.getElementById("health-dot");
const healthText = document.getElementById("health-text");

async function refreshHealth() {
  try {
    const meta = await apiMeta();
    const health = await apiHealth();
    if (!health.ok && health.status !== 503) {
      // 503 is health.ts's own documented "unhealthy" status — still a
      // real, meaningful response, not a proxy failure.
      throw new Error(`unexpected status ${health.status}`);
    }
    const status = health.body?.status ?? "unknown";
    healthDot.className = `status-dot status-dot--${status}`;
    const providerCount = health.body?.providers?.length ?? 0;
    const healthyCount = health.body?.providers?.filter((p) => p.healthy).length ?? 0;
    healthText.textContent = `${meta.body?.gatewayUrl ?? "target gateway"} — ${status} (${healthyCount}/${providerCount} providers)`;
  } catch {
    healthDot.className = "status-dot status-dot--unhealthy";
    healthText.textContent = "could not reach target gateway — check GATEWAY_URL/GATEWAY_API_KEY on this Studio process";
  }
}

refreshHealth();
setInterval(refreshHealth, 15000);
