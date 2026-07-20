import { h, panelHeader, jsonBlock, notice, metric, taskSelect, apiExecuteStream, pushHistory, formatMs } from "../shared.js";

export function renderStreaming(root) {
  const state = {
    organizationId: "example-org",
    task: "creative_writing",
    customTask: "",
    text: "Write two sentences about how retries and failover work in a request-routing gateway.",
    running: false,
    chunks: [],
    outputText: "",
    finishReason: null,
    error: null,
    controller: null,
    startedAt: null,
    finishedAt: null,
  };

  function buildRequest() {
    const task = state.task === "__custom__" ? state.customTask.trim() : state.task;
    return {
      task,
      input: { text: state.text },
      tenant: { organizationId: state.organizationId.trim() },
    };
  }

  function run() {
    state.running = true;
    state.chunks = [];
    state.outputText = "";
    state.finishReason = null;
    state.error = null;
    state.startedAt = performance.now();
    state.finishedAt = null;
    render();

    const request = buildRequest();

    state.controller = apiExecuteStream(
      request,
      (chunk) => {
        state.chunks.push(chunk);
        if (chunk.delta?.text) state.outputText += chunk.delta.text;
        if (chunk.done) state.finishReason = chunk.finishReason ?? null;
        render();
      },
      (error) => {
        state.running = false;
        state.error = error;
        state.finishedAt = performance.now();
        pushHistory({
          panel: "streaming",
          summary: `${request.task} → stream error (${error.code ?? "?"})`,
          request,
          response: { chunks: state.chunks, error },
          ok: false,
        });
        render();
      },
      () => {
        state.running = false;
        state.finishedAt = performance.now();
        pushHistory({
          panel: "streaming",
          summary: `${request.task} → ${state.chunks.length} chunks, finishReason=${state.finishReason ?? "?"}`,
          request,
          response: { chunks: state.chunks },
          ok: true,
        });
        render();
      },
    );
  }

  function cancel() {
    state.controller?.abort();
    state.running = false;
    state.finishedAt = performance.now();
    render();
  }

  function render() {
    root.replaceChildren();

    root.append(
      panelHeader(
        "Streaming",
        "Sends one request to POST /v1/execute/stream and reads the Server-Sent-Events response incrementally, exactly as examples/streaming-client does — the same data: {json}\\n\\n frame parsing, running in the browser instead of Node.",
        "Long-form generation where showing partial output as it's produced matters more than a single final response.",
      ),
    );

    root.append(
      notice(
        [
          h("strong", {}, "About “reconnect”: "),
          "there is no resumable-stream protocol in RuntimeOS today — a `StreamChunk` carries no cursor/offset a client could use to resume mid-stream after a disconnect. What this panel offers instead is honest: Cancel aborts the in-flight request, and running again starts a brand-new one from the beginning.",
        ],
        "info",
      ),
    );

    const taskField = h("div", { class: "field" }, [
      h("label", {}, "Task"),
      taskSelect(state.task, (v) => { state.task = v; render(); }),
    ]);
    if (state.task === "__custom__") {
      taskField.append(h("input", { type: "text", value: state.customTask, onInput: (e) => (state.customTask = e.target.value) }));
    }

    root.append(
      h("div", { class: "card" }, [
        h("div", { class: "card-title" }, "Request"),
        h("div", { class: "row" }, [
          h("div", { class: "field" }, [
            h("label", {}, "Tenant · organizationId"),
            h("input", { type: "text", value: state.organizationId, onInput: (e) => (state.organizationId = e.target.value) }),
          ]),
          taskField,
        ]),
        h("div", { class: "field" }, [
          h("label", {}, "Input · text"),
          h("textarea", { onInput: (e) => (state.text = e.target.value) }, state.text),
        ]),
        h("div", { class: "btn-row" }, [
          h("button", { class: "btn", disabled: state.running || undefined, onClick: run }, state.running ? "Streaming…" : "Start streaming"),
          h("button", { class: "btn btn--secondary", disabled: !state.running, onClick: cancel }, "Cancel"),
        ]),
      ]),
    );

    if (state.chunks.length > 0 || state.error) {
      const card = h("div", { class: "card" }, [h("div", { class: "card-title" }, "Result")]);

      if (state.error) {
        card.append(notice([h("strong", {}, state.error.code ?? "Error"), ` — ${state.error.message ?? "stream failed"}`], "danger"));
      }

      card.append(
        h("div", { class: "metrics" }, [
          metric("Chunks received", state.chunks.length),
          metric("Finish reason", state.finishReason ?? (state.running ? "streaming…" : "—")),
          metric(
            "Elapsed",
            state.startedAt ? formatMs(Math.round((state.finishedAt ?? performance.now()) - state.startedAt)) : "—",
          ),
        ]),
        h("div", { class: "field" }, [h("label", {}, "Incremental output"), h("div", { class: "output-text" }, state.outputText || "…")]),
        h("div", { class: "field" }, [h("label", {}, `Raw chunks (${state.chunks.length})`), jsonBlock(state.chunks)]),
      );
      root.append(card);
    }
  }

  render();
}
