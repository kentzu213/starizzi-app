# Implementation Plan: iOS 26 Glass Redesign

## Overview

Cách tiếp cận triển khai theo **Phương án B — "Token + Hợp nhất toàn bộ"**: dựng nền từ Hệ_Token (Lớp 1) → Bộ_Class_Glass (Lớp 2) → hợp nhất ba Stylesheet_Lệch và class theo domain (Lớp 3) → đồng bộ TSX của 15 Màn_Hình + 16 Component_Chung (Lớp 4) → chốt bằng kiểm chứng (checklist, tìm kiếm văn bản, test hồi quy điều hướng/cấu hình Electron).

Ngôn ngữ triển khai: **TypeScript + CSS** (renderer của `apps/desktop`), test bằng **Vitest** (`pnpm test` = `vitest run`, chạy một lần) và **fast-check** cho property test.

Mỗi bước xây trên bước trước và kết nối với nhau; không để lại mã mồ côi. Các thay đổi index.css được xếp ở các wave khác nhau để tránh xung đột ghi cùng tệp.

## Tasks

- [x] 1. Dựng nền Hệ_Token glass iOS 26
  - [x] 1.1 Bổ sung Token_Glass vào khối `:root` trong `apps/desktop/src/renderer/styles/index.css`
    - Khai báo: `--glass-blur-amount` (∈ [12,24]px), `--glass-blur` = `blur(min(var(--glass-blur-amount), 24px))` (kẹp ≤24px), `--glass-bg` (đủ đục để chữ cấp một đạt ≥4.5:1 trên nền tối nhất), `--glass-border`, `--glass-specular` (inset highlight, luminance > `--glass-bg`), `--glass-shadow` (≥2 lớp, mỗi lớp khác cặp offset/blur), `--radius-glass-lg` (∈ [20,32]px), `--radius-glass-sm` (∈ [8,16]px, luôn < lg)
    - Xác nhận `--color-accent-gradient` dựa trên cyan `#67e8f9` + purple `#a78bfa`; bổ sung token accent phụ (vd `--color-accent-purple-soft`) cần cho bước hợp nhất Stylesheet_Lệch
    - Không xóa token cũ đang được tham chiếu; mọi tham chiếu token dùng cú pháp `var(--token, <fallback>)`
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7, 3.5, 7.4, 8.5_

  - [x] 1.2 Viết unit + edge test cho Token_Glass
    - Parse `:root`; assert blur ∈ [12,24]; `--radius-glass-sm` ∈ [8,16]; `--radius-glass-lg` ∈ [20,32] và sm < lg; `--glass-shadow` có ≥2 lớp với cặp (offset,blur) đôi một khác; luminance(specular) > luminance(glass-bg); gradient chứa cả `#67e8f9` và `#a78bfa`; mọi `var(--glass-*)` có fallback
    - Edge case kẹp blur: 12→12, 24→24, 30→24, 100→24
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.7, 7.4_

- [x] 2. Tạo Bộ_Class_Glass dùng chung
  - [x] 2.1 Định nghĩa `glass-surface`, `glass-card`, `glass-panel` trong `index.css`
    - Đúng ba class, đặt tên kebab-case theo quy ước hiện có
    - Mọi thuộc tính nền/blur/viền/bo góc/shadow/specular tham chiếu Token_Glass, không literal nằm ngoài `var()`
    - `glass-panel` dùng nền token đặc, **không** `backdrop-filter` (bề mặt tĩnh — Req 7.3); `glass-surface`/`glass-card` dùng `backdrop-filter`
    - _Requirements: 2.1, 2.2, 2.3, 2.8, 7.3_

  - [x] 2.2 Viết unit test cho Bộ_Class_Glass
    - Assert tồn tại đúng 3 class; mỗi thuộc tính kính dùng `var(--token)`; 0 literal màu/blur/radius/shadow ngoài `var()`; tên kebab-case
    - _Requirements: 2.1, 2.2, 2.3, 2.8_

  - [x] 2.3 Viết property test tương phản chữ trên nền kính
    - Thêm `fast-check` (devDependency) + hàm thuần `compositeOver(base, glassBg)` (alpha compositing) và `wcagContrast(fg, bg)` (WCAG 2.1)
    - Sinh độ sáng nền `L` ∈ [0, Lmax] và cỡ chữ `s ∈ {thường, lớn}`; tổng hợp `--glass-bg` lên `L`, assert tỷ lệ ≥ 4.5 (thường) / ≥ 3.0 (lớn); `numRuns: 100`
    - Tag: `Feature: ios26-glass-redesign, Property 1: Tương phản chữ trên nền kính đạt ngưỡng WCAG trên toàn dải nền`
    - **Property 1: Tương phản chữ trên nền kính đạt ngưỡng WCAG trên toàn dải nền**
    - **Validates: Requirements 8.1, 8.2, 8.3, 8.4, 8.5**

- [x] 3. Hợp nhất các Stylesheet_Lệch về Hệ_Token
  - [x] 3.1 Hợp nhất `apps/desktop/src/renderer/styles/agent-store.css`
    - Ánh xạ một-một mọi hex/rgba bảng slate/indigo (`#1e293b`, `#0f172a`, `#334155`, `#475569`, `#64748b`, `#6366f1`, `#3b82f6`, `#8b5cf6`, …) sang token tương ứng; accent định tuyến về token cyan/purple thương hiệu
    - Bề mặt kính cục bộ (`.agent-modal`, `.model-selector__dropdown`, `.agent-picker`…) dùng Token_Glass / Bộ_Class_Glass thay khai báo nền+blur cục bộ; không đổi selector
    - _Requirements: 3.1, 3.2, 3.4_

  - [x] 3.2 Hợp nhất `apps/desktop/src/renderer/styles/agent-hub.css`
    - Thay literal cyan `#67e8f9` và thang `rgba(255,255,255,x)` bằng token; accent qua token
    - _Requirements: 3.1, 3.2, 3.4_

  - [x] 3.3 Hợp nhất `apps/desktop/src/renderer/styles/agent-gateway.css`
    - Áp dụng cùng bảng ánh xạ literal → token; bề mặt kính dùng Token_Glass / Bộ_Class_Glass
    - _Requirements: 3.1, 3.2, 3.4_

  - [x] 3.4 Viết test kiểm chứng tìm kiếm văn bản trên ba Stylesheet_Lệch
    - Grep không phân biệt hoa/thường 8 hex slate/indigo trên 3 tệp ⇒ tổng = 0; đếm hex/rgba nằm ngoài tham chiếu token = 0
    - _Requirements: 3.3, 3.5, 10.1_

- [x] 4. Checkpoint - nền token, Bộ_Class_Glass và hợp nhất stylesheet
  - Ensure all tests pass, ask the user if questions arise.

- [x] 5. Chuẩn bị class trình bày dùng chung cho việc gỡ inline
  - [x] 5.1 Bổ sung class trình bày dùng chung vào `index.css`
    - Tạo các class tham chiếu token cho những Inline_Style_Trình_Bày đã biết (vd `.btn--accent` dùng `--color-accent-gradient`, helper nền cho `Login`/surface), để bước đồng bộ TSX chỉ gắn `className`
    - Token-only, không literal; mọi thay đổi class dùng chung cho index.css gom về task này (TSX task chỉ sửa `.tsx`)
    - _Requirements: 4.1, 4.3_

- [x] 6. Đồng bộ TSX của Màn_Hình và Component_Chung (gắn Bộ_Class_Glass, gỡ Inline_Style_Trình_Bày, thay literal → token, giữ nguyên tên class bị JS/TSX tham chiếu)
  - [x] 6.1 Đồng bộ Component_Chung khung/chrome
    - Tệp: `Sidebar`, `TitleBar`, `AgentTabBar`, `AgentStatusBadge`, `AppIcons`, `Skeleton`, `ErrorBoundary`, `UpdateBanner`, `UpdateNotification`, `PermissionDialog`, `AgentSetupPanel` (trong `apps/desktop/src/renderer/components/`)
    - Áp class từ Bộ_Class_Glass cho bề mặt panel/card/bar/dialog theo Bảng phân loại bề mặt; gỡ Inline_Style_Trình_Bày; giữ Inline_Style_Động và thay mọi giá trị màu/nền bằng `var(--token)`; nếu buộc đổi tên class thì cập nhật mọi nơi tham chiếu (0 tham chiếu mồ côi); component dùng cùng token/class ở mọi Màn_Hình
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 6.1, 6.2, 6.5, 6.6, 9.4_

  - [x] 6.2 Đồng bộ nhóm Auth & Onboarding
    - Tệp: `Login`, `SetupWizard` (pages), `OnboardingWizard` (component)
    - Gắn `glass-card`/`glass-panel`; gỡ inline trình bày (vd `Login` `rgba(255,255,255,0.06)` → token); giữ `SetupWizard` `width:${percent}%` dạng động
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 5.1, 5.4, 6.1, 6.2, 6.5, 6.6, 9.4_

  - [x] 6.3 Đồng bộ nhóm Chat
    - Tệp: `Chat` (page), `ChatComposer`, `ChatEmptyState`, `ChatMessageList`, `ModelSelector` (components)
    - Áp Bộ_Class_Glass cho composer/message/dropdown surface; gỡ inline trình bày; giữ Inline_Style_Động
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 5.1, 5.4, 6.1, 6.2, 6.5, 6.6, 9.4_

  - [x] 6.4 Đồng bộ nhóm Marketplace & Store
    - Tệp: `Marketplace`, `Extensions`, `ExtensionDetail`, `DeveloperDashboard`, `DeveloperUpload`, `AgentStore` (pages/sub-view)
    - Chuyển khối inline đậm đặc (`Extensions.tsx`≈26, `Marketplace.tsx`≈22, `DeveloperDashboard.tsx`≈10) sang class/token (vd nút gradient → `.btn--accent`); giữ `animationDelay:${i*60}ms` dạng động
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 5.1, 5.4, 9.4_

  - [x] 6.5 Đồng bộ nhóm Dashboard & Settings
    - Tệp: `Tasks`, `Memory`, `Status`, `Dashboard`, `CostDashboard`, `Settings` (pages)
    - Áp `glass-card`/`glass-panel`; gỡ inline trình bày; thay literal màu → token
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 5.1, 5.4, 9.4_

- [x] 7. Gỡ khối glass cục bộ trùng lặp khỏi selector domain
  - [x] 7.1 Gỡ thuộc tính kính lặp ở `.stat-card`, `.card`, `.ext-card`, `.login-card` (index.css) và `.agent-card`, `.agent-hub__top-card` (agent-store.css / agent-hub.css)
    - Sau khi TSX đã kết hợp class Bộ_Class_Glass, gỡ `background/backdrop-filter/border/border-radius/box-shadow` kính khỏi các selector domain, giữ thuộc tính bố cục (`padding`, `display`, `grid`…) — hoàn tất trạng thái `DaDongBo`
    - _Requirements: 2.4, 2.5, 2.6, 2.7_

- [x] 8. Checkpoint - đồng bộ TSX và gỡ glass cục bộ
  - Ensure all tests pass, ask the user if questions arise.

- [x] 9. Kiểm chứng tình trạng đồng bộ và chốt hồi quy
  - [x] 9.1 Hiện thực checklist Tiêu_Chí_Đồng_Bộ + logic gate
    - Tạo module dữ liệu checklist liệt kê đủ 15 Màn_Hình + 16 Component_Chung và hàm thuần `evaluate(criterion)` trả `DaDongBo ⟺ a∧b∧c∧d`, kèm `failingConditions`; phạm vi hoàn tất ⟺ mọi mục trong 31 mục `DaDongBo`
    - _Requirements: 5.2, 5.3, 5.5, 6.3, 6.4, 10.3, 10.4, 10.5_

  - [x] 9.2 Viết unit test logic gate checklist
    - `DaDongBo` ⟺ bốn điều kiện đều đạt; khi ≥1 Fail thì `ChuaDongBo` và liệt kê đúng điều kiện chưa thỏa; hoàn tất ⟺ 31/31 mục `DaDongBo`
    - _Requirements: 5.3, 5.5, 6.4, 10.4, 10.5_

  - [x] 9.3 Viết test hồi quy bản đồ điều hướng
    - Assert tập `Page` và mọi cặp (thao tác kích hoạt → trang đích) trong `App.tsx` khớp baseline
    - _Requirements: 9.1_

  - [x] 9.4 Viết test bảo toàn cấu hình cửa sổ Electron
    - Đọc `apps/desktop/src/main/index.ts`, assert giữ `frame: false`, `titleBarStyle: 'hidden'`, không bật `vibrancy`/`transparent`
    - _Requirements: 9.7_

  - [x] 9.5 Viết test kiểm chứng inline còn lại và tham chiếu class
    - Liệt kê mọi `style={{` còn lại trong 15 page + 16 component, assert từng vị trí là Inline_Style_Động (không chứa hex/`rgb()`/`linear-gradient`); grep tên class dùng trong `classList`/`querySelector`/`className` ⇒ 0 tham chiếu mồ côi
    - _Requirements: 9.4, 10.2_

  - [x] 9.6 Viết test ngân sách lớp blur
    - Render từng Màn_Hình, duyệt cây DOM đếm độ sâu lồng `backdrop-filter` ≤ 3
    - _Requirements: 7.2_

- [x] 10. Checkpoint cuối - build & bộ kiểm thử hồi quy
  - Ensure all tests pass, ask the user if questions arise. Chạy `pnpm build` và `pnpm test` (vitest run) trong `apps/desktop`: build thành công không lỗi mới (Req 9.5), bộ test hiện có 0 fail mới và skip không tăng (Req 9.6), hành vi thao tác không đổi (Req 9.2, 9.3).

## Notes

- Tasks gắn `*` là optional (test) và có thể bỏ qua khi cần MVP nhanh; các task không gắn `*` là core và phải triển khai.
- Mỗi task tham chiếu các clause yêu cầu cụ thể để truy vết.
- Checkpoint đảm bảo kiểm chứng tăng tiến; property test xác thực tính chất tương phản phổ quát; unit test xác thực ví dụ và biên.
- **Ngoài phạm vi task code (kiểm chứng thủ công)**: FPS ≥55 khi cuộn/chuyển màn (Req 7.1, 7.5) cần profiler thủ công trên cấu hình tham chiếu; "trực quan không đổi" (Req 4.6) cần so sánh snapshot/thị giác thủ công trước/sau. Lệnh chạy lâu (dev server, watch) do người dùng tự chạy trong terminal.
- Token accent phụ chỉ thêm khi ánh xạ hợp nhất thực sự thiếu (Req 3.5/4.5); mọi token bổ sung khai báo ở `:root` (task 1.1) trước khi coi là hoàn tất.

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1"] },
    { "id": 1, "tasks": ["1.2", "2.1", "3.1", "3.2", "3.3"] },
    { "id": 2, "tasks": ["2.2", "2.3", "3.4", "5.1"] },
    { "id": 3, "tasks": ["6.1", "6.2", "6.3", "6.4", "6.5"] },
    { "id": 4, "tasks": ["7.1"] },
    { "id": 5, "tasks": ["9.1", "9.3", "9.4", "9.5", "9.6"] },
    { "id": 6, "tasks": ["9.2"] }
  ]
}
```
