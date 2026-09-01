---
name: Policy integration test prerequisites
description: Non-obvious setup requirements for API policy persistence tests in this workspace.
---

Policy integration tests use the real development PostgreSQL database and workspace TypeScript packages. The database schema must be synchronized before persistence checks run, and shared library declarations should be rebuilt before leaf API typechecks when generated outputs may be stale.

**Why:** The workspace can contain a newer checked-in Drizzle schema or source exports than the development database and emitted declarations. Without synchronization, tests can fail on missing tables or typechecks can report missing exports even though the source is correct.

**How to apply:** Before diagnosing policy-test failures, confirm the development schema is current and run the shared-library typecheck/build before the API package typecheck. Do not apply development-only schema operations to production.

The configured `policy-enforcement` workflow may also fail before running tests when the artifact-local `tsx` executable is unavailable; treat that as a validation-environment issue rather than a policy assertion failure.