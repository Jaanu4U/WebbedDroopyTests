---
name: GitHub connector tree pushes
description: Reliable pattern for pushing multi-file workspace snapshots through the authenticated GitHub connector.
---

For larger multi-file pushes, create the Git tree incrementally in small batches using `base_tree`, then create one commit and update the branch ref with `force: false`.

**Why:** Large tree payloads can be rejected by the connector sandbox before GitHub returns a response, while small tree writes and the final commit/ref calls work reliably.

**How to apply:** Keep the remote branch SHA as the commit parent, upload changed paths in bounded batches, chain each returned tree SHA, and update the ref only after the commit is created.

The connector's `/git/commits/{sha}` response exposes the tree as `response.tree.sha`, while a branch ref exposes the commit as `response.object.sha`.

**Why:** Assuming the standard REST commit envelope caused a failed read during a real push even though the repository was unchanged.

**How to apply:** Read the top-level `tree` field from Git data API commit responses and verify the final branch ref after updating it.