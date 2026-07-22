import {
  h,
  panelHeader,
  jsonBlock,
  notice,
  metric,
  badge,
  apiExecute,
  pushHistory,
  formatMs,
} from "../shared.js";

export function renderStrategyLayer(root) {
  const state = { organizationId: "example-org", running: false, result: null };

  async function run() {
    state.running = true;
    render();
    const request = {
      task: "summarization",
      input: {
        text: "A test request used to observe whatever routing outcome the target deployment produces.",
      },
      tenant: { organizationId: state.organizationId.trim() },
    };
    const result = await apiExecute(request);
    state.running = false;
    state.result = { request, ...result };
    pushHistory({
      panel: "strategy-layer",
      summary: `probe → ${result.ok ? result.body.execution.providerId : result.body?.error?.code}`,
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
        "Strategy Layer",
        "Capability-aware, execution-profile-aware, cost-aware, and prompt-optimization-aware routing, layered ahead of Policy Engine (architecture §30). Off by default — an operator enables it deployment-wide via ENABLE_STRATEGY_LAYER=true.",
        "You want routing to account for more than the base Policy Engine's task-to-model scoring — cost posture, prompt rewriting, per-tenant budget policy, and more, composed into one decision ahead of the usual routing step.",
      ),
    );

    root.append(
      notice(
        [
          h("strong", {}, "This is a deployment-wide, not per-request, toggle. "),
          "There is no field on ",
          h("code", {}, "ExecuteRequest"),
          " that turns the Strategy Layer on or off, and no API response field that reports whether it was applied to a given request — so this panel doesn't offer a fake ON/OFF switch. Whether it's active on the gateway you're pointed at depends entirely on that deployment's own ",
          h("code", {}, "ENABLE_STRATEGY_LAYER"),
          " configuration, which this Studio has no way to query either.",
        ],
        "info",
      ),
    );

    root.append(
      h("div", { class: "card" }, [
        h("div", { class: "card-title" }, "What the API actually exposes about routing"),
        h("table", { style: "width:100%; border-collapse: collapse; font-size: 13px" }, [
          h(
            "thead",
            {},
            h("tr", {}, [
              h(
                "th",
                { style: "text-align:left; padding:6px; border-bottom:1px solid var(--border)" },
                "You might expect",
              ),
              h(
                "th",
                { style: "text-align:left; padding:6px; border-bottom:1px solid var(--border)" },
                "What ExecuteResponse.execution actually reports",
              ),
            ]),
          ),
          h(
            "tbody",
            {},
            [
              ["Which strategy or policy was selected", "Not exposed — no field for this."],
              [
                "Why a provider was chosen (reasoning)",
                "Not exposed — only the outcome: execution.providerId.",
              ],
              [
                "The full routing decision/plan",
                "Not exposed — only the final providerId + modelClass.",
              ],
              [
                "Retry decisions (why/when)",
                "Partial — execution.retries is a count, not a per-attempt reason.",
              ],
              [
                "Fallback/failover decisions",
                "Partial — execution.failedOver is a boolean, not which candidates were tried.",
              ],
            ].map(([expect, actual]) =>
              h("tr", {}, [
                h(
                  "td",
                  {
                    style:
                      "padding:6px; border-bottom:1px solid var(--border-soft); color:var(--text-dim)",
                  },
                  expect,
                ),
                h(
                  "td",
                  { style: "padding:6px; border-bottom:1px solid var(--border-soft)" },
                  actual,
                ),
              ]),
            ),
          ),
        ]),
      ]),
    );

    root.append(
      h("div", { class: "card" }, [
        h("div", { class: "card-title" }, "Send a probe request"),
        h(
          "p",
          {},
          "Useful for seeing what a real request against your target deployment returns — not for determining whether Strategy Layer specifically was involved, since the response can't attribute the outcome to it.",
        ),
        h("div", { class: "field" }, [
          h("label", {}, "Tenant · organizationId"),
          h("input", {
            type: "text",
            value: state.organizationId,
            onInput: (e) => (state.organizationId = e.target.value),
          }),
        ]),
        h("div", { class: "btn-row" }, [
          h(
            "button",
            { class: "btn", disabled: state.running || undefined, onClick: run },
            state.running ? "Running…" : "Send probe",
          ),
        ]),
      ]),
    );

    if (state.result) {
      const result = state.result;
      const card = h("div", { class: "card" }, [h("div", { class: "card-title" }, "Result")]);
      if (result.ok) {
        card.append(
          h("div", { class: "metrics" }, [
            metric("Provider", result.body.execution.providerId),
            metric("Model class", result.body.execution.modelClass),
            metric("Latency", formatMs(result.body.execution.latencyMs)),
            metric("Retries", result.body.execution.retries),
            metric("Failed over", result.body.execution.failedOver ? "yes" : "no"),
          ]),
        );
      } else {
        card.append(
          notice(
            [
              badge(result.body?.error?.code ?? "error", "danger"),
              ` ${result.body?.error?.message ?? ""}`,
            ],
            "danger",
          ),
        );
      }
      card.append(jsonBlock(result.body));
      root.append(card);
    }
  }

  render();
}
