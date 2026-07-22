import {
  h,
  panelHeader,
  jsonBlock,
  notice,
  metric,
  badge,
  taskSelect,
  apiPipeline,
  pushHistory,
  formatCost,
  formatMs,
} from "../shared.js";

let stepCounter = 0;
function newStep(task) {
  stepCounter += 1;
  return {
    id: `step-${stepCounter}`,
    task: task ?? "summarization",
    customTask: "",
    mode: "literal",
    text: "",
    inputFrom: "",
    required: true,
  };
}

export function renderPipeline(root) {
  const state = {
    organizationId: "example-org",
    steps: [newStep("summarization"), newStep("complex_reasoning")],
    running: false,
    result: null,
  };
  // Seed a realistic default so the panel is useful without editing —
  // mirrors examples/pipeline-client's own 2-step example.
  state.steps[0].text =
    "AI Gateway routes requests by task type, retries transient failures, and fails over across providers automatically.";
  state.steps[1].mode = "inputFrom";
  state.steps[1].inputFrom = state.steps[0].id;

  function buildRequest() {
    return {
      id: `pipeline-studio-${Date.now()}`,
      tenant: { organizationId: state.organizationId.trim() },
      steps: state.steps.map((s) => {
        const task = s.task === "__custom__" ? s.customTask.trim() : s.task;
        const step = { id: s.id, task, required: s.required };
        if (s.mode === "inputFrom" && s.inputFrom) step.inputFrom = s.inputFrom;
        else step.input = { text: s.text };
        return step;
      }),
    };
  }

  async function run() {
    state.running = true;
    render();
    const request = buildRequest();
    const result = await apiPipeline(request);
    state.running = false;
    state.result = { request, ...result };

    pushHistory({
      panel: "pipeline",
      summary: result.ok
        ? `${request.steps.length} steps → $${(result.body.totalCostUsd ?? 0).toFixed(4)}, ${result.body.durationMs}ms`
        : `pipeline failed (${result.body?.error?.code ?? result.status})`,
      request,
      response: result.body,
      status: result.status,
      ok: result.ok,
    });
    render();
  }

  function addStep() {
    state.steps.push(newStep());
    render();
  }
  function removeStep(id) {
    state.steps = state.steps.filter((s) => s.id !== id);
    render();
  }

  function render() {
    root.replaceChildren();
    root.append(
      panelHeader(
        "Pipeline",
        "Builds a request for POST /v1/execute/pipeline (v1.2, EM-10): a sequence of steps, each running through the exact same ExecutionOrchestrator.execute() a single Execute call uses — not a second execution engine. A step's input is either literal text or a prior step's output (inputFrom).",
        "Chaining several calls (e.g. summarize → translate → extract action items) without round-tripping through your own backend between steps.",
      ),
    );

    const stepsCard = h("div", { class: "card" }, [
      h("div", { class: "card-title" }, "Steps"),
      h("div", { class: "field" }, [
        h("label", {}, "Tenant · organizationId"),
        h("input", {
          type: "text",
          value: state.organizationId,
          onInput: (e) => (state.organizationId = e.target.value),
        }),
      ]),
      h(
        "div",
        { class: "pipeline-steps" },
        state.steps.flatMap((step, i) => {
          const priorIds = state.steps.slice(0, i).map((s) => s.id);
          const stepEl = h("div", { class: "pipeline-step" }, [
            h("div", { class: "pipeline-step-head" }, [
              h("strong", {}, step.id),
              h(
                "button",
                {
                  class: "btn btn--secondary",
                  disabled: state.steps.length <= 1 || undefined,
                  onClick: () => removeStep(step.id),
                },
                "Remove",
              ),
            ]),
            h("div", { class: "row" }, [
              (() => {
                const field = h("div", { class: "field" }, [
                  h("label", {}, "Task"),
                  taskSelect(step.task, (v) => {
                    step.task = v;
                    render();
                  }),
                ]);
                if (step.task === "__custom__") {
                  field.append(
                    h("input", {
                      type: "text",
                      value: step.customTask,
                      onInput: (e) => (step.customTask = e.target.value),
                    }),
                  );
                }
                return field;
              })(),
              h("div", { class: "field" }, [
                h("label", {}, "Required"),
                h("select", { onChange: (e) => (step.required = e.target.value === "true") }, [
                  h(
                    "option",
                    { value: "true", selected: step.required || undefined },
                    "true (default) — pipeline stops if this step fails",
                  ),
                  h(
                    "option",
                    { value: "false", selected: !step.required || undefined },
                    "false — pipeline continues if this step fails",
                  ),
                ]),
              ]),
            ]),
            h("div", { class: "field" }, [
              h("label", {}, "Input source"),
              h(
                "select",
                {
                  onChange: (e) => {
                    step.mode = e.target.value;
                    render();
                  },
                },
                [
                  h(
                    "option",
                    { value: "literal", selected: step.mode === "literal" || undefined },
                    "literal text",
                  ),
                  h(
                    "option",
                    {
                      value: "inputFrom",
                      selected: step.mode === "inputFrom" || undefined,
                      disabled: priorIds.length === 0 || undefined,
                    },
                    "output of a prior step (inputFrom)",
                  ),
                ],
              ),
            ]),
            step.mode === "literal"
              ? h("div", { class: "field" }, [
                  h("textarea", { onInput: (e) => (step.text = e.target.value) }, step.text),
                ])
              : h("div", { class: "field" }, [
                  h(
                    "select",
                    { onChange: (e) => (step.inputFrom = e.target.value) },
                    priorIds.length === 0
                      ? [h("option", {}, "no prior steps available")]
                      : priorIds.map((id) =>
                          h(
                            "option",
                            { value: id, selected: id === step.inputFrom || undefined },
                            id,
                          ),
                        ),
                  ),
                ]),
          ]);
          return i < state.steps.length - 1
            ? [stepEl, h("div", { class: "pipeline-arrow" }, "↓")]
            : [stepEl];
        }),
      ),
      h("div", { class: "btn-row" }, [
        h("button", { class: "btn btn--secondary", onClick: addStep }, "+ Add step"),
        h(
          "button",
          { class: "btn", disabled: state.running || undefined, onClick: run },
          state.running ? "Running…" : "Execute pipeline",
        ),
      ]),
    ]);
    root.append(stepsCard);

    if (state.result) root.append(renderResult(state.result));
  }

  function renderResult(result) {
    const card = h("div", { class: "card" }, [h("div", { class: "card-title" }, "Result")]);

    if (!result.ok) {
      card.append(
        notice(
          [
            h("strong", {}, `HTTP ${result.status}`),
            ` — ${result.body?.error?.code ?? "request failed"}: ${result.body?.error?.message ?? ""}`,
          ],
          "danger",
        ),
      );
      card.append(jsonBlock(result.body));
      return card;
    }

    const body = result.body;
    card.append(
      h("div", { class: "metrics" }, [
        metric("Total cost", formatCost(body.totalCostUsd)),
        metric("Duration", formatMs(body.durationMs)),
        metric("Steps run", Object.keys(body.stepResults).length),
      ]),
    );

    for (const step of state.result.request.steps) {
      const stepResult = body.stepResults[step.id];
      if (!stepResult) {
        card.append(
          h("div", { class: "pipeline-step" }, [
            h("div", { class: "pipeline-step-head" }, [
              h("strong", {}, step.id),
              badge("not reached", "warn"),
            ]),
            h(
              "div",
              { class: "field-hint" },
              "An earlier required step failed, so this step never ran — it has no entry in stepResults at all.",
            ),
          ]),
        );
        continue;
      }
      const failed = "code" in stepResult; // flat GatewayError.toJSON() vs. ExecuteResponse — see apps/gateway-server/README.md
      card.append(
        h("div", { class: "pipeline-step" }, [
          h("div", { class: "pipeline-step-head" }, [
            h("strong", {}, step.id),
            failed
              ? badge(stepResult.code, "danger")
              : badge(stepResult.execution.providerId, "ok"),
          ]),
          failed
            ? h("div", {}, `${stepResult.message} (retryable: ${stepResult.retryable})`)
            : h(
                "div",
                { class: "output-text" },
                stepResult.output.text ?? JSON.stringify(stepResult.output.json ?? ""),
              ),
        ]),
      );
    }

    card.append(
      h("div", { class: "row" }, [
        h("div", {}, [
          h("div", { class: "field-hint" }, "Request JSON"),
          jsonBlock(result.request),
        ]),
        h("div", {}, [
          h(
            "div",
            { class: "field-hint" },
            `Response JSON (status ${result.status}, ${result.wallClockMs}ms wall clock)`,
          ),
          jsonBlock(body),
        ]),
      ]),
    );

    return card;
  }

  render();
}
