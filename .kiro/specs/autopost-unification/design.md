# Auto-Post Unification — Design

> Status: **proposal, pending decisions D1–D3** (see requirements). This design assumes the
> recommended answers (D1 = Auto-Post Tool canonical; D2 = MCP agent bridge + extension repoint
> + web embed; D3 = retire aitoearn from the agent/extension path). If the user picks differently,
> the "Alternatives" section covers the other branches.

## Current state (as found)

```
Starizzi (Electron)                         Auto-Post backends (Docker, running)
────────────────────                        ────────────────────────────────────
agent (host-agent / izzi-agent)             aitoearn (:8080, /api/plat/publish/*)  ← extension talks here
extension social-auto-poster ──HTTP────────▶  Bearer key, {data,code,message}
  (postNow/schedule/... commands)
                                            auto-post-tool apps/api (:3001)         ← the rich system, unused by Starizzi
                                              REST + MCP (Streamable HTTP, JWT+RBAC)
                                              posts/publisher/scheduler/social-auth/ai/media/planning/approvals
                                            auto-post-tool apps/web (:3005)  Next.js dashboard
```

Two publishing backends; Starizzi drives the weaker one (aitoearn); the strong one (auto-post-tool)
is an island. Both are in the same repo (`TOOL TỰ ĐỘNG ĐĂNG BÀI`; aitoearn vendored under `AItoEarn/`).

## Target architecture

**One canonical backend = Auto-Post Tool `apps/api` (:3001).** Starizzi unifies onto it through
three surfaces that all share the backend's single enforcement path (RBAC + workspace + audit):

```
Starizzi (Electron, main process holds the token)
├── (1) Agent bridge  ── MCP (Streamable HTTP, Bearer JWT) ──▶ apps/api /mcp
│        host-agent gains auto-post MCP tools: list_accounts, suggest_time,
│        create_draft_post, schedule_post, plan_week  (draft → approval-gated)
├── (2) Extension social-auto-poster ── REST (or MCP) + JWT ─▶ apps/api
│        same command surface (status/postNow/schedule/...) → auto-post-tool contract
└── (3) Web embed (webview) ────────────────────────────────▶ apps/web (:3005)
         full dashboard (approvals, campaigns, planning, analytics, inbox) in-app
                         │
                    one auth: sign in once → JWT(+workspaceId) stored in SecretStore
```

### Component 1 — Agent bridge via MCP (primary; matches "use agent + skills")

- Auto-Post Tool already runs an MCP server (`modules/mcp/mcp.server.ts`) over **Streamable HTTP**,
  authenticating `Authorization: Bearer <jwt>` and gating each tool by the Permission Matrix +
  workspace membership. Tools: `create_draft_post` (content.create), `schedule_post`
  (content.update), `plan_week` (content.create), plus read tools (`list_accounts`, `suggest_time`).
- Starizzi main process connects to that MCP endpoint as an **MCP client** and surfaces its tools to
  the agent (reuse the existing agent tool-calling loop in `host-agent.ts` — add MCP tools alongside
  the host tools). The agent can then draft/schedule/plan through the real system.
- Because MCP tools create **drafts requiring approval**, this is safe-by-default and complements
  Starizzi's own permission modes (Chat/Agent/Full).
- Auth: main injects the stored JWT into the MCP client's Authorization header; refresh on 401.

### Component 2 — Extension repoint

- Rewrite `extensions/social-auto-poster/dist/index.js` (source it properly under `src/`) so its
  commands call the **Auto-Post Tool** contract instead of aitoearn's `/plat/publish/*`:
  - `listAccounts` → auto-post-tool accounts endpoint (or MCP `list_accounts`).
  - `postNow`/`schedule` → create post + set `scheduledAt` (draft) via REST/MCP; publish respects
    the approval flow (no silent publish).
  - `listScheduled`/`cancelScheduled` → posts list/delete scoped to workspace.
- Keep the SAME command ids + params (agent tools + UX unchanged). Update `manifest.json` settings:
  `backendUrl` default → `http://127.0.0.1:3001`; auth via the shared token (from main), not a raw key.
- Decision knob: extension can call REST directly OR call the same MCP server. Prefer **REST** for the
  extension (simpler request/response for UI commands) and **MCP** for the agent (Component 1).

### Component 3 — Web dashboard embed

- Add an "Auto-Post" page/panel in Starizzi renderer that hosts `apps/web` (:3005) via Electron
  `<webview>` (the exact pattern already used for the graphview embed). Single sign-on: pass/refresh
  the session so the dashboard opens authenticated as the same user.
- Gives full UI (approvals, campaigns, planning, analytics, inbox) without re-porting it.

### Auth unification (US3)

- Starizzi main gets a **"Connect Auto-Post"** action: user signs in (email/password or the existing
  Supabase/JWT flow the web app uses) → main receives a JWT carrying `workspaceId` → stored via
  `SecretStore` (OS keychain), never logged/committed.
- The JWT is reused by (1) the MCP client and (2) the extension REST calls; refreshed on expiry.
- Open question O1: confirm whether `apps/api/auth` can mint a long-lived/desktop credential or only
  short JWT+refresh — determines refresh handling.

### Data & enforcement

- Single source of truth = Auto-Post Tool Postgres (`autopost_postgres`). All three surfaces write
  through the same services → same RBAC, workspace scoping, audit logs, draft/approval flow.
- aitoearn accounts/schedules are NOT migrated in phase 1 (retired from the Starizzi path). If a
  capability only aitoearn has is needed, keep it behind `apps/api` as an internal adapter (D3).

## Security (security-baseline B/C/D/E/F)

- Token: JWT with workspace claim, stored in OS keychain (SecretStore), never logged/committed,
  redacted from errors. Refresh on 401; fail-closed on missing/invalid.
- All posting is workspace-scoped + RBAC-gated on the backend (already enforced); Starizzi adds its
  own approval gate for agent Full mode. No silent publish (drafts require approval).
- Extension `net.http` only to the configured backend; loopback http allowed, remote requires https.
- No new unauthenticated surface. `npm audit` on any new deps (MCP client SDK already used by Kiro).

## Alternatives & tradeoffs

| Option | Pros | Cons |
|---|---|---|
| **A. Canonical = Auto-Post Tool + MCP + repoint + embed (recommended)** | One rich backend; agent-native via existing MCP; full UI reused; single enforcement path | Most work; must unify auth (JWT+workspace); extension rewrite |
| B. Keep aitoearn canonical, repoint nothing | Zero change to extension | Abandons the richer tool the user just built; two systems persist |
| C. Only rewrite extension HTTP → apps/api (no MCP, no embed) | Smaller; keeps command UX | Agent doesn't gain native tools; no unified UI |
| D. Only webview-embed apps/web | Fast UI unify | Agent + extension still on aitoearn; not truly unified |
| E. Bridge: apps/api wraps aitoearn as a publisher adapter | Reuses aitoearn OAuth if apps/api lacks a channel | Keeps both running; more moving parts |

Recommendation: **A**, delivered in phases; start with the MCP agent bridge (highest value, lowest UI
risk) then extension repoint, then web embed. Fall back to C if the user wants a smaller first step.

## Open questions

- [ ] O1 auth: long-lived desktop credential vs JWT+refresh (US3).
- [ ] O2: exact `apps/api` REST routes for accounts/posts/schedule (needed for Component 2 — verify in build).
- [ ] O3: does `apps/api` cover every channel the user posts to, or is aitoearn still required for one? (D3)
- [ ] O4: extension host settings-injection mechanism (how main sets `backendUrl` + token for the extension).
