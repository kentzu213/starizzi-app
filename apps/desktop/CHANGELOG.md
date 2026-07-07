# Changelog — Izzi OpenClaw Desktop

## 1.5.0

A large agent + second-brain update: multi-agent chat now streams its live
process, persists across restarts, and records finished work into the personal
knowledge graph and the Replay-tasks board — so every surface connects as one
system. Also ships the first sellable, agent-callable Marketplace utility.

### Agents & chat
- **Izzi-native persona agents** (Socrates, Orchestrator) run directly through the
  Izzi API — no Docker, instant "install"; the Izzi key stays in the main process.
- **Docker agents (Hermes) route through the Izzi smart router** via a local
  main-process proxy — the Izzi credential never enters the container.
- **Live process streaming**: Hermes replies stream over SSE (its `tool_progress`
  rides in as content); izzi personas emit structured tool-call steps. A collapsible
  "reasoning" panel shows model thinking when available.
- **Chat history persists across restart** (SQLite `user_data`): tabs, messages,
  steps and reasoning are restored on launch; interrupted turns normalize to done;
  closing a tab removes its stored copy. No secrets are ever persisted.
- **Reasoning-effort picker** for Hermes (low / medium / high / xhigh) and a longer
  (10 min) chat timeout for slow agentic turns.
- Fixes: agent status refresh on the Chat page; Hermes 1-click install health probe
  runs from main; "Chat Now" jumps to the Chat page.

### Marketplace & extensions
- **Social Auto Poster** — the first sellable utility: schedules/posts to a Facebook
  Page via the locally-installed aitoearn backend, and is callable by izzi agents
  through the agent → extension tool bridge. (Facebook *Group* posting is not
  supported — Meta blocks third-party group posting APIs.)
- Extension **config form + command runner + pricing/buy UI** for installed utilities.
- **Offline install** for first-party utilities; disk-loaded extensions correctly
  show as installed in the Marketplace.

### Second brain (cohesion)
- Every finished agent turn is recorded into **my-graph** (a session node linked to a
  per-agent hub — no orphans) and the **Replay tasks** board (a `done` task), so agent
  work shows up alongside the rest of the workspace. Both writes are fail-closed.

### Security
- A durable `izzi-` key is auto-minted for agent LLM calls; credentials stay in the
  main process and are never logged or written to the graph/persisted chat.

_Baseline: 1.4.3. Verified with the full test suite (282 tests), main + renderer
type-checks, and the renderer build._
