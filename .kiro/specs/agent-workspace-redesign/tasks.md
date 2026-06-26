# Implementation Plan — Agent Workspace Redesign (tất cả phase)

Cách tiếp cận: additive, không phá. Mỗi task surgical, truy về requirement, có checkpoint
build+test cuối mỗi phase. Ngôn ngữ: TypeScript + CSS. Test: Vitest (`vitest run`).

> **An toàn cho "Run all":** Phase 1 đã `[x]` (run-all bỏ qua). Phase 2–5 là việc **làm được
> trong repo desktop này** và an toàn để tự chạy tuần tự. Task **11 là checkpoint DỪNG** — các
> phase sau (loop chạy thật/scheduler, ghi agent-memory vào knowledge graph izzi, release) cần
> `izzi-backend` + security gate + bạn duyệt, nên KHÔNG nằm trong run-all (xem mục cuối).

## Tasks

### Phase 1 — Agent Workspace layout (HOÀN TẤT)

- [x] 1. Mô hình dữ liệu Loop + hàm thuần (`types/agent-loops.ts` + test)
  - _Requirements: 3.1, 3.3–3.6, 7.3, 8.1, 8.2_
- [x] 2. Component rail/dock/business (`AgentRail`, `LoopDock`, `BusinessStrip`)
  - _Requirements: 2.1–2.4, 3.2, 4.1–4.6, 7.4_
- [x] 3. Stylesheet `styles/agent-workspace.css` (token-only)
  - _Requirements: 1.1–1.6, 5.1, 5.4_
- [x] 4. Tích hợp `pages/Chat.tsx` (giữ `.chat-page` nguyên vẹn)
  - _Requirements: 1.1, 2.3, 2.5, 2.6, 3.3, 3.4, 6.3_
- [x] 5. Truyền props `App.tsx` (`user`/`onBuyApi`, giữ nav)
  - _Requirements: 6.1_
- [x] 6. Kiểm chứng Phase 1: build + vitest (146/146 pass)
  - _Requirements: 6.5, 6.6, 8.3, 8.4_

### Phase 2 — Loop UX hoàn thiện (desktop, runnable)

- [x] 7. Loop seeds prompt + chi tiết + ghi nhớ
  - [x] 7.1 Thêm `starterPrompt` vào `AgentLoop` + 6 preset (`types/agent-loops.ts`); thêm hàm thuần `loopStarterDraft(loop)`
    - _Requirements: 9.1, 9.4_
  - [x] 7.2 `Chat.tsx`: `handleSelectLoop` → `setDraft(loopStarterDraft(loop))` (KHÔNG tự gửi); đảm bảo `activeTask` phản chiếu loop gần nhất
    - _Requirements: 9.1, 9.2, 9.4_
  - [x] 7.3 `LoopDock.tsx`: hiển thị chi tiết loop (mô tả + agent/model gợi ý) khi hover/expand
    - _Requirements: 9.3_
  - [x] 7.4 Test `loopStarterDraft` (thuần, không side-effect); cập nhật test loop nếu cần
    - _Requirements: 9.1, 9.4_
  - [x] 7.5 Checkpoint Phase 2: `pnpm --filter @openclaw/desktop build` + `vitest run` đạt, 0 fail mới
    - _Requirements: 12.3_

### Phase 3 — Panel Ngữ cảnh / Bộ nhớ (read-only, runnable)

- [x] 8. Context/Memory panel (phía ĐỌC của second brain)
  - [x] 8.1 `types/agent-memory.ts`: `MemoryItem` + hàm thuần `normalizeMemoryItems(raw)` (own-property; loại mục thiếu `source` — no-orphan đọc)
    - _Requirements: 10.3, 10.4_
  - [x] 8.2 `components/ContextPanel.tsx`: feature-detect `window.electronAPI?.memory?.list?.(agentId)`; read-only; empty state khi thiếu API; không hiển thị secret/PII
    - _Requirements: 10.1, 10.2, 10.3_
  - [x] 8.3 Style `.aw-context*` trong `styles/agent-workspace.css` (token-only); gắn ContextPanel vào rail trong `Chat.tsx`
    - _Requirements: 10.1, 12.1_
  - [x] 8.4 Test `normalizeMemoryItems` (lọc no-source, không bịa dữ liệu)
    - _Requirements: 10.4_
  - [x] 8.5 Checkpoint Phase 3: build + vitest đạt, inlineStyleAudit 0 inline trình bày mới
    - _Requirements: 12.3_

### Phase 4 — Surface điều hướng Knowledge/Graph (runnable)

- [x] 9. Thêm tab Knowledge/Graph (đồng bộ izzi /aibase/graph)
  - [x] 9.1 `pages/Knowledge.tsx`: shell read-only; feature-detect dữ liệu graph; else empty + CTA `shell.openExternal('https://izziapi.com/aibase/graph')`; token-only
    - _Requirements: 11.3, 11.4_
  - [x] 9.2 `App.tsx`: thêm `'knowledge'` vào union `Page` + `renderPage()` case; **giữ nguyên** mọi page/cặp điều hướng cũ
    - _Requirements: 11.1_
  - [x] 9.3 `Sidebar.tsx`: thêm mục `knowledge` vào EXPLORE_ITEMS (icon + label), dùng quy ước hiện có
    - _Requirements: 11.1_
  - [x] 9.4 Cập nhật `navigationMap.test.ts`: thêm `'knowledge'` vào `BASELINE_PAGES`; giữ mọi assert cũ đạt
    - _Requirements: 11.2_
  - [x] 9.5 Checkpoint Phase 4: build + vitest đạt (gồm navigationMap mới), 0 fail mới
    - _Requirements: 11.2, 12.3_

### Phase 5 — Đồng bộ token & IA với izzi (polish, runnable)

- [x] 10. Token/IA sync + chốt phạm vi desktop
  - [x] 10.1 Rà ContextPanel + KnowledgePage + workspace: 0 literal màu/nền ngoài Hệ_Token_Glass
    - _Requirements: 12.1_
  - [x] 10.2 Xác nhận bản đồ IA tab tool ↔ izzi trong `design.md` đầy đủ và cập nhật
    - _Requirements: 12.2, 5.2_
  - [x] 10.3 Checkpoint cuối (desktop): `pnpm --filter @openclaw/desktop build` + `vitest run` + inlineStyleAudit đều đạt
    - _Requirements: 12.3, 6.5, 6.6_

### CHECKPOINT — DỪNG trước phần cross-repo / deploy

- [x] 11. STOP — KHÔNG tự tiếp tục. Báo cáo người dùng: Phase 2–5 (desktop) đã xong & verified.
  Các phase còn lại (mục dưới) cần `izzi-backend`, security gate (auth + budget + no-orphan), và
  bạn duyệt trước khi làm. Đề xuất tạo **spec riêng** cho từng phần. Chờ người dùng quyết định.

## Ngoài phạm vi "Run all" (cross-repo / runtime / deploy — chạy thủ công, cần spec riêng)

> Không phải task `[ ]` để run-all KHÔNG tự thực thi. Mỗi mục nên có spec riêng + security gate.

- **Loop execution thật + scheduler/cron** — cần agent runtime + `izzi-backend`. Bề mặt chạy phải
  qua xác thực (izzi key/JWT) + budget. (security-baseline B)
- **Agent-memory WRITE → knowledge graph izzi** (phía GHI của second brain) — endpoint ghi ở
  `izzi-backend` (auth + budget + no-orphan/no-dangling). Desktop chỉ gọi endpoint đã xác thực;
  tuyệt đối không tạo surface ghi thiếu auth; không ghi secret/PII vào graph.
- **Release production** (electron-builder + GitHub release, auto-update feed) — thao tác khó đảo
  ngược; chỉ chạy khi người dùng duyệt rõ ràng.

## Waves (Phase 2–5)

```json
{ "waves": [
  { "id": 0, "tasks": ["7.1", "7.2", "7.3", "7.4"] },
  { "id": 1, "tasks": ["7.5"] },
  { "id": 2, "tasks": ["8.1", "8.2", "8.3", "8.4"] },
  { "id": 3, "tasks": ["8.5"] },
  { "id": 4, "tasks": ["9.1", "9.2", "9.3", "9.4"] },
  { "id": 5, "tasks": ["9.5"] },
  { "id": 6, "tasks": ["10.1", "10.2"] },
  { "id": 7, "tasks": ["10.3"] },
  { "id": 8, "tasks": ["11"] }
] }
```

## Notes

- Task không gắn `*` là core. Mỗi task truy về requirement để truy vết.
- Checkpoint cuối mỗi phase đảm bảo build + test xanh trước khi sang phase sau (verification-loop).
- Lệnh chạy lâu (dev server) do người dùng tự chạy; CI/test dùng chế độ chạy một lần (`vitest run`).
- Sau khi thêm file, GitNexus index có thể stale — chạy `npx gitnexus analyze` nếu cần dùng tool đồ thị.
