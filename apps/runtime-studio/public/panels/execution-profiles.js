import { h, panelHeader, jsonBlock, notice, metric, badge, apiExecute, pushHistory, formatMs } from "../shared.js";

export function renderExecutionProfiles(root) {
  const state = {
    organizationId: "example-org",
    profileId: "",
    running: false,
    result: null,
  };

  async function run() {
    state.running = true;
    render();
    const request = {
      task: "summarization",
      input: { text: "A short test request used only to exercise an Execution Profile override." },
      tenant: { organizationId: state.organizationId.trim() },
      preferences: state.profileId.trim() ? { executionProfileOverride: state.profileId.trim() } : undefined,
    };
    const result = await apiExecute(request);
    state.running = false;
    state.result = { request, ...result };
    pushHistory({
      panel: "execution-profiles",
      summary: `override "${state.profileId || "(none)"}" → ${result.ok ? result.body.execution.providerId : result.body?.error?.code ?? "error"}`,
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
        "Execution Profiles",
        "An Execution Profile is a per-task-type set of inference parameters, retry behavior, and streaming/caching defaults — resolved automatically per task, or overridden per request via preferences.executionProfileOverride (architecture §31.1).",
        "You want a specific task to consistently use different inference parameters or retry behavior than its default profile, without hardcoding a model or provider.",
      ),
    );

    root.append(
      notice(
        [
          h("strong", {}, "Two things worth knowing before you test this: "),
          h("br"),
          "1) ", h("code", {}, "executionProfileOverride"), " only has an effect if the target gateway has ",
          h("code", {}, "ENABLE_STRATEGY_LAYER=true"), " — it's read exclusively by the Strategy Layer's resolution stage; ",
          h("code", {}, "orchestrator"), " and ", h("code", {}, "policy-engine"), " never consume it directly, with or without the flag.", h("br"),
          "2) An unresolvable profile ID fails the request (a real error, not a silent fallback to the default profile) — and ",
          h("code", {}, "ExecuteResponse"), " has no field reporting which Execution Profile was actually applied, so what you'll see below is the outcome (provider, model class, retry/timeout behavior), not a literal “effective profile” readout — the API doesn't expose one.",
        ],
        "info",
      ),
    );

    root.append(
      h("div", { class: "card" }, [
        h("div", { class: "card-title" }, "Test an override"),
        h("div", { class: "row" }, [
          h("div", { class: "field" }, [
            h("label", {}, "Tenant · organizationId"),
            h("input", { type: "text", value: state.organizationId, onInput: (e) => (state.organizationId = e.target.value) }),
          ]),
          h("div", { class: "field" }, [
            h("label", {}, "preferences.executionProfileOverride"),
            h("input", { type: "text", placeholder: "leave blank to use the default, task-driven resolution", value: state.profileId, onInput: (e) => (state.profileId = e.target.value) }),
          ]),
        ]),
        h("div", { class: "btn-row" }, [
          h("button", { class: "btn", disabled: state.running || undefined, onClick: run }, state.running ? "Running…" : "Run test request"),
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
          ]),
        );
      } else {
        card.append(
          notice(
            [
              badge(result.body?.error?.code ?? "error", "danger"),
              ` ${result.body?.error?.message ?? ""}`,
              state.profileId ? " — likely means that profile ID isn't registered on the target deployment, or Strategy Layer isn't enabled there." : "",
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
