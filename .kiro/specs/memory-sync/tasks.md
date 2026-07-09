# Memory Sync — Tasks

## Phase 1 — Đọc hợp nhất (desktop-only)
- [ ] 1.1 Preload: đảm bảo `memory.list(limit?)` expose cho renderer (feature-detect).
- [ ] 1.2 Store `agentWorkspace`: thêm `izziMemories` + `refreshIzziMemories()` (gọi `memory.list`); không đụng `memories` local.
- [ ] 1.3 Memory page: nhóm "Trên izzi (chung)" + "Cục bộ (thiết bị này)"; trạng thái tải/trống/chưa-đăng-nhập/lỗi gọn gàng.
- [ ] 1.4 Verify: build + test + diagnostics + security-review; smoke (đăng nhập → thấy memory izzi; offline → degrade).
- [ ] 1.5 (tùy chọn) Release increment nhỏ.

## Phase 2 — Ghi + agent write-loop (chờ chốt endpoint)
- [ ] 2.0 Chốt endpoint memory-write Bearer: (a) xác nhận izzi-backend, hoặc (b) thêm vào repo web.
- [ ] 2.1 GraphClient: `createMemory` / `setMemoryPinned` / `removeMemory` (Bearer).
- [ ] 2.2 IPC + preload: `memory:create` / `memory:setPinned` / `memory:remove`.
- [ ] 2.3 Memory page: ghim/xóa/tạo memory izzi (gọi IPC mới); cập nhật lạc quan + refresh.
- [ ] 2.4 Agent write-loop: host-agent chắt lọc cuối lượt → `createMemory(source='agent')` (ngưỡng bảo thủ, không secret/PII).
- [ ] 2.5 Offline queue + LWW (tái dùng sync-engine).
- [ ] 2.6 Verify + security-review + Socrates gate + release.

## Trạng thái
- Phase 1: sẵn sàng làm (khả thi trong repo desktop).
- Phase 2: chờ chốt 2.0 (quyền/xác nhận izzi-backend, hoặc mở repo web để thêm Bearer memory API).
