// Shared helpers used by every panel. No framework, no build step — this
// runs directly in the browser as an ES module, exactly like the rest of
// this repository's `examples/*` prefer plain fetch over a client
// library. Kept in one file (rather than split further) because these
// are genuinely cross-cutting: every panel needs DOM construction, every
// panel that calls the gateway needs the same API client, and history
// is read/written from several panels.

/** Tiny DOM-construction helper: h("div", {class: "x"}, [child, ...]) */
export function h(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (key === "class") node.className = value;
    else if (key === "html") node.innerHTML = value;
    else if (key.startsWith("on") && typeof value === "function") {
      node.addEventListener(key.slice(2).toLowerCase(), value);
    } else if (value !== undefined && value !== null && value !== false) {
      node.setAttribute(key, value === true ? "" : String(value));
    }
  }
  for (const child of Array.isArray(children) ? children : [children]) {
    if (child === null || child === undefined || child === false) continue;
    node.append(typeof child === "string" ? document.createTextNode(child) : child);
  }
  return node;
}

export function clear(node) {
  node.replaceChildren();
}

export function panelHeader(title, blurb, when) {
  return h("div", { class: "panel-header" }, [
    h("h1", { class: "panel-title" }, title),
    h("p", { class: "panel-blurb" }, [
      blurb,
      when ? h("span", { class: "blurb-when" }, `When to use it: ${when}`) : null,
    ]),
  ]);
}

export function jsonBlock(value) {
  return h("pre", { class: "json" }, JSON.stringify(value, null, 2));
}

export function badge(text, kind) {
  return h("span", { class: `badge${kind ? ` badge--${kind}` : ""}` }, text);
}

export function notice(children, kind) {
  return h("div", { class: `notice${kind ? ` notice--${kind}` : ""}` }, children);
}

export function metric(label, value) {
  return h("div", { class: "metric" }, [
    h("div", { class: "metric-label" }, label),
    h("div", { class: "metric-value" }, String(value)),
  ]);
}

// --- The shared "who is this request for / what should it do" fields,
// reused by Execute, Streaming, and each Pipeline step. Real
// ExecuteRequest fields only — see core-contracts' request.ts. No field
// invented here that the API doesn't actually accept.
export const KNOWN_TASK_TYPES = [
  "knowledge_extraction",
  "entity_extraction",
  "classification",
  "summarization",
  "json_generation",
  "creative_writing",
  "complex_reasoning",
  "marketing_content",
  "code_generation",
];

export function taskSelect(value, onChange) {
  const select = h(
    "select",
    { onChange: (e) => onChange(e.target.value) },
    KNOWN_TASK_TYPES.map((t) => h("option", { value: t, selected: t === value || undefined }, t)),
  );
  // KNOWN_TASK_TYPES is not exhaustive — core-contracts' TaskType also
  // accepts any custom, config-registered string. Offer the known ones
  // as a convenience, but don't pretend they're the only valid values.
  select.append(h("option", { value: "__custom__" }, "custom task type…"));
  return select;
}

// --- API client. Every call goes through this Studio's own
// /studio-api/* proxy (see src/proxy.ts) — never a hardcoded response,
// never bypassing the real gateway.

async function studioFetch(path, options) {
  const res = await fetch(path, options);
  const text = await res.text();
  let body;
  try {
    body = text ? JSON.parse(text) : undefined;
  } catch {
    body = text;
  }
  return {
    status: res.status,
    ok: res.ok,
    headers: Object.fromEntries(res.headers.entries()),
    body,
  };
}

export function apiExecute(request) {
  const startedAt = performance.now();
  return studioFetch("/studio-api/execute", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(request),
  }).then((result) => ({ ...result, wallClockMs: Math.round(performance.now() - startedAt) }));
}

export function apiPipeline(request) {
  const startedAt = performance.now();
  return studioFetch("/studio-api/execute/pipeline", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(request),
  }).then((result) => ({ ...result, wallClockMs: Math.round(performance.now() - startedAt) }));
}

export function apiHealth() {
  return studioFetch("/studio-api/health");
}

export function apiMeta() {
  return studioFetch("/studio-api/meta");
}

/**
 * Streams `/studio-api/execute/stream`, calling `onChunk(StreamChunk)` for
 * each SSE frame as it arrives. Parsing logic is deliberately identical
 * to `examples/streaming-client/src/index.mjs`'s Node implementation —
 * same `data: {json}\n\n` wire format, same buffer/boundary approach,
 * just using the browser's `fetch` + `ReadableStream` instead of Node's.
 * Returns an AbortController the caller can use to cancel.
 */
export function apiExecuteStream(request, onChunk, onError, onDone) {
  const controller = new AbortController();

  (async () => {
    let response;
    try {
      response = await fetch("/studio-api/execute/stream", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(request),
        signal: controller.signal,
      });
    } catch (error) {
      if (controller.signal.aborted) return;
      onError({ code: "STUDIO_FETCH_FAILED", message: String(error) });
      return;
    }

    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      onError(body.error ?? { code: "UNKNOWN", message: `HTTP ${response.status}` });
      return;
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    for (;;) {
      let read;
      try {
        read = await reader.read();
      } catch {
        if (controller.signal.aborted) return;
        throw new Error("stream read failed");
      }
      if (read.done) break;
      buffer += decoder.decode(read.value, { stream: true });

      let boundary;
      while ((boundary = buffer.indexOf("\n\n")) !== -1) {
        const frame = buffer.slice(0, boundary).trim();
        buffer = buffer.slice(boundary + 2);
        if (!frame.startsWith("data:")) continue;

        let payload;
        try {
          payload = JSON.parse(frame.slice("data:".length).trim());
        } catch {
          continue;
        }

        if (payload.error) {
          onError(payload.error);
          return;
        }
        onChunk(payload);
      }
    }
    onDone();
  })();

  return controller;
}

// --- Request history. Persisted to localStorage — this is a real
// browser application (not a claude.ai artifact sandbox), so
// localStorage is the appropriate, ordinary choice here, not a
// restricted one.
const HISTORY_KEY = "runtime-studio:history";
const HISTORY_LIMIT = 50;

export function loadHistory() {
  try {
    const raw = localStorage.getItem(HISTORY_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

export function pushHistory(entry) {
  const history = loadHistory();
  history.unshift({ ...entry, id: crypto.randomUUID(), at: new Date().toISOString() });
  localStorage.setItem(HISTORY_KEY, JSON.stringify(history.slice(0, HISTORY_LIMIT)));
  window.dispatchEvent(new CustomEvent("studio:history-changed"));
  return history[0];
}

export function clearHistory() {
  localStorage.removeItem(HISTORY_KEY);
  window.dispatchEvent(new CustomEvent("studio:history-changed"));
}

export function formatCost(usd) {
  if (usd === undefined || usd === null) return "—";
  return `$${usd.toFixed(4)}`;
}

export function formatMs(ms) {
  if (ms === undefined || ms === null) return "—";
  return `${ms}ms`;
}
