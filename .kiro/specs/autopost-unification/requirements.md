# Auto-Post Unification — Requirements

## Problem

There are currently **two separate auto-posting systems** plus a thin extension, and
they are not unified:

1. **Auto-Post Tool** (`f:\Ai Tools\TOOL TỰ ĐỘNG ĐĂNG BÀI`, pkg `auto-post-tool` v1.1.1) —
   a mature, self-built system:
   - `apps/api` — NestJS backend (`:3001`). Modules: `ai, analytics, approvals, auth,
     best-time, campaigns, health, inbox, mcp, media, notifications, planning, posts,
     publisher, scheduler, social-auth, templates, usage`.
   - `apps/web` — Next.js 14 dashboard (`:3005`, Supabase-auth login).
   - `apps/worker` — BullMQ publisher.
   - Auth = JWT (+ workspace/role RBAC via a Permission Matrix), multi-tenant (`workspaceId`),
     audit logs, draft → approval → publish flow.
   - **Already exposes an MCP server** (`modules/mcp`, Streamable HTTP, Bearer-JWT auth,
     RBAC-gated) with tools: read (`list_accounts`, `suggest_time`, …) + write
     (`create_draft_post`, `schedule_post`, `plan_week`). Platforms: Facebook, YouTube, TikTok.
   - Infra already running locally: `autopost_postgres` (:5432), `autopost_redis` (:6379),
     `autopost_minio` (:9000-9001).

2. **aitoearn** — a *separate* multi-platform publishing backend **vendored inside the same
   repo** (`AItoEarn/project/aitoearn-{backend,electron}`), running as `aitoearn-*` containers
   (nginx `:8080`). API: `GET /api/account/list/all`, `POST /api/plat/publish/create`,
   `POST /api/plat/publish/getList`, `DELETE /api/plat/publish/delete/:id`; Bearer key;
   `{data,code,message}` envelope (code 0/200 = OK).

3. **Starizzi extension `social-auto-poster`** (`extensions/social-auto-poster/`, `.ocx`,
   freemium $9.99/mo) — a thin HOST client with agent-callable commands
   (`status, listAccounts, postNow, schedule, listScheduled, cancelScheduled`) + a panel.
   **It is wired to aitoearn** (settings `backendUrl` default `http://127.0.0.1:8080/api`,
   `apiKey`, `channel`, `targetId`, `scheduleTimes`, `timezone`). It does NOT talk to the
   Auto-Post Tool.

**Result:** the agent + extension drive aitoearn; the richer Auto-Post Tool (AI generation,
media pipeline, planning, approvals, analytics, MCP) is a parallel island. The user wants
these unified into one coherent product.

## Goal

One auto-posting system, driven from Starizzi (agent + extension + UI), on **one canonical
backend**, with **one sign-in**, so posting/scheduling/planning done via the agent, the
extension, or the web dashboard all hit the same data and enforcement path.

## Key decisions (MUST be confirmed before build)

- **D1 — Canonical backend.** Recommended: **Auto-Post Tool `apps/api`** (richest: AI + media
  + planning + approvals + analytics + MCP + RBAC). Alternatives: keep aitoearn (what the
  extension uses today) / bridge both. → *pending user confirmation.*
- **D2 — Primary integration mechanism.** Recommended: **MCP agent bridge** (Auto-Post Tool
  already ships an MCP server) as the agent path, **plus** repoint the extension and **embed**
  the web dashboard. Alternatives: only rewrite the extension's HTTP calls; only webview embed.
  → *pending user confirmation.*
- **D3 — aitoearn disposition.** Recommended: retire it from the agent/extension path (keep
  only if still needed as an internal OAuth/publish adapter). → *pending.*

## User stories & acceptance criteria (EARS)

### US1 — Agent posts through the real backend
As a user, I want the Starizzi agent to create/schedule/plan posts on the Auto-Post Tool so
the agent uses the full system (AI, approvals, multi-platform), not the aitoearn island.
- WHEN the agent is asked to draft/schedule/plan a post, THE SYSTEM SHALL call the Auto-Post
  Tool (via MCP) and create workspace-scoped `draft` posts that require approval before publish.
- WHEN the agent lacks a valid credential/workspace, THE SYSTEM SHALL refuse without side effects.

### US2 — Extension unified onto the canonical backend
As a user, I want the `social-auto-poster` extension commands to hit the canonical backend.
- WHEN `postNow`/`schedule`/`listAccounts`/`listScheduled`/`cancelScheduled` run, THE SYSTEM
  SHALL call the canonical backend with unified auth, preserving the existing command surface.
- IF the extension is not configured/authenticated, THE SYSTEM SHALL return an actionable error.

### US3 — One sign-in
As a user, I want to authenticate once.
- WHEN I connect the auto-post backend in Starizzi, THE SYSTEM SHALL obtain + store a credential
  (JWT with `workspaceId`) locally (OS-keychain style), reused by agent + extension, refreshed as needed.
- THE SYSTEM SHALL never log or commit the credential.

### US4 — Full UI available in-app
As a user, I want the Auto-Post dashboard inside Starizzi.
- WHEN I open the Auto-Post surface in Starizzi, THE SYSTEM SHALL show the Auto-Post Tool web
  dashboard (approvals, campaigns, planning, analytics, inbox) authenticated as the same user.

### US5 — No regression / safe by default
- THE SYSTEM SHALL keep the existing Starizzi agent modes + approval gating; posting actions
  remain draft/approval-gated (no silent publish).
- Existing Auto-Post Tool REST/MCP behavior, auth, and tests SHALL be preserved.

## Non-goals (this phase)

- Rebuilding aitoearn's browser-automation for Facebook Groups.
- New social platforms beyond FB/YT/TikTok.
- Rewriting the Auto-Post Tool UI inside Starizzi natively (embed the existing web app instead).
- Billing/marketplace changes for the extension (keep current freemium listing).

## Open questions (verify in design/build)

- [ ] Does the Auto-Post Tool `auth` module issue a long-lived/API-key credential suitable for a
      desktop client, or only short JWT + refresh? (drives US3 token handling)
- [ ] Is aitoearn still needed for any capability `apps/api` lacks (e.g. specific channel)?
- [ ] Where does the extension read its settings from at runtime (extension host settings store)
      — to repoint `backendUrl` + inject the token.

---

## DECISIONS CONFIRMED (2026-07-08)

- **D1 = Auto-Post Tool is canonical**, delivered as a **Marketplace product** (the
  `social-auto-poster` extension is its client). HARD REQUIREMENT: **1-click install → the
  Starizzi agent can use it immediately** (no manual config, no separate login).
- **D2 = delegated to the agent** ("làm sao tốt nhất") — pick the optimal integration.
  Chosen (see design): thin marketplace extension → Auto-Post Tool backend, agent gets the
  capability via BOTH the extension's commands AND the backend's MCP tools; web dashboard embed.
- **D3 = retire aitoearn from the Starizzi path** (per D1). Keep only as an internal apps/api
  publisher adapter if a channel needs it.

### New fact — auth is already unified with izziapi.com

The Auto-Post Tool exposes **`POST /auth/supabase-sync { email, name, supabaseToken }` → local JWT**
(auth.controller.ts). izziapi.com uses Supabase auth, and Starizzi already holds the user's
izzi/Supabase session. So the "1-click, no separate login" flow is:

```
Starizzi (has izzi/Supabase session)
  → POST {autopostBackend}/auth/supabase-sync { email, name, supabaseToken }
  → local JWT (+ workspace)  → store in SecretStore
  → reused by: extension REST calls + agent MCP client   (refresh as needed)
```

Backend endpoint is configurable; defaults to local `http://127.0.0.1:3001`, **auto-detected on
install** (same pattern as the codex-lb auto-connect). Hosting the backend on izziapi.com infra
(true SaaS) is a **follow-up** (maintainer/deploy), not required for the local 1-click flow.

### Refined "1-click + agent-ready" acceptance

- WHEN the user installs "Social Auto Poster" from the Marketplace, THE SYSTEM SHALL: activate the
  extension, obtain the Auto-Post JWT via `/auth/supabase-sync` using the current izzi session,
  auto-detect the backend, and register the extension's commands as agent tools — with **zero manual
  steps** — so the agent can post/schedule right after install.
