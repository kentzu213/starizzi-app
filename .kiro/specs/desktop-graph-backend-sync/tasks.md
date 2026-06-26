# Kế hoạch triển khai — Desktop Graph & Memory Backend Sync

## Overview

Kế hoạch này chuyển thiết kế thành chuỗi bước code tăng dần, mỗi bước nối tiếp bước
trước và kết thúc bằng việc wire mọi thứ lại với nhau — không để code mồ côi, không
tạo mô hình dữ liệu graph song song. Chỉ gồm việc viết / sửa / kiểm thử code.

Ngôn ngữ: **TypeScript** (đúng stack `apps/desktop` — Electron + React 19 + Zustand,
vitest + `fast-check`). Không cần chọn ngôn ngữ vì thiết kế đã dùng TS cụ thể.

Phân pha (theo `requirements.md` và `design.md`):

- **Phase 1 (mục 1–7) — BẮT BUỘC, online-first, cài + test được.** Đây là lõi tạo ra
  bản build cài đặt được: cầu IPC `graph`/`memory`, HTTP ở Tiến_Trình_Chính qua
  Auth_Manager, mapper thuần + property test round-trip, state renderer phản chiếu
  phản hồi backend, mở rộng Sync_Engine. Chạy "run all" trên Phase 1 → bản cài được.
- **Phase 2 (mục 8–10) — HOÃN LẠI / tuỳ chọn.** Hàng đợi offline (bảng SQLite + logic
  thuần coalesce/no-orphan/LWW + flush). **Mọi sub-task Phase 2 đánh dấu `*`** để
  "run all" trên Phase 1 bỏ qua chúng và vẫn cho ra bản build cài được. Không bắt buộc
  cho lần cài đầu tiên.

Quy ước: sub-task đánh dấu `*` là tuỳ chọn (test hoặc việc Phase 2 đã hoãn) và **sẽ
không** được tự động triển khai khi chạy. Mỗi property test ghi rõ số Property + điều
khoản requirement nó kiểm, dùng `fast-check` `{ numRuns: 100 }` với chú thích
`// Feature: desktop-graph-backend-sync, Property N: ...`.

---

## Tasks — Phase 1 (bắt buộc)

- [ ] 1. Type dùng chung + mapper thuần (nền tảng, test không cần Electron)
  - [ ] 1.1 Tạo `shared/graph-types.ts` — nguồn sự thật type duy nhất
    - Tạo `apps/desktop/src/shared/graph-types.ts`
    - Khai báo `GraphNode` phản chiếu **đúng** `UserNode` (id, title, nodeType, content?,
      url?, metadata?, color, parentId?, topicId?, x?, y?, createdAt, updatedAt)
    - Khai báo `GraphLink` phản chiếu **đúng** `UserLink` (id, sourceId, targetId, label?, color?)
    - Khai báo `NodeCreatePayload` (whitelist create: title bắt buộc, nodeType, color,
      content, url, topicId, x, y, metadata) và `NodePatchPayload` (whitelist patch:
      thêm isPublic, bỏ các trường server-owned)
    - Khai báo `MemoryItemDTO` (`{ id, title, source, createdAt }`)
    - Import được từ cả tiến trình main lẫn renderer; không tạo cấu trúc lệch khỏi UserNode/UserLink
    - _Requirements: 1.3, 3.2, 7.4_

  - [ ] 1.2 Cài đặt `shared/graph-mapper.ts` — hàm THUẦN
    - Tạo `apps/desktop/src/shared/graph-mapper.ts`
    - `userNodeToModel(raw: unknown): GraphNode | null` — đọc bằng `Object.hasOwn` +
      kiểm `typeof`; thiếu id/title → `null`; không theo prototype-chain
    - `userLinkToModel(raw: unknown): GraphLink | null` — `null` nếu thiếu id/sourceId/targetId
    - `modelToCreatePayload(...)` — chỉ copy khoá whitelist create, bỏ khoá `undefined`,
      không gửi trường server-owned (id/createdAt/updatedAt/parentId)
    - `modelToPatchPayload(...)` — chỉ copy khoá whitelist patch, bỏ khoá `undefined`
    - `memoryNodeToItem(raw: unknown): MemoryItemDTO | null` — `source ← nodeType`; thiếu
      trường → `null` (renderer `normalizeMemoryItems` lọc tiếp)
    - Mọi hàm không side-effect, không throw, không bịa dữ liệu
    - _Requirements: 1.2, 1.3, 1.6, 2.1, 2.3, 8.2, 9.3_

  - [ ]* 1.3 Viết property test round-trip cho mapper
    - Tạo `apps/desktop/src/shared/graph-mapper.test.ts`
    - **Property 1: Ánh xạ node round-trip giữ nguyên trường được giữ**
    - **Validates: Requirements 1.2, 1.3, 2.3, 11.1, 11.5**
    - Generator `fast-check` dựng `UserNode` JSON (unicode title/content, số x/y, object
      metadata, optional fields) **kèm ca input prototype-polluted** (`__proto__`) để
      khẳng định own-property
    - Khẳng định: round-trip (`userNodeToModel` → `modelToPatchPayload` → dựng lại) tương
      đương trên tập trường được giữ (title, nodeType, color, content, url, x, y, topicId,
      metadata); payload **chỉ** chứa khoá whitelist
    - `{ numRuns: 100 }`, chú thích `// Feature: desktop-graph-backend-sync, Property 1: ...`

- [ ] 2. Tầng HTTP `GraphClient` (Tiến_Trình_Chính, token chỉ ở main)
  - [ ] 2.1 Cài đặt `main/graph/graph-client.ts`
    - Tạo `apps/desktop/src/main/graph/graph-client.ts`, lớp `GraphClient(auth, db)`
    - Lấy token qua `AuthManager.getAccessToken()`; build header `Authorization: Bearer <token>`
      + `Content-Type: application/json`; base `IZZI_API_BASE` đúng như AuthManager/SyncEngine (HTTPS)
    - `listNodes()` → `GET /api/aibase/nodes`, map `userNodeToModel`, lọc `null`
    - `createNode(input)` → guard `title` rỗng/whitespace trả `{ error }` **trước** khi gọi;
      `POST /api/aibase/nodes` với `modelToCreatePayload`
    - `updateNode(id, patch)` → `PATCH /api/aibase/nodes/:id` với `modelToPatchPayload`
    - `removeNode(id)` → `DELETE /api/aibase/nodes/:id`
    - `listLinks()` → `GET /api/aibase/links` map `userLinkToModel`
    - `listMemory(limit?)` → `GET /api/aibase/memory/list?limit=N` map `memoryNodeToItem`
    - Quy tắc lỗi: `token==null` → đọc `[]` (không gọi BE) / ghi `{ error }` fail-closed;
      `401` → đọc `[]` / ghi `{ error:'unauthorized' }`, không retry vô danh; lỗi mạng/`!res.ok`
      → đọc `[]` + `appendDiagnosticEvent` (chỉ type/status/message ngắn, **không** token,
      **không** node-kèm-danh-tính); ghi bị từ chối quyền → truyền nguyên trạng kết quả BE
    - Dùng endpoint `/api/aibase/*` hiện có; KHÔNG tạo endpoint backend mới
    - _Requirements: 1.1, 1.4, 1.5, 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 6.1, 6.2, 6.4, 8.1, 9.1, 9.2, 9.4, 9.5_

  - [ ]* 2.2 Viết unit test cho `GraphClient` (mock `fetch` + `AuthManager`)
    - Tạo `apps/desktop/src/main/graph/graph-client.test.ts`
    - token null → đọc trả `[]`, **không** gọi BE (1.4); 401 → fail-closed, ghi `{error}` (9.5)
    - lỗi mạng → `[]` + diagnostic **không chứa token** (1.5, 9.2)
    - create `title` rỗng → `{error}` không gọi BE (2.2); header `Authorization: Bearer`
      + base HTTPS đúng, token không lộ ngoài header (6.4, 7.3)
    - body POST/PATCH chỉ chứa trường whitelist (2.1, 2.3); 403 truyền nguyên trạng (2.6)
    - _Requirements: 1.4, 1.5, 2.2, 2.6, 6.4, 7.3, 9.2, 9.5_

- [ ] 3. Cầu IPC graph + memory (renderer không bao giờ thấy token)
  - [ ] 3.1 Cài đặt `main/graph/graph-ipc.ts`
    - Tạo `apps/desktop/src/main/graph/graph-ipc.ts`, export `registerGraphIpc(client: GraphClient)`
    - Đăng ký `ipcMain.handle`: `graph:list`, `graph:create`, `graph:update`, `graph:remove`,
      `graph:links`, `memory:list`
    - `memory:list` nhận `_agentId` để khớp chữ ký feature-detect; backend không lọc theo agent
      nên ghi chú rõ tham số hiện chưa dùng
    - Handler chỉ trả model (GraphNode/GraphLink/MemoryItemDTO) — **không** trả token
    - _Requirements: 7.1, 7.2, 7.3, 7.5, 8.1_

  - [ ] 3.2 Thêm namespace `graph` + `memory` vào `main/preload.ts`
    - Sửa `apps/desktop/src/main/preload.ts` (additive)
    - `graph`: `list()`, `create(input)`, `update(id, patch)`, `remove(id)`, `links()` —
      mỗi cái `ipcRenderer.invoke('graph:*', ...)`
    - `memory`: `list(agentId, limit?)` → `ipcRenderer.invoke('memory:list', agentId, limit)`
    - Chữ ký khớp đúng feature-detect của `Knowledge.tsx` (`graph.list()` trả mảng node) và
      `ContextPanel.tsx` (`memory.list(agentId)` trả mảng item); không truyền token qua bridge
    - _Requirements: 7.1, 7.2, 7.4, 7.5_

  - [ ] 3.3 Khởi tạo `GraphClient` + gọi `registerGraphIpc` trong `main/index.ts`
    - Sửa `setupIPC()` trong `apps/desktop/src/main/index.ts` (sau khối Sync): tạo
      `new GraphClient(authManager, db)` và gọi `registerGraphIpc(graphClient)`
    - Giữ nguyên các đăng ký IPC hiện có; không đổi luồng khởi tạo khác
    - _Requirements: 7.1, 7.3, 9.1_

- [ ] 4. Store ghi renderer (state phản chiếu phản hồi backend)
  - [ ] 4.1 Cài đặt `renderer/store/knowledgeGraph.ts`
    - Tạo `apps/desktop/src/renderer/store/knowledgeGraph.ts` theo khuôn `agentWorkspace.ts`
    - State: `nodes`, `links`, `status: 'idle'|'loading'|'ready'|'empty'`
    - `refresh()` → `graph.list()` + `graph.links()`, set state từ phản hồi (3.3)
    - `createNode/updateNode/removeNode` → gọi IPC; sau ghi thành công cập nhật `nodes`
      **từ dữ liệu phản hồi backend** (id thật + trường trả về), không từ giá trị giả định client (3.1)
    - Ghi bị từ chối → giữ state nhất quán, không hiển thị thay đổi fail là thành công (3.4)
    - Feature-detect `window.electronAPI?.graph` thiếu → giữ rỗng, no-op (10.1); đọc field bằng own-property (9.3)
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 9.3, 10.1_

  - [ ]* 4.2 Viết unit test cho store (mock `window.electronAPI`)
    - Tạo `apps/desktop/src/renderer/store/knowledgeGraph.store.test.ts`
    - write thành công → state lấy id/trường từ phản hồi (3.1); `refresh()` → khớp list mock (3.3)
    - ghi trả `{error}` → state **không đổi** (3.4); thiếu `electronAPI.graph` → rỗng + no-op (6.3, 10.1)
    - _Requirements: 3.1, 3.3, 3.4, 6.3, 10.1_

- [ ] 5. Wire renderer vào dữ liệu thật (tối thiểu, giữ feature-detect)
  - [ ] 5.1 Sửa `renderer/pages/Knowledge.tsx` — field fix + dùng type chung
    - Đổi **đúng một** chỗ đọc trường ở nhánh thành công: `'type'` → `nodeType`
      (đọc bằng `Object.hasOwn(item,'nodeType') ? String(item.nodeType) : ...`)
    - Import `GraphNode` từ `shared/graph-types`, bỏ interface cục bộ lệch tên
    - Giữ nguyên feature-detect, empty-state, vòng lặp own-property, tên class `.knowledge-page*`
    - _Requirements: 1.6, 10.1, 10.2_

  - [ ]* 5.2 (Tuỳ chọn) Khai báo type `graph`/`memory` trong `renderer/types/global.d.ts`
    - Khai báo namespace `graph`/`memory` trên `window.electronAPI` thay cho `any`
    - Thuần cải thiện type-safety; build vẫn chạy nếu bỏ qua (không phải lõi Phase 1)
    - _Requirements: 7.4_

- [ ] 6. Mở rộng `Sync_Engine` (giữ nguyên hành vi cũ)
  - [ ] 6.1 Thêm bước refresh graph vào `main/sync/sync-engine.ts`
    - Trong `startSync()` (sau bước billing): gọi `graphClient.listNodes()` và cache qua
      `db.cacheUserData('graph_nodes','graph_nodes', ...)`
    - Giữ nguyên 5 bước profile/keys/usage/billing/refreshProfile và chu kỳ 5 phút
    - _Requirements: 5.3, 5.4, 10.3_

- [ ] 7. Checkpoint Phase 1 — build + test xanh + smoke chéo
  - Chạy `pnpm --filter @openclaw/desktop build` → 0 lỗi build mới so với baseline (10.4)
  - Chạy `pnpm --filter @openclaw/desktop test` (vitest run) → 0 thất bại mới, skip không
    tăng so với baseline (10.5)
  - Đề nghị người dùng làm smoke chéo thủ công: desktop tạo node → mở web `/aibase/graph`,
    reload → node xuất hiện (5.2). Nếu có vướng mắc, hỏi người dùng trước khi đi tiếp.
  - _Requirements: 5.2, 10.4, 10.5_

---

## Tasks — Phase 2 (HOÃN LẠI — toàn bộ đánh dấu `*`, không bắt buộc cho bản cài đầu tiên)

> Phase 2 là phần chống mất mạng, **bolt-on** lên hợp đồng IPC Phase 1 mà không reshape nó.
> Mọi sub-task dưới đây đánh dấu `*` để "run all" trên Phase 1 bỏ qua và vẫn cho ra bản
> build cài được. Triển khai Phase 2 ở spec/PR riêng khi sẵn sàng.

- [ ] 8. Logic hàng đợi offline thuần (module tách rời `shared/offline-queue.ts`)
  - [ ]* 8.1 Cài đặt `shared/offline-queue.ts` — hàm THUẦN
    - Tạo `apps/desktop/src/shared/offline-queue.ts`; type `QueueOp`
    - `coalesce(q)` — gộp update cùng node thành mới nhất; triệt tiêu cặp create-rồi-delete
      chưa tới BE thành không thao tác (Quy_Tắc_Hợp_Nhất)
    - `sendableLinkOps(q, knownNodeIds)` — chỉ chọn link op có cả 2 đầu resolve được
      (Bất_Biến_No_Orphan); giữ lại link tham chiếu node chưa khả dụng
    - `resolveConflict(localUpdatedAt, backendUpdatedAt)` — last-write-wins theo `updatedAt` BE
    - Không side-effect, không Electron, không mạng
    - _Requirements: 4.3, 4.4, 4.5, 4.7_

  - [ ]* 8.2 Property test — coalesce idempotent
    - Trong `apps/desktop/src/shared/offline-queue.test.ts`
    - **Property 2: Hợp nhất hàng đợi là idempotent** (`coalesce(coalesce(q)) == coalesce(q)`)
    - **Validates: Requirements 4.3, 11.2**
    - `fast-check` `{ numRuns: 100 }`, chú thích `// Feature: desktop-graph-backend-sync, Property 2: ...`

  - [ ]* 8.3 Property test — coalesce không tăng số thao tác
    - Trong `apps/desktop/src/shared/offline-queue.test.ts`
    - **Property 3: Hợp nhất không làm tăng số thao tác** (`len(coalesce(q)) <= len(q)`)
    - **Validates: Requirements 4.3, 11.3**
    - `fast-check` `{ numRuns: 100 }`, chú thích `// Feature: desktop-graph-backend-sync, Property 3: ...`

  - [ ]* 8.4 Property test — bất biến no-orphan
    - Trong `apps/desktop/src/shared/offline-queue.test.ts`
    - **Property 4: Bất biến no-orphan của hàng đợi** — mọi link op gửi đi có cả `sourceId`
      lẫn `targetId` resolve trong `K`; link tham chiếu node chưa khả dụng bị giữ lại
    - **Validates: Requirements 4.4, 4.7, 11.4**
    - `fast-check` `{ numRuns: 100 }`, chú thích `// Feature: desktop-graph-backend-sync, Property 4: ...`

- [ ] 9. Lưu bền hàng đợi trong SQLite
  - [ ]* 9.1 Thêm bảng `offline_queue` + helper vào `DatabaseManager`
    - Thêm `CREATE TABLE IF NOT EXISTS offline_queue (...)` + index `idx_offline_queue_seq`
      vào `ensureSqliteSchema` trong `apps/desktop/src/main/db/sqlite-schema.ts` (idempotent,
      theo khuôn bảng hiện có; không đổi schema cũ)
    - Thêm helper `enqueue` / `peek` / `dequeue` vào `apps/desktop/src/main/db/database.ts`
    - _Requirements: 4.1_

- [ ] 10. Tích hợp flush + phát hiện offline (không đổi hợp đồng IPC Phase 1)
  - [ ]* 10.1 Thêm bước flush hàng đợi vào `Sync_Engine`
    - Trong `main/sync/sync-engine.ts` `startSync()` thêm bước cuối: nếu online,
      `coalesce(queue)` → `sendableLinkOps` → gửi FIFO theo `seq` → áp `resolveConflict`
      khi BE trả `updatedAt` mới hơn; op nhắm node đã xoá trên BE → drop + ghi diagnostic
    - Giữ nguyên 5 bước sync cũ + bước refresh graph (6.1) + chu kỳ 5 phút
    - _Requirements: 4.2, 4.5, 4.6_

  - [ ]* 10.2 Wire phát hiện offline vào `GraphClient`
    - Trong `main/graph/graph-client.ts`: khi ghi thất bại vì offline (lỗi mạng) → `enqueue`
      thao tác thay vì trả `{error}`; giữ nguyên chữ ký `create/update/remove`
      (renderer không cần biết online/offline). Gợi ý `navigator.onLine` ở renderer; không health-check
    - _Requirements: 4.1_

## Notes

- Sub-task đánh dấu `*` là tuỳ chọn và **sẽ không** được tự động triển khai khi "run all":
  gồm test (1.3, 2.2, 4.2), việc tuỳ chọn (5.2) và **toàn bộ Phase 2** (8.x, 9.1, 10.x).
- "Run all" trên **mục 1–7** cho ra bản build cài được (Phase 1 online-first); Phase 2 bị bỏ qua.
- Mỗi task tham chiếu điều khoản requirement để truy vết; mỗi property test gắn số Property
  và các requirement nó kiểm.
- Property tests xác minh logic thuần (mapper round-trip; coalesce/no-orphan/LWW); unit test
  mock `fetch`/`AuthManager`/`electronAPI` cho HTTP và store; smoke chéo là kiểm thủ công.
- Không chạm backend `izzi-backend` (full CRUD đã có); không tạo endpoint mới; token chỉ ở
  Tiến_Trình_Chính, không qua cầu IPC.
- Checkpoint (mục 7) đảm bảo build + test xanh và xác nhận đồng bộ chéo trước khi coi Phase 1 là xong.

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1"] },
    { "id": 1, "tasks": ["1.2", "3.2"] },
    { "id": 2, "tasks": ["1.3", "2.1", "4.1"] },
    { "id": 3, "tasks": ["2.2", "3.1", "4.2", "5.1"] },
    { "id": 4, "tasks": ["3.3", "5.2", "6.1"] },
    { "id": 5, "tasks": ["8.1", "9.1"] },
    { "id": 6, "tasks": ["8.2", "10.2"] },
    { "id": 7, "tasks": ["8.3", "10.1"] },
    { "id": 8, "tasks": ["8.4"] }
  ]
}
```
