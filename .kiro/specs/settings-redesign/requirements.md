# Requirements: settings-redesign

## Introduction

Trang Settings hiện tại (`apps/desktop/src/renderer/pages/Settings.tsx`) là một stack PHẲNG gồm 8 card xếp dọc không nhóm: Finish setup, Managed Runner, Desktop updates, Integrations, Account, Core actions, Diagnostics, Danger zone. Trải nghiệm hiện tại có ba vấn đề chính:

1. **Quá dài, không điều hướng** — 8 card xếp dọc liên tục buộc người dùng cuộn dài để tìm một mục, không có cơ chế nhóm hay nhảy nhanh.
2. **Lỗi updater đổ raw ra layout** — khi `updaterState.error` có giá trị (stack-trace/JSON thô), nó được render nguyên văn trong một `SettingRow`, phá vỡ bố cục và gây rối mắt.
3. **Trộn lẫn cấp thông tin** — dữ liệu chỉ-đọc (Plan, Balance, version, thông tin account), hành động (kiểm tra cập nhật, đăng xuất, refresh) và dữ liệu kỹ thuật (diagnostics) nằm chung một cấp, không phân tách rõ.

Mục tiêu của feature này là **thiết kế lại cấu trúc và cách trình bày** trang Settings cho gọn gàng hơn: nhóm các mục theo chủ đề, thêm điều hướng giữa các nhóm, thu gọn hiển thị lỗi updater, và phân tách rõ thông tin chỉ-đọc với hành động — TRONG KHI bảo toàn 100% chức năng và dữ liệu hiện có. Đây là một thay đổi về cấu trúc/UI, không thêm tính năng nghiệp vụ mới và không đổi store hay backend.

### Phạm vi
- Trong phạm vi: tổ chức lại layout của `SettingsPage`, điều hướng nhóm/section, thu gọn lỗi updater, tách read-only vs action, tái dùng CSS sẵn có.
- Ngoài phạm vi: thêm cài đặt mới, đổi schema store/`electronAPI`, đổi logic nghiệp vụ, thay đổi backend/IPC.

### Thuật ngữ
- **Nhóm (group/section)**: một cụm settings cùng chủ đề (Account, Runner & Plan, Updates, Integrations, Diagnostics, Danger zone).
- **Mục chỉ-đọc**: dòng dữ liệu hiển thị không có hành động (vd Plan, Balance, version).
- **Hành động**: nút thao tác (kiểm tra cập nhật, tải, khởi động lại, refresh, đăng xuất, mở onboarding, cài OpenClaw, mua API).

---

## Requirement 1: Nhóm các mục settings theo chủ đề

**User Story:** As a người dùng desktop app, I want các mục cài đặt được nhóm theo chủ đề rõ ràng, so that tôi nhanh chóng định vị được nhóm mình cần thay vì quét qua một danh sách phẳng dài.

### Acceptance Criteria
1. WHEN trang Settings được render THEN the system SHALL tổ chức nội dung thành các nhóm chủ đề riêng biệt: Account, Runner & Plan, Updates, Integrations, Diagnostics, và Danger zone.
2. WHEN một nhóm được hiển thị THEN the system SHALL gắn cho nhóm đó một tiêu đề mô tả rõ ràng.
3. WHEN trang Settings được tổ chức lại thành nhóm THEN the system SHALL giữ mọi mục dữ liệu hiện có trong đúng một nhóm phù hợp về mặt ngữ nghĩa, không bỏ sót mục nào.
4. WHERE mục "Finish setup" chỉ xuất hiện có điều kiện (`onboardingState.hasPendingSetup`) THEN the system SHALL giữ nguyên điều kiện hiển thị đó sau khi tổ chức lại.

---

## Requirement 2: Điều hướng gọn giữa các nhóm

**User Story:** As a người dùng, I want một cơ chế điều hướng giữa các nhóm settings, so that tôi không phải cuộn dài qua toàn bộ trang để tới mục mình muốn.

### Acceptance Criteria
1. WHEN trang Settings được render THEN the system SHALL cung cấp một thanh điều hướng liệt kê các nhóm settings hiện có.
2. WHEN người dùng chọn một nhóm trên thanh điều hướng THEN the system SHALL hiển thị nội dung của nhóm được chọn.
3. WHEN một nhóm đang được chọn THEN the system SHALL biểu thị trực quan nhóm đang active trên thanh điều hướng.
4. WHEN trang Settings được mở lần đầu THEN the system SHALL chọn sẵn một nhóm mặc định để khu vực nội dung không bao giờ trống.
5. WHILE người dùng chuyển đổi giữa các nhóm THE system SHALL không thực hiện lại việc tải dữ liệu khởi tạo (diagnostics/integrations) đã nạp khi vào trang.

---

## Requirement 3: Thu gọn hiển thị lỗi updater

**User Story:** As a người dùng, I want lỗi updater được hiển thị gọn lại thay vì đổ nguyên đoạn văn bản thô, so that bố cục trang không bị phá vỡ nhưng tôi vẫn xem được chi tiết khi cần.

### Acceptance Criteria
1. WHEN `updaterState.error` có giá trị THEN the system SHALL hiển thị một chỉ báo lỗi gọn (tóm tắt/thu gọn) thay vì render toàn bộ nội dung lỗi thô trong layout.
2. WHEN lỗi updater được hiển thị ở dạng thu gọn THEN the system SHALL cung cấp một cách tường minh để người dùng mở rộng và xem toàn bộ chi tiết lỗi (vd nút "Xem chi tiết"/collapse).
3. WHEN người dùng mở rộng chi tiết lỗi THEN the system SHALL hiển thị đầy đủ nội dung `updaterState.error` không bị mất mát thông tin.
4. WHEN `updaterState.error` không có giá trị (rỗng/undefined) THEN the system SHALL không hiển thị bất kỳ chỉ báo lỗi updater nào.
5. WHERE chi tiết lỗi được hiển thị dạng nhiều dòng/raw THEN the system SHALL trình bày nó trong vùng có giới hạn (vd cuộn/wrap) để không làm tràn hay phá vỡ bố cục trang.

---

## Requirement 4: Phân tách thông tin chỉ-đọc với hành động

**User Story:** As a người dùng, I want thông tin chỉ-đọc, hành động và dữ liệu kỹ thuật được phân tách rõ ràng, so that tôi không nhầm lẫn giữa thứ chỉ để xem và thứ có thể thao tác.

### Acceptance Criteria
1. WHEN một nhóm chứa cả dữ liệu chỉ-đọc và hành động THEN the system SHALL trình bày các mục chỉ-đọc tách biệt rõ ràng khỏi các nút hành động.
2. WHEN dữ liệu chẩn đoán kỹ thuật (diagnostics) được hiển thị THEN the system SHALL đặt nó trong nhóm Diagnostics riêng, không trộn vào cùng cấp với thông tin tài khoản hay hành động chính.
3. WHEN các hành động phá huỷ/nhạy cảm (đăng xuất) được hiển thị THEN the system SHALL giữ chúng trong nhóm Danger zone tách biệt với các hành động thông thường.

---

## Requirement 5: Bảo toàn toàn bộ chức năng và dữ liệu hiện có

**User Story:** As a người dùng hiện hữu, I want mọi dữ liệu và hành động đang có vẫn hoạt động sau khi thiết kế lại, so that việc làm gọn giao diện không khiến tôi mất bất kỳ khả năng nào.

### Acceptance Criteria
1. WHEN trang Settings được thiết kế lại THEN the system SHALL giữ hiển thị tất cả mục dữ liệu chỉ-đọc hiện có: trạng thái runtime/agent, Plan, Balance, last agent status, last error, updater state/version/available version/progress, danh sách integrations và trạng thái của chúng, Name/Email/Role/Active keys/Joined.
2. WHEN trang Settings được thiết kế lại THEN the system SHALL giữ tất cả hành động hiện có và liên kết chúng tới đúng handler/store action như trước: kiểm tra cập nhật (`checkForUpdates`), tải cập nhật (`downloadUpdate`), khởi động lại để cập nhật (`restartToUpdate`), làm mới diagnostics (`refreshDiagnostics`), làm mới integrations (`refreshIntegrations`), mở onboarding (`openOnboarding`), mở/cài OpenClaw (`onOpenClawQuickInstall`), mua API (`onBuyApi`), refresh profile (`onRefresh`), mở IzziAPI dashboard (`shell.openExternal`), và đăng xuất (`onLogout`).
3. WHEN các nút cập nhật phụ thuộc trạng thái (Tải xuống khi `available`, Khởi động lại khi `downloaded`) THEN the system SHALL giữ nguyên điều kiện hiển thị theo `updaterState.state` như hành vi hiện tại.
4. WHEN trang Settings được mở THEN the system SHALL vẫn kích hoạt việc nạp ban đầu `refreshDiagnostics(10)` và `refreshIntegrations()` như hiện tại.
5. WHEN danh sách integrations rỗng hoặc danh sách diagnostics rỗng THEN the system SHALL hiển thị trạng thái rỗng phù hợp tương đương hành vi hiện tại (vd thông báo "Chưa có diagnostic event nào").
6. WHEN feature được triển khai THEN the system SHALL KHÔNG thay đổi schema của store `agentWorkspace`, các type dữ liệu, hay API `electronAPI`.

---

## Requirement 6: Tái sử dụng design system sẵn có

**User Story:** As a người bảo trì codebase, I want bản thiết kế lại tái dùng các component/style đã có, so that thay đổi là tối thiểu và nhất quán với phần còn lại của app.

### Acceptance Criteria
1. WHEN bố cục mới được dựng THEN the system SHALL ưu tiên tái dùng các class CSS sẵn có (`card`, `settings-group`, `settings-item`, `diagnostic-card`, `danger-row`, `action-row`, `sync-badge`, `btn*`, và pattern tab kiểu `ext-detail__tab`).
2. WHERE cần một class CSS mới THEN the system SHALL chỉ thêm khi không có lựa chọn tái dùng phù hợp, và giữ phạm vi tối thiểu.
3. WHEN feature được triển khai THEN the system SHALL không phát minh abstraction/component thừa ngoài những gì cần để nhóm và điều hướng settings.
