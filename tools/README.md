# tools/

Shared cross-package tooling, notably `adapter-conformance-tests` (the
shared test suite every provider adapter must pass, architecture §12.4/§24).
Reserved directory (architecture §9). Populated starting EM-1, when the
Mock Adapter needs a conformance harness to prove itself against (Blueprint
§7 EM-1).

`orchestrator-integration-tests` (Engineering Milestone EM-4) is the second
occupant: `orchestrator`'s frozen dependency edge (architecture §4.1)
deliberately excludes `provider-sdk` and the concrete provider packages
(ADR-0008), so no test living inside `packages/orchestrator/test/` can ever
construct a real `MockAdapter`, `GroqAdapter`, or `NimAdapter`. This
directory's exemption from the per-package `DEPENDENCY_TABLE`
(`package.json`'s `graph:check` script only cruises `packages apps`) is
exactly the escape hatch a true end-to-end test of the orchestrator against
real adapters needs — the same reason `adapter-conformance-tests` lives
here rather than inside any one provider package.
