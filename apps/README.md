# apps/

Deployable applications.

- **`gateway-server/`** — the v1.0 MVP composition root (Wave 5 / EM-5,
  Blueprint §5/§7). Wires every platform package (`orchestrator`,
  `middleware`, `policy-engine`, `credential-resolver`, `reliability`,
  `streaming`, `model-registry`, `providers/groq`, `providers/nvidia-nim`)
  into a running HTTP/SSE server. See its own README for the full public
  API, configuration, and operational details.
