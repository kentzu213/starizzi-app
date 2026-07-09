# Memory Sync — Design

## Nguyên tắc (đã qua Socrates gate)
- **izzi `kb_memory_nodes` là nguồn chuẩn cho tri thức CHUNG**. Nhưng **local `agent_memories` KHÔNG phải cache của izzi** — hai store khác bản chất (local: fact/preference/constraint/resource, theo session; izzi: semantic/episodic/preference, theo owner). P1 chỉ **hợp nhất ở tầng hiển thị**; không coi local là cache có thể xóa cho tới khi có migrate tường minh (chống mất dữ liệu).
- Một bộ não, nhiều bề mặt: desktop + web đọc/ghi cùng store izzi (second-brain rule).
- JWT ở main; renderer chỉ nhận dữ liệu thuần (đúng pattern GraphClient hiện có).
- Preload **đã có** `memory.list(agentId, limit?)` → dùng đúng chữ ký này.

## Phase 1 — Đọc hợp nhất (desktop-only, khả thi ngay)
Tái dùng đường đã chạy được: IPC `memory:list` → `GraphClient.listMemory()` (Bearer).

- **Preload**: expose `memory.list(limit?)` cho renderer (nếu chưa có wrapper) — feature-detect.
- **Store (agentWorkspace)**: thêm state `izziMemories: MemoryItemDTO[]` + `izziMemoryState: 'idle'|'loading'|'ready'|'signed-out'|'error'` + action `refreshIzziMemories()` gọi `memory.list(agentId?, limit?)`. Không đụng `memories` (local) hiện có.
  - **Trạng thái suy từ auth, KHÔNG suy từ mảng rỗng** (Socrates fix): chưa đăng nhập → `signed-out`; gọi lỗi → `error`; trả mảng (kể cả rỗng) → `ready` (rỗng thì hiện "chưa có"). `listMemory` fail-closed về `[]` nên phải dùng tín hiệu auth để phân biệt signed-out vs trống.
- **Memory page**: hai nhóm rõ ràng —
  - **"Trên izzi (chung)"**: từ `izziMemories` (id, title, source, createdAt). Chỉ đọc ở P1.
  - **"Cục bộ (thiết bị này)"**: `memories` local (Pinned/Recent) như hiện tại.
  - Trạng thái: loading / signed-out / error / trống → ghi chú gọn, không vỡ.
- **Không** đổi schema, không đổi luồng ghi. Rủi ro thấp, gói gọn trong repo desktop.

`MemoryItemDTO = { id, title, source, createdAt }` (đã có sẵn ở shared/graph-types).

## Phase 2 — Ghi + agent write-loop (phụ thuộc endpoint Bearer)
- **GraphClient**: thêm `createMemory({content, kind?, source?})`, `setMemoryPinned(id, pinned)`, `removeMemory(id)` → gọi endpoint Bearer đã chốt (a hoặc b ở requirements). Trả `MemoryItemDTO`/ok.
- **IPC**: `memory:create` / `memory:setPinned` / `memory:remove` (JWT ở main).
- **Agent write-loop**: cuối lượt host-agent, chắt lọc 0–2 memory "đáng nhớ" (fact/quyết định) → `createMemory(source='agent')`. Ngưỡng bảo thủ để tránh nhiễu; không ghi secret/PII.
- **Map kind**: local `fact→semantic`, `preference→preference`, `constraint/resource→` giữ trong `metadata`.
- **Offline**: enqueue khi mất mạng, flush + LWW (tái dùng `sync-engine` pattern).

## Không làm (giữ surgical)
- Không migrate `agent_memories` cũ lên izzi tự động ở P1.
- Không đổi trang web `/aibase/memory`.
- Không đụng billing/model routing.

## Cửa Phase 2 (Socrates gate — phải thỏa trước khi mở)
- Ưu tiên **(a)**: thêm memory-write vào chính backend `/api/aibase/memory` (Bearer). KHÔNG chọn (b) ghi song song từ web repo lên `kb_memory_nodes` (fork write, vi phạm second-brain) — trừ khi (b) là proxy về backend.
- Owner-scoping phía server: create/pin/delete kiểm `ownerId = user.id` từ token, không tin client.
- Agent write-loop (rủi ro cao nhất): phải có **redaction/allowlist cụ thể chặn secret/PII** TRƯỚC khi auto-ghi (không chỉ nêu nguyên tắc).
- Kiểm backend đã có vòng ghi memory chưa (tham chiếu cũ: `agentMemoryLoop.ts`/`proceduralMemory.ts`) để không dựng trùng; định nghĩa map kind lossy trước khi migrate.
- Chốt route đúng: `/api/memory` vs `/api/dochub/memory` khi vào P2.
- Chưa verify được (source backend/web không trên đĩa): shape `GET /memory/list`, schema `kb_memory_nodes`, backend có sẵn write/loop chưa.
