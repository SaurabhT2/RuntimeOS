import { h, panelHeader, jsonBlock, notice, badge, apiExecute, pushHistory } from "../shared.js";

export function renderBudgetGovernance(root) {
  const state = { organizationId: "example-org", running: false, result: null };

  async function probe() {
    state.running = true;
    render();
    const request = {
      task: "summarization",
      input: { text: "A test request used only to see whether Budget Governance rejects it." },
      tenant: { organizationId: state.organizationId.trim() },
    };
    const result = await apiExecute(request);
    state.running = false;
    state.result = { request, ...result };
    pushHistory({
      panel: "budget-governance",
      summary: result.status === 402 ? "probe → BUDGET_EXCEEDED (enforcement is active)" : `probe → HTTP ${result.status} (no observable budget enforcement)`,
      request,
      response: result.body,
      status: result.status,
      ok: result.ok,
    });
    render();
  }

  function render() {
    root.replaceChildren();
    root.append(
      panelHeader(
        "Budget Governance",
        "Per-tenant daily/monthly spend budgets with configurable threshold actions (alert, downgrade_model, switch_provider, block). Evaluated before execution, before Routing Rules (architecture §43).",
        "You need hard or soft spend limits enforced per tenant/organization, independent of any single request's own maxCostUsd constraint.",
      ),
    );

    root.append(
      notice(
        [
          h("strong", {}, "Neither apps/gateway-server nor apps/vercel-adapter exposes Budget Governance configuration today. "),
          "This is a real, tracked gap — not something this Studio works around or simulates. Both apps' environment-variable loaders populate every other runtime setting they need, but neither has a variable or config-file field for ",
          h("code", {}, "budgetPolicies"), " or ", h("code", {}, "budgetEnforcementMode"), ". A deployment can only use Budget Governance today by writing custom composition-root code that calls ",
          h("code", {}, "bootstrap()"), " directly. See ", h("code", {}, "docs/release/KNOWN_LIMITATIONS.md"),
          " §9.3, ", h("code", {}, "docs/release/RUNTIME_CONFIGURATION_MATRIX.md"), ", and ",
          h("code", {}, "docs/backlog/expose-complete-gatewayruntimeconfig-surface.md"), " in the RuntimeOS repository for the full detail and tracked fix.",
        ],
        "danger",
      ),
    );

    root.append(
      h("div", { class: "card" }, [
        h("div", { class: "card-title" }, "Mode (concept, not queryable from here)"),
        h("p", {}, [
          badge("shadow", "warn"), " — the default. Computes real decisions and records them to telemetry, never blocks or alters routing. ",
          badge("enforcing", "danger"), " — an explicit opt-in (", h("code", {}, "budgetEnforcementMode: \"enforcing\""), "). ",
          "There is no API response field reporting which mode a deployment is running in — you can only infer it indirectly, as below.",
        ]),
      ]),
    );

    root.append(
      h("div", { class: "card" }, [
        h("div", { class: "card-title" }, "Probe the target deployment"),
        h("p", {}, [
          "This sends one ordinary request. If the target gateway has Budget Governance wired in Enforcement Mode ",
          "and this tenant is over a ", h("code", {}, "block"), " threshold, the response is a real ",
          h("code", {}, "402 BUDGET_EXCEEDED"), " ", h("code", {}, "GatewayError"), " — not simulated, an actual error code this platform defines (", h("code", {}, "packages/gateway-runtime/src/http/respond.ts"), "). Any other outcome means either Budget Governance isn't configured on this deployment, it's in shadow mode, or this tenant is under its thresholds — this probe can't distinguish between those three.",
        ]),
        h("div", { class: "field" }, [
          h("label", {}, "Tenant · organizationId"),
          h("input", { type: "text", value: state.organizationId, onInput: (e) => (state.organizationId = e.target.value) }),
        ]),
        h("div", { class: "btn-row" }, [
          h("button", { class: "btn", disabled: state.running || undefined, onClick: probe }, state.running ? "Probing…" : "Send probe request"),
        ]),
      ]),
    );

    if (state.result) {
      const result = state.result;
      const card = h("div", { class: "card" }, [h("div", { class: "card-title" }, "Result")]);
      if (result.status === 402) {
        card.append(
          notice(
            [
              badge("BUDGET_EXCEEDED", "danger"),
              ` Enforcement Mode is active for this tenant on the target deployment. `,
              result.body?.error?.details?.alertsTriggered
                ? `Alerts triggered: ${JSON.stringify(result.body.error.details.alertsTriggered)}`
                : "",
            ],
            "danger",
          ),
        );
      } else if (result.ok) {
        card.append(notice(["Request succeeded normally — no observable budget enforcement on this call. See the caveats above before concluding Budget Governance isn't configured at all."], "info"));
      } else {
        card.append(notice([badge(result.body?.error?.code ?? "error", "danger"), ` ${result.body?.error?.message ?? "request failed for an unrelated reason"}`], "danger"));
      }
      card.append(jsonBlock(result.body));
      root.append(card);
    }
  }

  render();
}
