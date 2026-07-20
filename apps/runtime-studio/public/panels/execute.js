import { h, panelHeader, jsonBlock, badge, notice, metric, taskSelect, apiExecute, pushHistory, formatCost, formatMs } from "../shared.js";

export function renderExecute(root) {
  const state = {
    organizationId: "example-org",
    task: "summarization",
    customTask: "",
    text: "Summarize the key benefits of automatic provider failover in one paragraph.",
    maxLatencyMs: "",
    maxCostUsd: "",
    creativity: "",
    prioritize: "",
    executionProfileOverride: "",
    running: false,
    result: null,
    error: null,
  };

  function buildRequest() {
    const task = state.task === "__custom__" ? state.customTask.trim() : state.task;
    const request = {
      task,
      input: { text: state.text },
      tenant: { organizationId: state.organizationId.trim() },
    };
    const constraints = {};
    if (state.maxLatencyMs) constraints.maxLatencyMs = Number(state.maxLatencyMs);
    if (state.maxCostUsd) constraints.maxCostUsd = Number(state.maxCostUsd);
    if (Object.keys(constraints).length) request.constraints = constraints;

    const preferences = {};
    if (state.creativity) preferences.creativity = state.creativity;
    if (state.prioritize) preferences.prioritize = state.prioritize;
    if (state.executionProfileOverride.trim()) {
      preferences.executionProfileOverride = state.executionProfileOverride.trim();
    }
    if (Object.keys(preferences).length) request.preferences = preferences;

    return request;
  }

  async function run() {
    state.running = true;
    state.error = null;
    render();

    const request = buildRequest();
    const result = await apiExecute(request);
    state.running = false;

    if (result.ok) {
      state.result = { request, ...result };
      pushHistory({
        panel: "execute",
        summary: `${request.task} → ${result.body?.execution?.providerId ?? "?"}`,
        request,
        response: result.body,
        status: result.status,
        latencyMs: result.body?.execution?.latencyMs,
        costUsd: result.body?.usage?.estimatedCostUsd,
        ok: true,
      });
    } else {
      state.result = { request, ...result };
      pushHistory({
        panel: "execute",
        summary: `${request.task} → ${result.body?.error?.code ?? "error"}`,
        request,
        response: result.body,
        status: result.status,
        ok: false,
      });
    }
    render();
  }

  function render() {
    root.replaceChildren();

    root.append(
      panelHeader(
        "Execute",
        "Sends one request to POST /v1/execute — the gateway's core, single-step call: describe a task, get one response back, with automatic provider selection, retry, and failover.",
        "Any single request/response call — this is the endpoint almost every RuntimeOS integration starts with.",
      ),
    );

    const taskField = h("div", { class: "field" }, [
      h("label", {}, "Task"),
      taskSelect(state.task, (v) => {
        state.task = v;
        render();
      }),
      h("div", { class: "field-hint" }, "A known task type, or pick “custom task type…” to type your own — TaskType accepts any config-registered string, not just the known list."),
    ]);
    if (state.task === "__custom__") {
      taskField.append(
        h("input", {
          type: "text",
          placeholder: "e.g. sentiment_analysis",
          value: state.customTask,
          onInput: (e) => (state.customTask = e.target.value),
        }),
      );
    }

    const form = h("div", { class: "card" }, [
      h("div", { class: "card-title" }, "Request"),
      h("div", { class: "row" }, [
        h("div", { class: "field" }, [
          h("label", {}, "Tenant · organizationId"),
          h("input", {
            type: "text",
            value: state.organizationId,
            onInput: (e) => (state.organizationId = e.target.value),
          }),
        ]),
        taskField,
      ]),
      h("div", { class: "field" }, [
        h("label", {}, "Input · text"),
        h("textarea", {
          onInput: (e) => (state.text = e.target.value),
        }, state.text),
      ]),
      h("div", { class: "row" }, [
        h("div", { class: "field" }, [
          h("label", {}, "Constraints · maxLatencyMs (optional)"),
          h("input", { type: "number", value: state.maxLatencyMs, onInput: (e) => (state.maxLatencyMs = e.target.value) }),
        ]),
        h("div", { class: "field" }, [
          h("label", {}, "Constraints · maxCostUsd (optional)"),
          h("input", { type: "number", step: "0.001", value: state.maxCostUsd, onInput: (e) => (state.maxCostUsd = e.target.value) }),
        ]),
      ]),
      h("div", { class: "row" }, [
        h("div", { class: "field" }, [
          h("label", {}, "Preferences · creativity (optional)"),
          h("select", { onChange: (e) => (state.creativity = e.target.value) }, [
            h("option", { value: "" }, "unset"),
            h("option", { value: "low" }, "low"),
            h("option", { value: "medium" }, "medium"),
            h("option", { value: "high" }, "high"),
          ]),
        ]),
        h("div", { class: "field" }, [
          h("label", {}, "Preferences · prioritize (optional)"),
          h("select", { onChange: (e) => (state.prioritize = e.target.value) }, [
            h("option", { value: "" }, "unset"),
            h("option", { value: "cost" }, "cost"),
            h("option", { value: "latency" }, "latency"),
            h("option", { value: "quality" }, "quality"),
          ]),
        ]),
      ]),
      h("div", { class: "field" }, [
        h("label", {}, "Preferences · executionProfileOverride (optional)"),
        h("input", {
          type: "text",
          placeholder: "an Execution Profile ID — see the Execution Profiles panel",
          value: state.executionProfileOverride,
          onInput: (e) => (state.executionProfileOverride = e.target.value),
        }),
        h("div", { class: "field-hint" }, "Advanced, v1.1+. Only takes effect if the target gateway has ENABLE_STRATEGY_LAYER=true — the Strategy Layer's own resolution stage is the only thing that reads this field (orchestrator and policy-engine never consume it directly). An unresolvable profile ID fails the request rather than silently falling back. See the Execution Profiles panel."),
      ]),
      h("div", { class: "btn-row" }, [
        h("button", { class: "btn", disabled: state.running || undefined, onClick: run }, state.running ? "Running…" : "Execute"),
      ]),
    ]);
    root.append(form);

    if (state.result) {
      root.append(renderResult(state.result));
    }
  }

  function renderResult(result) {
    const card = h("div", { class: "card" }, [h("div", { class: "card-title" }, "Result")]);

    if (result.ok) {
      const body = result.body;
      card.append(
        h("div", { class: "metrics" }, [
          metric("Provider", body.execution.providerId),
          metric("Model class", body.execution.modelClass),
          metric("Latency", formatMs(body.execution.latencyMs)),
          metric("Retries", body.execution.retries),
          metric("Failed over", body.execution.failedOver ? "yes" : "no"),
          metric("Finish reason", body.finishReason),
          metric("Cost", formatCost(body.usage.estimatedCostUsd)),
          metric("Tokens (in/out)", `${body.usage.inputTokens}/${body.usage.outputTokens}`),
        ]),
        h("div", { class: "field" }, [
          h("label", {}, "Output"),
          h("div", { class: "output-text" }, body.output.text ?? JSON.stringify(body.output.json ?? body.output.toolCalls ?? "")),
        ]),
      );
    } else {
      const err = result.body?.error;
      card.append(
        notice(
          [
            h("strong", {}, `HTTP ${result.status}`),
            err ? ` — ${err.code}: ${err.message} (retryable: ${err.retryable})` : " — request failed",
          ],
          "danger",
        ),
      );
    }

    card.append(
      h("div", { class: "tabs" }, [
        h("span", { class: "tab active" }, "Raw request/response — see below"),
      ]),
      h("div", { class: "row" }, [
        h("div", {}, [h("div", { class: "field-hint" }, "Request JSON"), jsonBlock(result.request)]),
        h("div", {}, [h("div", { class: "field-hint" }, `Response JSON (status ${result.status}, ${result.wallClockMs}ms wall clock)`), jsonBlock(result.body)]),
      ]),
    );

    return card;
  }

  render();
}
