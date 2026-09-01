---
name: API codegen integer compatibility
description: Compatibility constraint between this workspace's OpenAPI generator output and installed Zod runtime.
---

OpenAPI `integer` fields may generate `zod.int()`, which is unavailable in the workspace's installed Zod 3 runtime. For positive integer-like API fields, use a numeric schema with a minimum and rely on the database column and route semantics for integer storage.

**Why:** Code generation can succeed while the generated validator package fails its TypeScript build when it emits a Zod API that the installed runtime does not provide.

**How to apply:** When adding integer-like fields to `lib/api-spec/openapi.yaml`, regenerate immediately and run the shared-library typecheck before leaf package checks.