import {
  h,
  panelHeader,
  jsonBlock,
  badge,
  loadHistory,
  clearHistory,
  apiExecute,
  apiPipeline,
  pushHistory,
  formatCost,
  formatMs,
} from "../shared.js";

export function renderHistory(root) {
  const state = { compareIds: [] };

  function toggleCompare(id) {
    if (state.compareIds.includes(id)) {
      state.compareIds = state.compareIds.filter((x) => x !== id);
    } else if (state.compareIds.length < 2) {
      state.compareIds = [...state.compareIds, id];
    } else {
      state.compareIds = [state.compareIds[1], id];
    }
    render();
  }

  async function replay(entry) {
    if (entry.panel === "pipeline") {
      const result = await apiPipeline(entry.request);
      pushHistory({
        panel: "pipeline",
        summary: `replay of ${entry.id.slice(0, 8)}`,
        request: entry.request,
        response: result.body,
        status: result.status,
        ok: result.ok,
      });
    } else {
      const result = await apiExecute(entry.request);
      pushHistory({
        panel: entry.panel,
        summary: `replay of ${entry.id.slice(0, 8)}`,
        request: entry.request,
        response: result.body,
        status: result.status,
        ok: result.ok,
      });
    }
    render();
  }

  function exportHistory() {
    const blob = new Blob([JSON.stringify(loadHistory(), null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = h("a", { href: url, download: `runtime-studio-history-${Date.now()}.json` });
    document.body.append(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  function render() {
    root.replaceChildren();
    root.append(
      panelHeader(
        "Request History",
        "Every request this Studio has sent from Execute, Streaming, or Pipeline, most recent first — kept in this browser's local storage only (never sent anywhere else, never shared across browsers or devices).",
        "Comparing two runs of the same request (e.g. before/after a config change on your gateway), or replaying one exactly as it was sent.",
      ),
    );

    const history = loadHistory();

    root.append(
      h("div", { class: "btn-row", style: "margin-bottom: 16px" }, [
        h(
          "button",
          {
            class: "btn btn--secondary",
            disabled: history.length === 0 || undefined,
            onClick: exportHistory,
          },
          "Export as JSON",
        ),
        h(
          "button",
          {
            class: "btn btn--danger",
            disabled: history.length === 0 || undefined,
            onClick: () => {
              clearHistory();
              render();
            },
          },
          "Clear history",
        ),
        state.compareIds.length === 2
          ? h("span", { class: "field-hint" }, "2 selected for compare — see below")
          : null,
      ]),
    );

    if (history.length === 0) {
      root.append(
        h("div", { class: "card" }, [h("div", { class: "empty-state" }, "No requests yet.")]),
      );
      return;
    }

    if (state.compareIds.length === 2) {
      const [a, b] = state.compareIds.map((id) => history.find((h) => h.id === id)).filter(Boolean);
      if (a && b) {
        root.append(
          h("div", { class: "card" }, [
            h("div", { class: "card-title" }, "Compare"),
            h("div", { class: "row" }, [
              h("div", {}, [
                h(
                  "div",
                  { class: "field-hint" },
                  `${a.panel} · ${new Date(a.at).toLocaleString()}`,
                ),
                jsonBlock({ request: a.request, response: a.response }),
              ]),
              h("div", {}, [
                h(
                  "div",
                  { class: "field-hint" },
                  `${b.panel} · ${new Date(b.at).toLocaleString()}`,
                ),
                jsonBlock({ request: b.request, response: b.response }),
              ]),
            ]),
          ]),
        );
      }
    }

    const listCard = h("div", { class: "card" }, [
      h("div", { class: "card-title" }, `All requests (${history.length})`),
    ]);
    for (const entry of history) {
      listCard.append(
        h("div", { class: "history-row" }, [
          h("div", {}, [
            h("input", {
              type: "checkbox",
              checked: state.compareIds.includes(entry.id) || undefined,
              onChange: () => toggleCompare(entry.id),
            }),
            " ",
            badge(entry.panel, "info"),
            " ",
            entry.ok ? badge("ok", "ok") : badge("error", "danger"),
            " ",
            entry.summary,
          ]),
          h("div", { class: "history-meta" }, [
            new Date(entry.at).toLocaleTimeString(),
            h("button", { class: "btn btn--secondary", onClick: () => replay(entry) }, "Replay"),
          ]),
        ]),
      );
    }
    root.append(listCard);
  }

  window.addEventListener("studio:history-changed", render);
  render();
}
