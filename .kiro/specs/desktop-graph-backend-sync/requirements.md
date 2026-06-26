# Requirements Document — Desktop Graph & Memory Backend Sync

## Introduction

Tài liệu này mô tả yêu cầu cho việc làm cho hai surface **Knowledge/Graph** và
**Context/Memory** của app desktop (`apps/desktop` — Electron + React 19 + Zustand,
"Starizzi / Izzi OpenClaw") dùng **chung một backend** với web izziapi.com làm
**nguồn sự thật duy nhất** (single source of truth). Thay đổi tạo trên desktop phải
hiện trên web sau khi làm mới (và ngược lại), và **không** được tạo một mô hình dữ liệu
graph riêng, lệch khỏi web.

Đây là phía **GHI (write)** của "second brain": spec `agent-workspace-redesign` (Req 10/11)
đã dựng phía **ĐỌC** chỉ-đọc cho Knowledge/Graph và Context/Memory với cơ chế
feature-detect (`window.electronAPI?.graph?.list?.()`, `window.electronAPI?.memory?.list?.()`).
Hai surface đó hiện **luôn rỗng** vì preload **chưa có** namespace `graph`/`memory`.
Khoảng trống cần lấp chính là: cầu IPC graph/memory + lời gọi backend ở tiến trình main +
đồng bộ state + hàng đợi offline.

### Sự thật nền đã kiểm chứng (ground truth — neo cho phase design)

Backend chung `izzi-backend/src/routes/aibase.ts` (Hono, mount tại `/api/aibase`, base
`https://api.izziapi.com`), xác thực `Authorization: Bearer <supabase-jwt>` →
`supabase.auth.getUser(token)` → phạm vi theo `user.id`, trả 401 nếu thiếu/sai token:

- `GET /api/aibase/nodes` — liệt kê node của người dùng (lọc theo user_id, mới nhất trước),
  trả `{ nodes: UserNode[] }`.
- `POST /api/aibase/nodes` — tạo node, yêu cầu `title` không rỗng, trả `{ node }`.
  Nhận: title, nodeType, color, content, url, topicId, x, y, metadata.
- `PATCH /api/aibase/nodes/:id` — sửa node của chính mình (trường cho phép: title, nodeType,
  color, content, url, x, y, topicId, isPublic, metadata), trả `{ ok: true }`.
- `DELETE /api/aibase/nodes/:id` — xoá node của mình + các link liên quan.
- `GET/POST /api/aibase/links`, `PATCH/DELETE /api/aibase/links/:id` — CRUD link.
- `GET /api/aibase/memory/list?limit=N` — liệt kê node-phiên bộ nhớ agent, trả `{ status, nodes }`.
- `GET /api/auth/me` — xác thực + trả hồ sơ.

**Kết luận: full CRUD đã tồn tại → KHÔNG cần thêm endpoint backend, KHÔNG đổi backend trong phạm vi này.**

Cấu phần desktop sẵn có cần **tái dùng** (không dựng lại):

- `apps/desktop/src/main/auth/auth-manager.ts` — `AuthManager.getAccessToken()` (tự làm mới
  5 phút trước khi hết hạn, lưu session qua `safeStorage`), đã gọi `${IZZI_API_BASE}/api/auth/me`
  với Bearer JWT. `IZZI_API_BASE = process.env.OPENCLAW_API_URL || 'https://api.izziapi.com'`.
- `apps/desktop/src/main/sync/sync-engine.ts` — `SyncEngine` đã build header
  `Authorization: Bearer ${token}`, gọi `${IZZI_API_BASE}/api/...`, đồng bộ theo chu kỳ 5 phút,
  ghi vào SQLite qua `db.cacheUserData(...)`. Đây là engine cần **mở rộng**, không tạo song song.
- `apps/desktop/src/main/preload.ts` — `electronAPI` (auth, sync, shell, system.buyApi…),
  **chưa có** `graph`/`memory` (đây là khoảng trống).
- `apps/desktop/src/main/db/database.ts` — `DatabaseManager` (getSetting/setSetting/deleteSetting,
  cacheUserData, appendDiagnosticEvent) — nơi lưu hàng đợi offline.
- `apps/desktop/src/renderer/pages/Knowledge.tsx`, `components/ContextPanel.tsx` — đã feature-detect.
- `apps/desktop/src/renderer/types/agent-memory.ts` — `MemoryItem` + `normalizeMemoryItems`
  (hàm thuần, own-property, lọc no-orphan) cho phía đọc.

### Phạm vi (In Scope)

- Bổ sung cầu IPC `electronAPI.graph.{list,create,update,remove}` (+ thao tác link) và
  `electronAPI.memory.list(agentId)`, với toàn bộ lời gọi HTTP nằm ở tiến trình main.
- Đọc/ghi graph node (CRUD) qua `/api/aibase/nodes` chung; đọc memory qua `/api/aibase/memory/list`.
- Đồng bộ state cục bộ theo phản hồi backend; mirror đúng `UserNode`/`UserLink`.
- Hàng đợi chỉnh sửa offline trong SQLite + flush khi online lại, với hợp nhất/triệt tiêu,
  bất biến no-orphan, và quy tắc xung đột last-write-wins theo `updatedAt`.
- Tái dùng `AuthManager` cho auth; tái dùng/mở rộng `SyncEngine` cho chu kỳ đồng bộ.
- Logic ánh xạ + hàng đợi là hàm thuần, kiểm thử bằng vitest + `fast-check` (property test).

### Phân pha (Phase 1 / Phase 2)

- **Phase 1 (online-first — lõi kiểm thử được):** cầu IPC `graph.{list,create,update,remove}` +
  `memory.list`; mọi HTTP ở Tiến_Trình_Chính qua Auth_Manager; state renderer phản chiếu phản hồi
  Backend_Chia_Sẻ; làm mới theo yêu cầu + poll 5 phút; mapper node/link là hàm thuần + property
  test round-trip; wire `Knowledge.tsx` + `ContextPanel` vào dữ liệu thật. Đây là phần người dùng
  cài + test đồng bộ chéo.
- **Phase 2 (chống mất mạng):** bảng hàng đợi SQLite + coalesce/no-orphan/LWW (hàm thuần) + flush
  khi online lại + property test.

### Phi mục tiêu (Out of Scope — ghi để tránh scope creep)

- **Thay đổi backend** (`izzi-backend`): full CRUD đã có nên không thêm endpoint, không sửa schema.
- **Cập nhật realtime trực tiếp** (Supabase realtime/subscription): bản này dùng làm-mới theo
  yêu cầu + chu kỳ `SyncEngine`; realtime để phase sau (xem "Quyết định mở").
- **UI sửa link đầy đủ**: bản này nodes là bề mặt chỉnh sửa chính; link được đồng bộ + lộ qua IPC
  (đủ để giữ no-orphan), nhưng UI biên tập link giàu tính năng để phase sau.
- Viết lại các surface không liên quan; đổi cơ chế auth; bật realtime ở tầng Electron.

## Glossary

- **Ứng_Dụng**: Tầng renderer của `apps/desktop` (React 19 + Vite + Electron, dark-only glass).
- **Tiến_Trình_Chính**: Tiến trình main của Electron — nơi giữ token và thực hiện mọi lời gọi
  HTTP tới Backend_Chia_Sẻ.
- **Backend_Chia_Sẻ**: API chung `/api/aibase/*` (và `/api/auth/me`) tại `https://api.izziapi.com`,
  nguồn sự thật duy nhất cho graph node, link và memory; xác thực bằng Supabase JWT theo `user.id`.
- **Auth_Manager**: Lớp `AuthManager` sẵn có (`main/auth/auth-manager.ts`); cung cấp
  `getAccessToken()` trả `Promise<string | null>`, tự làm mới token trước hạn 5 phút.
- **Sync_Engine**: Lớp `SyncEngine` sẵn có (`main/sync/sync-engine.ts`); chạy đồng bộ theo chu
  kỳ 5 phút và theo yêu cầu, dùng Bearer token từ Auth_Manager.
- **API_Graph**: Namespace IPC mới `electronAPI.graph` với `list`, `create`, `update`, `remove`
  (và thao tác link tương ứng) do preload phơi ra renderer.
- **API_Memory**: Namespace IPC mới `electronAPI.memory` với `list(agentId)`.
- **Mô_Hình_Node**: Cấu trúc node phản chiếu đúng `UserNode` của Backend_Chia_Sẻ:
  `{ id, title, nodeType, content?, url?, metadata?, color, parentId?, topicId?, x?, y?, createdAt, updatedAt }`.
- **Mô_Hình_Link**: Cấu trúc link phản chiếu đúng `UserLink`: `{ id, sourceId, targetId, label?, color? }`.
- **Mục_Bộ_Nhớ**: `MemoryItem` (`renderer/types/agent-memory.ts`): `{ id, title, source, createdAt }`.
- **Hàng_Đợi_Offline**: Hàng đợi bền các thao tác ghi chưa gửi được, lưu trong SQLite cục bộ.
- **Thao_Tác_Hàng_Đợi**: Một phần tử của Hàng_Đợi_Offline gồm tối thiểu: số thứ tự cục bộ (seq),
  loại (`create` | `update` | `delete`), đối tượng đích (node/link + id cục bộ hoặc id backend),
  payload trường thay đổi, và dấu thời gian.
- **Quy_Tắc_Hợp_Nhất**: Quy tắc gộp/triệt tiêu các Thao_Tác_Hàng_Đợi trước khi gửi (coalesce).
- **Quy_Tắc_Xung_Đột**: Quy tắc giải quyết khi hai phía cùng sửa một node — last-write-wins
  dựa trên `updatedAt` của Backend_Chia_Sẻ.
- **Bất_Biến_No_Orphan**: Mọi Thao_Tác_Hàng_Đợi cho link đều có node nguồn và node đích resolve
  được (đang tồn tại trên Backend_Chia_Sẻ hoặc cũng nằm trong Hàng_Đợi_Offline).

## Requirements

### Requirement 1: Đọc graph node từ Backend_Chia_Sẻ

**Phase: 1**

**User Story:** Là người dùng desktop, tôi muốn trang Knowledge/Graph hiển thị các node tri thức
của chính tôi lấy từ backend chung, để thấy đúng dữ liệu như trên web izziapi.com.

#### Acceptance Criteria

1. WHEN Ứng_Dụng gọi `API_Graph.list`, THE Tiến_Trình_Chính SHALL gọi
   `GET {IZZI_API_BASE}/api/aibase/nodes` kèm header `Authorization: Bearer <token>` lấy từ
   `Auth_Manager.getAccessToken()`.
2. WHEN Backend_Chia_Sẻ trả `{ nodes }`, THE Tiến_Trình_Chính SHALL ánh xạ mỗi phần tử sang
   Mô_Hình_Node và trả mảng Mô_Hình_Node về Ứng_Dụng qua `API_Graph.list`.
3. THE Mô_Hình_Node SHALL phản chiếu đúng cấu trúc `UserNode` gồm các trường id, title, nodeType,
   content, url, metadata, color, parentId, topicId, x, y, createdAt, updatedAt, và SHALL NOT thay
   bằng cấu trúc lệch khỏi `UserNode`.
4. IF `Auth_Manager.getAccessToken()` trả về null, THEN THE Tiến_Trình_Chính SHALL trả mảng rỗng
   cho `API_Graph.list` và SHALL NOT gọi Backend_Chia_Sẻ.
5. IF Backend_Chia_Sẻ trả mã lỗi hoặc lời gọi mạng thất bại, THEN THE Tiến_Trình_Chính SHALL trả
   mảng rỗng cho `API_Graph.list` và SHALL ghi một sự kiện chẩn đoán không chứa token.
6. WHEN Ứng_Dụng nhận mảng Mô_Hình_Node, THE Ứng_Dụng SHALL truy cập các trường bằng
   own-property/lookup tường minh, không đi theo prototype-chain.

### Requirement 2: Ghi create / update / delete node về Backend_Chia_Sẻ

**Phase: 1**

**User Story:** Là người dùng desktop, tôi muốn tạo, sửa, xoá node ngay trong tool và thay đổi
được lưu vào backend chung, để không phải mở web mới chỉnh sửa được.

#### Acceptance Criteria

1. WHEN Ứng_Dụng gọi `API_Graph.create` với một Mô_Hình_Node có `title` không rỗng, THE
   Tiến_Trình_Chính SHALL gọi `POST /api/aibase/nodes` kèm Bearer token và body gồm các trường
   Backend_Chia_Sẻ chấp nhận (title, nodeType, color, content, url, topicId, x, y, metadata).
2. IF Ứng_Dụng gọi `API_Graph.create` với `title` rỗng, THEN THE Tiến_Trình_Chính SHALL từ chối
   thao tác kèm một thông điệp lỗi mô tả và SHALL NOT gọi Backend_Chia_Sẻ.
3. WHEN Ứng_Dụng gọi `API_Graph.update` cho một node với tập trường thay đổi, THE Tiến_Trình_Chính
   SHALL gọi `PATCH /api/aibase/nodes/:id` kèm Bearer token và chỉ gửi các trường thuộc danh sách
   cho phép (title, nodeType, color, content, url, x, y, topicId, isPublic, metadata).
4. WHEN Ứng_Dụng gọi `API_Graph.remove` cho một node, THE Tiến_Trình_Chính SHALL gọi
   `DELETE /api/aibase/nodes/:id` kèm Bearer token.
5. THE Tiến_Trình_Chính SHALL dùng các endpoint `/api/aibase/*` hiện có cho mọi thao tác ghi và
   SHALL NOT tạo endpoint backend mới.
6. WHERE một thao tác ghi nhắm tới node hoặc link không thuộc người dùng hiện tại, THE
   Tiến_Trình_Chính SHALL truyền nguyên trạng kết quả của Backend_Chia_Sẻ (bao gồm trạng thái từ
   chối quyền) về Ứng_Dụng và SHALL NOT bỏ qua kiểm tra quyền do Backend_Chia_Sẻ thực thi.

### Requirement 3: Đồng bộ state cục bộ với phản hồi Backend_Chia_Sẻ

**Phase: 1**

**User Story:** Là người dùng, tôi muốn state hiển thị trong tool luôn khớp dữ liệu backend đã lưu,
để không thấy dữ liệu khác với web.

#### Acceptance Criteria

1. WHEN một thao tác ghi qua `API_Graph` được Backend_Chia_Sẻ chấp nhận, THE Ứng_Dụng SHALL cập
   nhật state cục bộ theo dữ liệu phản hồi của Backend_Chia_Sẻ (ví dụ id và các trường trả về sau
   create), không theo giá trị giả định phía client.
2. THE Ứng_Dụng SHALL coi Backend_Chia_Sẻ là nguồn sự thật duy nhất cho node và link, và SHALL NOT
   duy trì một mô hình dữ liệu graph riêng lệch khỏi Mô_Hình_Node và Mô_Hình_Link.
3. WHEN Ứng_Dụng làm mới danh sách node sau một thao tác ghi thành công, THE state hiển thị SHALL
   phản ánh đúng kết quả đã lưu trên Backend_Chia_Sẻ.
4. IF một thao tác ghi bị Backend_Chia_Sẻ từ chối, THEN THE Ứng_Dụng SHALL giữ state hiển thị nhất
   quán với trạng thái đã lưu trên Backend_Chia_Sẻ và SHALL NOT hiển thị thay đổi bị từ chối như
   đã thành công.

### Requirement 4: Hàng đợi chỉnh sửa offline và đồng bộ khi online lại

**Phase: 2**

**User Story:** Là người dùng, khi mất mạng tôi vẫn muốn chỉnh sửa được và các thay đổi tự đồng bộ
khi có mạng lại, để không mất việc.

#### Acceptance Criteria

1. WHERE Ứng_Dụng hỗ trợ chỉnh sửa offline, WHEN một thao tác ghi được thực hiện lúc không có kết
   nối tới Backend_Chia_Sẻ, THE Tiến_Trình_Chính SHALL thêm một Thao_Tác_Hàng_Đợi vào
   Hàng_Đợi_Offline lưu bền trong SQLite cục bộ.
2. WHEN kết nối tới Backend_Chia_Sẻ được khôi phục, THE Sync_Engine SHALL gửi (flush) các
   Thao_Tác_Hàng_Đợi theo thứ tự FIFO theo số thứ tự cục bộ.
3. THE Quy_Tắc_Hợp_Nhất SHALL gộp nhiều thao tác update đang chờ trên cùng một node thành trạng
   thái mới nhất, và SHALL triệt tiêu một cặp create-rồi-delete đang chờ trên cùng một node chưa
   từng tới Backend_Chia_Sẻ thành không thao tác.
4. WHERE một Thao_Tác_Hàng_Đợi cho link tham chiếu một node không tồn tại trên Backend_Chia_Sẻ và
   cũng không nằm trong Hàng_Đợi_Offline, THE Tiến_Trình_Chính SHALL chưa gửi thao tác link đó để
   giữ Bất_Biến_No_Orphan cho tới khi node nguồn và node đích khả dụng.
5. WHEN hai phía cùng sửa một node, THE Quy_Tắc_Xung_Đột SHALL áp dụng last-write-wins dựa trên
   trường `updatedAt` của Backend_Chia_Sẻ.
6. IF một Thao_Tác_Hàng_Đợi update nhắm tới một node đã bị xoá trên Backend_Chia_Sẻ, THEN THE
   Sync_Engine SHALL loại bỏ thao tác update đó và ghi một sự kiện chẩn đoán.
7. THE logic biến đổi Hàng_Đợi_Offline (thêm, hợp nhất, triệt tiêu, sắp thứ tự, kiểm no-orphan)
   SHALL là hàm thuần, không side-effect, để kiểm thử được độc lập với mạng.

### Requirement 5: Hiển thị chéo desktop ↔ web

**Phase: 1**

**User Story:** Là người dùng đa thiết bị, tôi muốn thay đổi trên desktop hiện ra trên web (và
ngược lại), để hai nơi luôn cùng một bức tranh.

#### Acceptance Criteria

1. THE Tiến_Trình_Chính và web izziapi.com SHALL ghi vào cùng tập dữ liệu của Backend_Chia_Sẻ
   (qua `/api/aibase/*`), sao cho không tồn tại hai nguồn dữ liệu graph tách biệt.
2. WHEN người dùng tạo, sửa hoặc xoá node trên desktop và thao tác được Backend_Chia_Sẻ chấp nhận,
   THE web izziapi.com SHALL hiển thị thay đổi đó sau khi web tải lại dữ liệu.
3. WHEN một node được thay đổi trên web, THE Ứng_Dụng SHALL hiển thị thay đổi đó sau lần làm mới
   kế tiếp của desktop (làm mới theo yêu cầu hoặc theo chu kỳ Sync_Engine).
4. THE Ứng_Dụng SHALL thực hiện đồng bộ bằng làm mới theo yêu cầu và theo chu kỳ Sync_Engine, và
   SHALL NOT phụ thuộc vào kênh cập nhật realtime trực tiếp trong phạm vi bản này.

### Requirement 6: Tái dùng auth/session hiện có

**Phase: 1**

**User Story:** Là chủ sản phẩm, tôi muốn tính năng dùng lại đúng cơ chế đăng nhập hiện có, để
không phát sinh luồng auth thứ hai khó bảo trì.

#### Acceptance Criteria

1. THE Tiến_Trình_Chính SHALL lấy access token cho mọi lời gọi `/api/aibase/*` qua
   `Auth_Manager.getAccessToken()` hiện có và SHALL NOT tạo cơ chế đăng nhập hay lưu trữ token mới.
2. WHERE Auth_Manager làm mới token trước hạn, THE Tiến_Trình_Chính SHALL dùng token đã làm mới
   cho lời gọi kế tiếp mà không yêu cầu người dùng đăng nhập lại.
3. IF người dùng chưa xác thực, THEN THE Ứng_Dụng SHALL hiển thị trạng thái rỗng chỉ-đọc cho
   Knowledge/Graph và Context/Memory và SHALL NOT lộ bất kỳ bề mặt ghi nào.
4. THE Tiến_Trình_Chính SHALL gửi token chỉ dưới dạng header `Authorization: Bearer` tới
   Backend_Chia_Sẻ qua HTTPS.

### Requirement 7: Cầu IPC graph + memory, token chỉ ở Tiến_Trình_Chính

**Phase: 1**

**User Story:** Là kỹ sư, tôi muốn renderer gọi được graph/memory qua một cầu IPC an toàn mà không
bao giờ thấy JWT, để giữ bảo mật token.

#### Acceptance Criteria

1. THE Tiến_Trình_Chính SHALL bổ sung namespace `electronAPI.graph` với các phương thức `list`,
   `create`, `update`, `remove` (và thao tác link tương ứng) qua cơ chế contextBridge /
   `ipcRenderer.invoke` hiện có.
2. THE Tiến_Trình_Chính SHALL bổ sung namespace `electronAPI.memory` với phương thức
   `list(agentId)`.
3. THE Tiến_Trình_Chính SHALL thực hiện toàn bộ lời gọi HTTP tới `/api/aibase/*` bên trong tiến
   trình main và SHALL NOT truyền JWT hay access token qua cầu IPC sang renderer.
4. THE Ứng_Dụng SHALL chỉ nhận Mô_Hình_Node, Mô_Hình_Link và Mục_Bộ_Nhớ (dữ liệu không nhạy cảm)
   qua cầu IPC, và SHALL NOT nhận token qua cầu IPC.
5. THE phương thức `API_Graph.list` SHALL khớp chữ ký mà `Knowledge.tsx` đang feature-detect
   (`graph.list()` trả mảng node), và `API_Memory.list` SHALL khớp chữ ký mà `ContextPanel.tsx`
   đang feature-detect (`memory.list(agentId)` trả mảng mục bộ nhớ).

### Requirement 8: Context/Memory đọc từ Backend_Chia_Sẻ

**Phase: 1**

**User Story:** Là người dùng, tôi muốn panel Ngữ cảnh hiển thị các phiên bộ nhớ agent của tôi từ
backend chung, để tiếp nối công việc với đúng ngữ cảnh.

#### Acceptance Criteria

1. WHEN Ứng_Dụng gọi `API_Memory.list(agentId)`, THE Tiến_Trình_Chính SHALL gọi
   `GET /api/aibase/memory/list?limit=N` kèm Bearer token và trả về mảng mục bộ nhớ.
2. THE Ứng_Dụng SHALL chuẩn hoá dữ liệu trả về bằng `normalizeMemoryItems` hiện có (own-property,
   lọc no-orphan theo `source`).
3. THE Ứng_Dụng SHALL hiển thị panel Context/Memory ở chế độ chỉ-đọc, chỉ gồm tiêu đề và nguồn,
   không secret và không PII.
4. IF nguồn dữ liệu bộ nhớ không khả dụng hoặc trả lỗi, THEN THE Ứng_Dụng SHALL hiển thị empty
   state hợp lệ và SHALL NOT bịa dữ liệu.

### Requirement 9: Bảo mật bề mặt graph/memory mới

**Phase: 1**

**User Story:** Là chủ sản phẩm, tôi muốn mọi bề mặt graph/memory mới tuân thủ security-baseline,
để không mở lỗ hổng ghi dữ liệu hay rò rỉ token.

#### Acceptance Criteria

1. THE Tiến_Trình_Chính SHALL NOT tạo bất kỳ bề mặt ghi dữ liệu nào ra Backend_Chia_Sẻ mà không
   qua xác thực (Bearer JWT) và hạn mức/billing như các surface `/api` khác.
2. THE Tiến_Trình_Chính SHALL giữ JWT và secret chỉ trong tiến trình main và SHALL NOT ghi token
   vào log, vào cache SQLite, hay vào sự kiện chẩn đoán.
3. THE Ứng_Dụng và Tiến_Trình_Chính SHALL truy cập trường trên dữ liệu trả về bằng
   own-property/lookup tường minh, không đi theo prototype-chain.
4. THE Tiến_Trình_Chính SHALL NOT ghi nội dung node hoặc memory kèm danh tính người dùng vào
   memory graph của agent hay Obsidian vault; dữ liệu chỉ dùng tại runtime.
5. IF Backend_Chia_Sẻ trả 401 (token thiếu hoặc không hợp lệ), THEN THE Tiến_Trình_Chính SHALL
   fail-closed bằng cách từ chối thao tác ghi, và SHALL NOT thử lại bằng đường vòng không xác thực.

### Requirement 10: Không hồi quy

**Phase: 1**

**User Story:** Là người dùng, tôi muốn tính năng mới không phá hành vi, feature-detect, kiểm thử
hay UI hiện có, để mọi thứ cũ vẫn chạy.

#### Acceptance Criteria

1. WHERE `electronAPI.graph` hoặc `electronAPI.memory` không khả dụng, hoặc người dùng chưa đăng
   nhập, THE Ứng_Dụng SHALL giữ nguyên hành vi empty-state feature-detect hiện có của
   `Knowledge.tsx` và `ContextPanel.tsx`.
2. THE Ứng_Dụng SHALL giữ nguyên các tên class `.aw-context*` và `.knowledge-page*` cùng token UI
   từ spec agent-workspace-redesign; IF một tên class buộc phải đổi, THEN THE Ứng_Dụng SHALL cập
   nhật mọi nơi tham chiếu sao cho số tham chiếu mồ côi bằng 0.
3. THE Sync_Engine SHALL giữ nguyên hành vi đồng bộ hiện có (profile, keys, usage, billing; chu kỳ
   5 phút) khi bổ sung đồng bộ graph và hàng đợi.
4. WHEN dự án được build sau thay đổi, THE Ứng_Dụng SHALL build thành công không phát sinh lỗi
   build mới so với baseline.
5. WHEN bộ kiểm thử hiện có được chạy sau thay đổi, THE Ứng_Dụng SHALL giữ mọi kiểm thử trước đây
   đạt vẫn đạt, với 0 thất bại mới và số test bị skip không tăng so với baseline.

### Requirement 11: Khả năng kiểm chứng

**Phase: 1 & 2** (round-trip 11.1/11.5/11.6 = Phase 1; queue-logic 11.2/11.3/11.4 = Phase 2)

**User Story:** Là người rà soát, tôi muốn xác minh logic đồng bộ và hàng đợi bằng test thuần, để
chắc chắn đúng mà không cần mạng thật.

#### Acceptance Criteria

1. THE logic ánh xạ giữa `UserNode` của Backend_Chia_Sẻ và Mô_Hình_Node cùng payload ghi SHALL là
   hàm thuần và SHALL thoả thuộc tính round-trip: ánh xạ node JSON → Mô_Hình_Node → payload →
   Mô_Hình_Node cho ra giá trị tương đương trên các trường được giữ.
2. THE Quy_Tắc_Hợp_Nhất SHALL thoả thuộc tính idempotence: hợp nhất hai lần cho cùng kết quả như
   hợp nhất một lần (`coalesce(coalesce(q)) == coalesce(q)`).
3. THE Quy_Tắc_Hợp_Nhất SHALL thoả thuộc tính metamorphic: số thao tác sau hợp nhất không lớn hơn
   số thao tác trước hợp nhất (`len(coalesce(q)) <= len(q)`).
4. THE Bất_Biến_No_Orphan của Hàng_Đợi_Offline SHALL kiểm chứng được: với mọi thao tác link sẽ
   gửi, cả node nguồn và node đích đều resolve được (đang tồn tại trên Backend_Chia_Sẻ hoặc cũng
   nằm trong hàng đợi).
5. THE bộ kiểm thử SHALL dùng vitest, và các thuộc tính tại Acceptance Criteria 1–4 SHALL được
   kiểm bằng property-based testing theo quy ước repo (`fast-check`, `{ numRuns: 100 }`), với chú
   thích dạng `// Feature: desktop-graph-backend-sync, Property N: ...`.
6. WHERE một hành vi cần mạng thật hoặc dịch vụ ngoài, THE bộ kiểm thử SHALL dùng mock hoặc
   integration test với 1–3 ví dụ đại diện thay vì property test 100 vòng.

## Quyết định đã chốt (council)

1. **Đồng bộ:** refresh theo yêu cầu + chu kỳ Sync_Engine (5 phút). Realtime/subscription để
   phase sau.
2. **Xung đột:** last-write-wins ở mức node theo `updatedAt` của Backend_Chia_Sẻ (field-level
   merge để phase sau).
3. **Lưu hàng đợi offline:** bảng SQLite mới (migration ở `main/db/migrations.ts`) — thuộc Phase 2.
4. **Phạm vi link:** Phase 1 chỉ đồng bộ + lộ link qua IPC để giữ no-orphan; UI biên tập link đầy
   đủ để phase sau.
5. **Phát hiện online/offline:** dựa trên kết quả `fetch` (lỗi mạng ⇒ offline) + gợi ý
   `navigator.onLine`; không thêm health-check định kỳ.
