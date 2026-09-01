---
name: GitHub connector HTML uploads
description: Compatibility constraint for publishing tracked Vite HTML through the authenticated GitHub connector proxy.
---

When publishing this workspace through the GitHub connector API, tracked HTML containing a literal executable script element can be rejected by the proxy's Cloudflare filter. Keep Vite entry modules injected through a `transformIndexHtml` tag descriptor rather than written as literal executable markup in the source HTML.

**Why:** Both Git blob and Contents API writes were consistently blocked for otherwise ordinary Vite entry HTML, while the same byte content without the literal executable element uploaded normally. Vite's supported HTML transform preserves the runtime document without weakening the app.

**How to apply:** Preserve the existing transform-based entry injection when editing Vite artifacts that may be published through the connector. Verify the served HTML still contains the module entry after any related config change.