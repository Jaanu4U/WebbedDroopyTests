# BlackBelt Commandos

BlackBelt Commandos is a role-based workforce operations platform for managing security attendance, patrol evidence, emergency response, field submissions, employee verification, and control-room monitoring.

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — run the API server (port 5000)
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- Required env: `DATABASE_URL` — Postgres connection string
- Workforce access can be assigned server-side with `WORKFORCE_ROLE_ASSIGNMENTS_JSON` (a JSON object keyed by Clerk user ID with `role`, `siteName`, and optional `fieldOfficerId`), or by a Management operator in the `/access` Access management screen. The screen stores role, site, and Field Officer assignments in Clerk public metadata and records the assigning operator and time; changes apply on the next session. New accounts without an assignment default to the least-privileged `Guard` role. `WORKFORCE_DEFAULT_ROLE` and `WORKFORCE_DEFAULT_SITE` are available for controlled deployments.

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- API: Express 5
- DB: PostgreSQL + Drizzle ORM
- Validation: Zod (`zod/v4`), `drizzle-zod`
- API codegen: Orval (from OpenAPI spec)
- Build: esbuild (CJS bundle)

## Where things live

- `artifacts/blackbelt-commandos/src/App.tsx` — responsive role-aware operations UI and routes
- `artifacts/blackbelt-commandos/src/index.css` — application theme and design tokens
- `artifacts/api-server/src/routes/operations.ts` — operations API with seeded development data
- `lib/api-spec/openapi.yaml` — source of truth for the generated API client and validation schemas

## Architecture decisions

- Clerk provides managed sign-in with cookie-backed API sessions. The API resolves each user's role and site assignment from server configuration or signed Clerk metadata; the browser never chooses its own role. Unassigned accounts default to the least-privileged Guard view.
- Attendance and live tracking keep separate location concepts: site geofencing for duty attendance and city-level location for Field Officers.
- API operations are authenticated before seeding or reading data. Route-level role guards restrict management, team, verification, tracking, and access-assignment operations; employee phone fields are restricted to authorized workforce roles.
- Field officer locations are returned only to authorized roles during the active policy tracking window, and a Field Officer assignment is scoped to its assigned officer ID.
- Operational attendance, team readiness, checklist, employee verification, SOS, and employee request records are persisted in Postgres; static reference views remain seeded in the API while the client confirms final approval, privacy, and retention rules.

## Product

The product provides a command center dashboard, geofenced attendance, SOS alerts, supervisor team readiness, checklist completion, escalation contacts, live Field Officer tracking with filters, employee submission verification, employee request forms, and payslip viewing.

## User preferences

_Populate as you build — explicit user instructions worth remembering across sessions._

## Gotchas

_Populate as you build — sharp edges, "always run X before Y" rules._

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
