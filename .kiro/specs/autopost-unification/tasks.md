# Auto-Post Unification — Tasks

> Gated: **do not start Phase 1 until D1–D3 are confirmed** (see requirements). Phases are
> ordered by value/risk so we can ship the agent bridge first and stop/adjust at any phase.
> Tasks reference the recommended design (canonical = Auto-Post Tool; MCP + repoint + embed).

## Phase 0 — Decide & verify (this turn + confirmation)

- [x] 0.1 Map both codebases (extension → aitoearn contract; Auto-Post Tool apps/api modules,
      MCP read/write tools, JWT+RBAC+workspace auth; aitoearn vendored in repo).
- [ ] 0.2 **User confirms D1 (canonical backend), D2 (primary mechanism), D3 (aitoearn disposition).**
- [ ] 0.3 Verify open questions O1–O4 (auth credential type, REST routes, channel coverage,
      extension settings injection) by reading `apps/api/auth`, `posts`, `social-auth` controllers +
      the Starizzi extension host settings path.

## Phase 1 — Auth unification (foundation for everything)

- [ ] 1.1 Main-process "Connect Auto-Post" flow: sign in to Auto-Post Tool → obtain JWT (+workspaceId).
- [ ] 1.2 Store the token via `SecretStore` (OS keychain); never log/commit; redact from errors.
- [ ] 1.3 Token accessor + refresh-on-401 helper shared by the MCP client + extension.
- [ ] 1.4 IPC + a small "Auto-Post connection" UI (status, connect, disconnect) in Starizzi.
- [ ] 1.5 Tests: token store round-trip, refresh, fail-closed on missing/invalid. `verification-loop`.

## Phase 2 — Agent bridge via MCP (primary value)

- [ ] 2.1 MCP client in main connecting to Auto-Post Tool `/mcp` (Streamable HTTP) with the stored JWT.
- [ ] 2.2 Surface its tools (`list_accounts`, `suggest_time`, `create_draft_post`, `schedule_post`,
      `plan_week`) to the agent — integrate into `host-agent.ts` tool loop alongside host tools.
- [ ] 2.3 Respect Starizzi permission modes; posting stays draft/approval-gated (no silent publish).
- [ ] 2.4 Stream tool steps live (reuse existing step events). Redact errors.
- [ ] 2.5 Tests: tool discovery, auth injection, RBAC error surfaced, no-token fail-closed.
- [ ] 2.6 `verification-loop` + `security-review` (auth/token surface).

## Phase 3 — Extension repoint (unify the extension onto the canonical backend)

- [ ] 3.1 Recreate `extensions/social-auto-poster/src/` (proper source; `dist` is currently prebuilt).
- [ ] 3.2 Rewrite command handlers to the Auto-Post Tool contract (REST or MCP): `listAccounts`,
      `postNow`, `schedule`, `listScheduled`, `cancelScheduled`, `status` — keep command ids/params.
- [ ] 3.3 Update `manifest.json` settings: `backendUrl` default `http://127.0.0.1:3001`; auth via the
      shared token (injected by main) instead of a raw key; keep channel/target/schedule settings.
- [ ] 3.4 Rebuild `.ocx`; verify agent can still call the commands (buildExtensionTools) end-to-end.
- [ ] 3.5 Tests + `verification-loop`.

## Phase 4 — Web dashboard embed (UI unification)

- [ ] 4.1 Add an "Auto-Post" page/panel in Starizzi renderer hosting `apps/web` (:3005) via `<webview>`
      (reuse the graphview embed pattern; webviewTag already enabled).
- [ ] 4.2 Single sign-on: pass/refresh the session so the dashboard opens authenticated.
- [ ] 4.3 Nav entry + loading/error states. `design-taste-frontend` / `frontend-patterns` for polish.
- [ ] 4.4 `verification-loop`.

## Phase 5 — Retire aitoearn from the Starizzi path + ship

- [ ] 5.1 Confirm no remaining dependency on aitoearn from agent/extension (per D3). If a channel needs
      it, keep it as an internal `apps/api` publisher adapter; else stop the `aitoearn-*` containers.
- [ ] 5.2 Docs: update extension README + a short "Auto-Post in Starizzi" guide.
- [ ] 5.3 Full `verification-loop` (build + tests + smoke both apps) + `security-review` + `deployment-patterns`.
- [ ] 5.4 Release Starizzi (bump + tag + CI, per established process); note Auto-Post Tool run recipe
      (corepack pnpm@9.1.0) so the backend is reproducibly startable.

## Notes

- Skills to pull in per phase (don't stack early): Phase 1/2 `backend-patterns`, `security-review`,
  `mcp-server-patterns`; Phase 3 `backend-patterns`; Phase 4 `frontend-patterns`, `design-taste-frontend`;
  all phases end with `verification-loop`; Phase 5 `deployment-patterns`.
- The Auto-Post Tool is a separate git repo — changes there (auth credential, any adapter) are committed
  in that repo; Starizzi changes (MCP client, extension, webview, connection UI) in the Starizzi repo.
