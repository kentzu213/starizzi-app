# Architecture Selection: settings-redesign

## Recommended Architecture: Candidate A — Section-oriented + Tab navigation

### Rationale
Candidate A đạt flow density thấp (0.196) với god object score thấp và cross-cutting invariants chỉ ~33%: mỗi cụm invariant đóng kín trong đúng một component — updater (INV-4/5/6) sống trọn trong `UpdatesSection`, điều hướng (INV-2/3) sống trọn trong `SettingsPage`. Nó tái dùng trực tiếp tab pattern (`ext-detail__tab`) và các class settings/card sẵn có nên thay đổi vẫn surgical, không phát sinh design system mới. Đánh đổi chính: container `SettingsPage` có fan-out = 7 (đặc trưng của một component điều phối) và phải tách thêm vài component con so với hiện trạng một file. Nếu cần bảo chứng tuyệt đối cho việc không bao giờ đổi store/electronAPI và khả năng test tách tầng, Candidate B (Gateway persistence) sẽ phù hợp hơn với cái giá thêm một tầng có thể thừa.

### Components
| Component | Owned State | Responsibility |
|-----------|-------------|----------------|
| `SettingsPage` (container) | `activeSection` | Đọc store qua selector, chạy useEffect nạp ban đầu (`refreshDiagnostics(10)`, `refreshIntegrations()`), render thanh nav + section đang chọn, truyền slice dữ liệu + callback xuống các section |
| `SettingsNav` | — | Render danh sách tab các nhóm, highlight nhóm active, phát sự kiện chọn nhóm |
| `OnboardingBanner` | — | Hiển thị có điều kiện "Finish setup" khi `onboardingState.hasPendingSetup`, nút mở onboarding |
| `AccountSection` | — | Trình bày `user.{name,email,role,activeKeys,createdAt}` + nút mở IzziAPI dashboard |
| `RunnerPlanSection` | — | Trình bày `runtimeState` + `user.{plan,balance}` + last agent status/error |
| `UpdatesSection` | `isUpdaterErrorExpanded` | Trình bày `updaterState` (read-only) + 3 nút điều kiện (check/download/restart) + lỗi updater thu gọn có "Xem chi tiết" |
| `IntegrationsSection` | — | Trình bày `integrations[]` + trạng thái + nút làm mới |
| `DiagnosticsSection` | — | Trình bày `diagnostics[]` + empty state + nút làm mới |
| `DangerZoneSection` | — | Hành động đăng xuất, tách biệt |

### Information Flow
| From \ To | Page | Nav | Account | RunnerPlan | Updates | Integrations | Diagnostics | Danger |
|-----------|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|
| Page | — | → props | → props | → props | → props | → props | → props | → props |
| Nav | ← onSelect | — | | | | | | |
| Account | | | — | | | | | |
| RunnerPlan | | | | — | | | | |
| Updates | | | | | — | | | |
| Integrations | ← onRefresh | | | | | — | | |
| Diagnostics | ← onRefresh | | | | | | — | |
| Danger | ← onLogout | | | | | | | — |

→ = truyền props/gọi xuống · ← = callback lên · 11 edges, N=8 → flow density 0.196.

### Requirement Allocation
| Requirement | Component(s) |
|-------------|--------------|
| R1 Nhóm theo chủ đề | `SettingsPage` (định nghĩa nhóm) + tất cả `*Section` |
| R2 Điều hướng gọn | `SettingsNav` + `SettingsPage` (`activeSection`, default) |
| R3 Thu gọn lỗi updater | `UpdatesSection` |
| R4 Tách read-only/action | mỗi `*Section`; `DiagnosticsSection` & `DangerZoneSection` riêng |
| R5 Bảo toàn chức năng | tất cả `*Section` + `SettingsPage` (useEffect, bind action) |
| R6 Tái dùng design system | tất cả (dùng class CSS sẵn có) |

### Key Design-Induced Invariants
- **INV-2/INV-3 (điều hướng):** `activeSection` chỉ tồn tại ở `SettingsPage`; useEffect nạp dữ liệu chạy một lần khi mount, độc lập với việc đổi tab → đổi nhóm không reload dữ liệu.
- **INV-4/INV-5/INV-6 (updater):** `isUpdaterErrorExpanded` và mọi suy luận theo `updaterState.state`/`.error` đóng kín trong `UpdatesSection`; component khác không thấy state này.
- **INV-7 (onboarding):** điều kiện `hasPendingSetup` cô lập trong `OnboardingBanner` (do `SettingsPage` quyết định render hay không).
- **INV-1 (bảo toàn/phân bổ):** việc gán mỗi mục dữ liệu vào đúng một section là trách nhiệm của `SettingsPage` — ranh giới phân vùng nằm ở một chỗ duy nhất.
- **INV-8 (không đổi store):** mọi section là component thuần present nhận props; chỉ `SettingsPage` đọc store qua selector — không thêm action/selector mới, không đổi schema.
- **INV-9 (tách read/action):** mỗi section tự chịu trách nhiệm tách vùng read-only khỏi `action-row`.

### Alternatives Considered
| Candidate | Strength | Weakness | Why Not Selected |
|-----------|----------|----------|------------------|
| B — Domain-oriented + Persistence Gateway | Cô lập tuyệt đối tiếp xúc store/electronAPI vào một hook → INV-8 bảo chứng mạnh, test tách tầng dễ, flow density 0.167 | Thêm một tầng (Gateway) có thể thừa cho một trang thuần trình bày; INV-1/INV-3 bị chia giữa Page và Gateway | Lợi ích tách tầng không đủ lớn để bù chi phí thêm tầng cho một trang không tái dùng; Candidate A đã đủ cô lập và đơn giản hơn |
| C — Store-driven flat (god component) | Ít file nhất, không bề mặt props nội bộ, đổi tối thiểu về số file | God object score cao; flow density không đo được (thiếu ranh giới); coupling nội tại ~100%; không test cô lập từng nhóm | Mâu thuẫn mục tiêu "gọn gàng, có cấu trúc"; giữ nguyên gốc rễ vấn đề (một khối lớn khó điều hướng/bảo trì) |

### Metrics Summary
| Metric | Selected (A) | Alt A (B) | Alt B (C) |
|--------|:-:|:-:|:-:|
| Cross-cutting reqs % | 67% | 50% | 100% (nội tại) |
| Cross-cutting invariants % | 33% | 33% | 100% (nội tại) |
| Flow density | 0.196 | 0.167 | N/A (suy biến) |
| God object score | Thấp | Thấp | Cao |
| Sync cycles | 0 | 0 | 0 |
| Max fan-in | 4 | 5 | N/A |
| Max fan-out | 7 | 7 | N/A |
| Evolvability cost | Thấp | Thấp–Trung | Trung–Cao |
