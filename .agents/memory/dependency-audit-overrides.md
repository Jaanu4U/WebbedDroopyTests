---
name: Workspace dependency audit overrides
description: How to handle stale vulnerable transitive versions in this pnpm workspace
---

When a dependency audit identifies a vulnerable transitive package whose parent already accepts a patched release, refresh the workspace lockfile and use a narrow root pnpm override rather than changing application code or replacing the parent package.

**Why:** A lockfile refresh can leave older transitive versions selected even after a parent upgrade, while a scoped override makes the patched resolution explicit and keeps the remediation reproducible across workspace packages.

**How to apply:** Prefer the smallest compatible parent upgrade first. Add exact overrides only for remaining vulnerable transitive packages, then rerun the audit, typechecks, relevant tests, and affected workflows.