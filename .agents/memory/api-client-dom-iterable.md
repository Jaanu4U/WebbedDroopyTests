---
name: API client DOM iterable types
description: Orval-generated fetch clients use Headers.entries(), which needs the DOM iterable TypeScript library.
---

The generated React API client must compile with both `dom` and `dom.iterable` in its TypeScript `lib` list.

**Why:** The generated fetch helper enumerates `Headers` with `.entries()`, while `dom` alone does not expose that method to TypeScript.

**How to apply:** If API codegen succeeds but workspace declaration typechecking reports `Headers.entries` errors, verify the client package includes `dom.iterable` before changing generated files.