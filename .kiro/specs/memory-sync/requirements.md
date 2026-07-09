# Memory Sync — Requirements

> Mục tiêu: hợp nhất tab **Recall library (Memory)** của Starizzi với bộ nhớ izzi tại
> `izziapi.com/aibase/memory` để hiện thực "một bộ não, nhiều bề mặt". Làm theo pha:
> Phase 1 chỉ trong repo desktop (đọc-hợp-nhất, rủi ro thấp); Phase 2 thêm ghi + agent
> write-loop (phụ thuộc endpoint backend qua Bearer).

## Bối cảnh (đã điều tra)
- **Local**: bảng SQLite `agent_memories` (`AgentMemory {id, sessionId?, kind: fact|preference|constraint|resource, content, pinned}`) — tab Memory đang hiển thị cái này.
- **izzi**: bảng Postgres `kb_memory_nodes` (`{id, ownerId, content, kind: semantic|episodic|preference, pinned, source, metadata, timestamps}`) — trang web `/aibase/memory` đọc cái này.
- Desktop **đã đọc được** memory izzi qua IPC `memory:list` → `GraphClient.listMemory()` → `GET api.izziapi.com/api/aibase/memory/list` (Bearer JWT). Hiện chỉ ContextPanel dùng, **Memory page thì không**.
- `/api/dochub/memory` (web) là CRUD đầy đủ nhưng auth **cookie session** → desktop (Bearer) không gọi thẳng được.

## Requirements

### R1 — Đọc hợp nhất (Phase 1)
- WHEN mở tab Recall library, hệ thống SHALL hiển thị memory izzi của người dùng (từ `memory:list`) để desktop và web thấy cùng một bộ não.
- Hệ thống SHALL phân biệt rõ **"Trên izzi (chung)"** vs **"Cục bộ (thiết bị này)"**.
- IF chưa đăng nhập / offline / lỗi, hệ thống SHALL degrade mượt (hiện phần local + ghi chú), không vỡ UI.

### R2 — Ghi lên izzi (Phase 2)
- WHEN người dùng ghim/xóa/tạo một memory izzi, thay đổi SHALL phản ánh trên cả desktop lẫn web.
- Agent SHALL chắt lọc và ghi memory quan trọng của lượt làm việc lên izzi (**agent write-loop**) để công việc của agent gia nhập bộ não chung.

### NFR (bảo mật + tin cậy)
- Mọi lệnh gọi izzi phải xác thực (Bearer JWT), **JWT chỉ ở main**, không lộ ra renderer, không log.
- Fail-closed: token lỗi/thiếu → không ghi, hiện trạng thái rõ.
- Không ghi secret/PII vào memory.
- Offline: hàng đợi + "ghi sau thắng" (tái dùng pattern SyncEngine đã có cho graph nodes).

## Phụ thuộc cần chốt (Phase 2)
Cần một endpoint memory **WRITE qua Bearer**. Chọn 1:
- (a) Xác nhận `api.izziapi.com/api/aibase/memory` đã có POST/PATCH/DELETE qua Bearer (repo izzi-backend — chưa truy cập được).
- (b) Thêm API memory Bearer vào repo web izziapi.com (đọc/sửa được) trên `kb_memory_nodes`.
