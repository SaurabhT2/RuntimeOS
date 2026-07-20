import { h, panelHeader, notice, badge } from "../shared.js";

export function renderRuntimeProfiles(root) {
  root.replaceChildren();

  root.append(
    panelHeader(
      "Runtime Profiles",
      "A Runtime Profile is a deployment- or tenant-wide behavior overlay — provider preference, cost posture, telemetry verbosity, caching defaults. It is configured once for a whole running gateway (GatewayConfig.runtimeProfileId, set via a GATEWAY_CONFIG_PATH JSON file), not chosen by an individual caller.",
      "You're an operator deciding how a whole deployment should behave — not something an application sends per request.",
    ),
  );

  root.append(
    notice(
      [
        h("strong", {}, "This panel is informational, not interactive — by design. "),
        "There is no field on ExecuteRequest for a Runtime Profile, and no API endpoint that reports which one a running gateway currently has active. This Studio proxies the public HTTP API only, and the public API genuinely has no surface for this — showing a dropdown here that appeared to “select” a Runtime Profile would be simulating a control that doesn't exist. See ",
        h("code", {}, "docs/release/RUNTIME_CONFIGURATION_MATRIX.md"),
        " in the RuntimeOS repository for the full picture of what's configurable where.",
      ],
      "info",
    ),
  );

  root.append(
    h("div", { class: "card" }, [
      h("div", { class: "card-title" }, "How it's actually configured"),
      h("p", {}, [
        "An operator sets ", h("code", {}, "runtimeProfileId"), " in a JSON file at the path named by the ",
        h("code", {}, "GATEWAY_CONFIG_PATH"), " environment variable, on the deployment itself — ",
        "identical mechanism on both ", h("code", {}, "apps/gateway-server"), " and ", h("code", {}, "apps/vercel-adapter"), ". ",
        "Neither app exposes a dedicated environment variable shortcut for it (unlike ", h("code", {}, "ENABLE_STRATEGY_LAYER"), ", which ",
        h("code", {}, "apps/gateway-server"), " does offer as a shortcut on top of the same config-file mechanism).",
      ]),
    ]),
  );

  root.append(
    h("div", { class: "card" }, [
      h("div", { class: "card-title" }, "What it's not"),
      h("p", {}, [
        "Don't confuse this with an ", h("strong", {}, "Execution Profile"), " (per task type, selectable per request via ",
        h("code", {}, "preferences.executionProfileOverride"), " — see the ", h("strong", {}, "Execution Profiles"),
        " panel) — the two are deliberately distinct concepts, and this Studio keeps them as separate nav items for exactly that reason.",
      ]),
      badge("architecture §37", "info"),
      " ",
      badge("packages/runtime-profiles", "info"),
    ]),
  );
}
