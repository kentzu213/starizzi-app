# Requirements Document

## Introduction

Tài liệu này mô tả yêu cầu cho việc thiết kế lại giao diện ứng dụng desktop (`apps/desktop`) theo phong cách "kính" hiện đại (glass / liquid glass) lấy cảm hứng từ iOS 26. Mục tiêu cốt lõi không chỉ là làm mới bề ngoài, mà là **đồng bộ hóa triệt để** hệ thống style đến từng màn hình và từng component, loại bỏ tình trạng lệch màu và style rời rạc hiện tại.

Phạm vi được người dùng chốt là **Phương án B — "Token + Hợp nhất toàn bộ"**, gồm bốn hướng công việc:

1. Làm mới hệ design token glass trong `src/renderer/styles/index.css` (tăng độ sâu/blur, bo góc kiểu iOS, shadow mềm nhiều lớp, gradient accent, highlight viền sáng specular) đồng thời giữ hiệu năng.
2. Hợp nhất ba stylesheet đang lệch màu (`agent-gateway.css`, `agent-store.css`, `agent-hub.css` — đang dùng bảng màu slate/indigo hardcode như `#1e293b`, `#6366f1`, `#64748b`) về hệ token chung.
3. Gỡ các inline `style={{}}` mang tính trình bày rải rác trong các trang sang class/token nhất quán.
4. Tạo bộ class glass dùng chung (`glass-surface`, `glass-card`, `glass-panel`) để áp dụng nhất quán trên mọi màn hình.

Trọng tâm xuyên suốt: **tính phủ kín** (mọi page và component đều được kiểm và áp style nhất quán), **không hồi quy chức năng**, **giữ hiệu năng blur**, **khả năng kiểm chứng** (mỗi màn hình có tiêu chí "đã đồng bộ" rõ ràng), và **khả năng đọc/tương phản** của chữ trên nền kính.

### Phi mục tiêu (Out of Scope)

Các hạng mục sau thuộc Phương án C mà người dùng **KHÔNG** chọn. Ghi nhận tại đây để tránh hiểu lầm và ngăn scope creep:

- Tạo các React component primitive mới (ví dụ chuyển `.btn`, `.card` thành component React).
- Bật vibrancy / cửa sổ trong suốt (transparent) ở tầng native Electron.
- Thêm light mode hoặc cơ chế chuyển theme. Ứng dụng giữ nguyên dark-only.

## Glossary

- **Ứng_Dụng**: Ứng dụng desktop trong `apps/desktop`, tầng renderer (React 19 + Vite + Electron), chế độ dark-only.
- **Hệ_Token**: Tập hợp CSS custom properties khai báo trong khối `:root` của `src/renderer/styles/index.css` (token màu, glass, shadow, radius, accent, gradient).
- **Token_Glass**: Nhóm token mô tả bề mặt kính trong Hệ_Token, gồm tối thiểu `--glass-bg`, `--glass-blur`, `--glass-border`, cùng các token mới bổ sung cho specular highlight và shadow nhiều lớp.
- **Bộ_Class_Glass**: Bộ class CSS dùng chung mới gồm `glass-surface`, `glass-card`, `glass-panel`, định nghĩa trong `index.css`, tham chiếu Token_Glass.
- **Stylesheet_Lệch**: Ba tệp `src/renderer/styles/agent-gateway.css`, `agent-store.css`, `agent-hub.css` hiện chứa giá trị màu hardcode lệch khỏi Hệ_Token.
- **Inline_Style_Trình_Bày**: Thuộc tính `style={{}}` trong file `.tsx` chứa giá trị tĩnh mang tính trình bày (màu, nền, bo góc, khoảng cách, đổ bóng) có thể biểu diễn bằng class/token.
- **Inline_Style_Động**: Thuộc tính `style={{}}` chứa giá trị tính toán tại runtime (ví dụ `width: ${percent}%`, `animationDelay: ${i*60}ms`) không thể chuyển thành class tĩnh.
- **Màn_Hình**: Một trang trong `src/renderer/pages/`: Login, Chat, Tasks, Memory, Status, Dashboard, Marketplace, Extensions, ExtensionDetail, AgentStore, DeveloperDashboard, DeveloperUpload, CostDashboard, Settings, SetupWizard.
- **Component_Chung**: Một component trong `src/renderer/components/`: AgentSetupPanel, AgentStatusBadge, AgentTabBar, AppIcons, ChatComposer, ChatEmptyState, ChatMessageList, ErrorBoundary, ModelSelector, OnboardingWizard, PermissionDialog, Sidebar, Skeleton, TitleBar, UpdateBanner, UpdateNotification.
- **Tỷ_Lệ_Tương_Phản**: Tỷ lệ tương phản màu giữa chữ và nền tổng hợp (composited) phía sau lớp kính, đo theo công thức WCAG 2.1.
- **Tiêu_Chí_Đồng_Bộ**: Danh sách điều kiện xác định một Màn_Hình hoặc Component_Chung được coi là "đã đồng bộ" với hệ thống glass.

## Requirements

### Requirement 1: Làm mới hệ design token glass

**User Story:** Là người phát triển giao diện, tôi muốn hệ design token glass được làm mới theo phong cách iOS 26, để mọi bề mặt kính trong ứng dụng có chiều sâu, độ bo và ánh sáng nhất quán từ một nguồn token duy nhất.

#### Acceptance Criteria

1. THE Hệ_Token SHALL khai báo các Token_Glass cho nền kính, độ blur, viền kính, specular highlight và shadow nhiều lớp trong khối `:root` của `src/renderer/styles/index.css`, trong đó token độ blur có giá trị từ 12px đến 24px.
2. THE Hệ_Token SHALL định nghĩa một token bán kính bo góc lớn kiểu iOS có giá trị từ 20px đến 32px dành cho bề mặt kính chính, và một token bán kính nhỏ có giá trị từ 8px đến 16px dành cho phần tử kính nhỏ như nút bấm hoặc chip, với giá trị token nhỏ luôn nhỏ hơn giá trị token lớn.
3. THE Hệ_Token SHALL định nghĩa token shadow mềm gồm tối thiểu hai lớp đổ bóng chồng nhau cho bề mặt kính nổi, trong đó mỗi lớp có giá trị độ nhòe (blur) và độ dịch (offset) khác nhau.
4. THE Hệ_Token SHALL định nghĩa token specular highlight tạo một dải sáng dọc theo cạnh trên của bề mặt kính, có độ sáng cao hơn token nền kính (`--glass-bg`).
5. THE Hệ_Token SHALL định nghĩa token gradient accent dựa trên cặp màu thương hiệu cyan `#67e8f9` và purple `#a78bfa` hiện có.
6. WHEN một Token_Glass được cập nhật giá trị, THE Hệ_Token SHALL áp dụng giá trị mới cho mọi bề mặt tham chiếu token đó mà không cần sửa từng nơi sử dụng.
7. IF một bề mặt tham chiếu một Token_Glass chưa được định nghĩa trong Hệ_Token, THEN THE Hệ_Token SHALL cung cấp một giá trị fallback hợp lệ cho bề mặt đó thay vì để thuộc tính không có giá trị.

### Requirement 2: Tạo bộ class glass dùng chung

**User Story:** Là người phát triển giao diện, tôi muốn có một bộ class glass dùng chung, để áp dụng bề mặt kính nhất quán trên mọi màn hình mà không lặp lại khai báo CSS.

#### Acceptance Criteria

1. THE Bộ_Class_Glass SHALL cung cấp đúng ba class `glass-surface`, `glass-card`, và `glass-panel`, tất cả được định nghĩa trong `src/renderer/styles/index.css`.
2. THE Bộ_Class_Glass SHALL tham chiếu Token_Glass cho toàn bộ thuộc tính nền, blur, viền, bo góc, shadow và specular highlight của cả ba class.
3. THE Bộ_Class_Glass SHALL đặt tên cả ba class theo kebab-case và quy ước BEM hiện có của dự án.
4. WHERE một phần tử được chỉ định là bề mặt kính trong đặc tả thiết kế, THE Ứng_Dụng SHALL áp dụng một class từ Bộ_Class_Glass cho phần tử đó thay vì khai báo lại thuộc tính kính cục bộ.
5. WHERE một phần tử không được chỉ định là bề mặt kính trong đặc tả thiết kế, THE Ứng_Dụng SHALL không áp dụng bất kỳ class nào từ Bộ_Class_Glass cho phần tử đó.
6. WHILE một Component_Chung đang trong quá trình chuyển đổi sang dùng Bộ_Class_Glass, THE Ứng_Dụng SHALL cho phép class từ Bộ_Class_Glass và thuộc tính kính cục bộ của component đó cùng tồn tại.
7. WHEN việc chuyển đổi một Component_Chung sang dùng class từ Bộ_Class_Glass hoàn tất, THE Ứng_Dụng SHALL loại bỏ toàn bộ thuộc tính kính cục bộ của component đó.
8. THE Bộ_Class_Glass SHALL không chứa giá trị màu, blur, bo góc hoặc shadow hardcode nằm ngoài Token_Glass.

### Requirement 3: Hợp nhất các stylesheet lệch màu về hệ token chung

**User Story:** Là người phát triển giao diện, tôi muốn ba stylesheet đang lệch màu được hợp nhất về hệ token chung, để toàn bộ ứng dụng dùng một bảng màu thống nhất.

#### Acceptance Criteria

1. THE Stylesheet_Lệch SHALL thay thế mọi giá trị màu hardcode thuộc bảng slate/indigo (bao gồm nhưng không giới hạn ở `#1e293b`, `#0f172a`, `#334155`, `#475569`, `#64748b`, `#6366f1`, `#3b82f6`, `#8b5cf6`) bằng đúng một token tương ứng trong Hệ_Token, theo ánh xạ một-một cho mỗi giá trị màu.
2. THE Stylesheet_Lệch SHALL tham chiếu Token_Glass cho mọi bề mặt kính (phần tử có nền bán trong suốt hoặc hiệu ứng backdrop-blur) thay vì khai báo nền và blur cục bộ.
3. WHEN việc hợp nhất hoàn tất, THE Stylesheet_Lệch SHALL có số lượng giá trị màu hex hoặc rgba nằm ngoài khối khai báo token của Hệ_Token bằng 0.
4. WHEN một màn hình Chat hoặc AgentStore được hiển thị, THE Ứng_Dụng SHALL áp dụng cùng giá trị token màu accent (cyan/purple) như các màn hình đã tuân thủ Hệ_Token.
5. IF một giá trị màu trong Stylesheet_Lệch không có token tương ứng trong Hệ_Token, THEN THE Hệ_Token SHALL được bổ sung một token mới cho giá trị đó trước khi việc hợp nhất được coi là hoàn tất, thay vì giữ lại giá trị hardcode.

### Requirement 4: Gỡ inline style trình bày sang class và token

**User Story:** Là người phát triển giao diện, tôi muốn các inline style mang tính trình bày được chuyển sang class/token, để style tập trung, dễ bảo trì và không lệch khỏi hệ thống.

#### Acceptance Criteria

1. THE Ứng_Dụng SHALL chuyển toàn bộ Inline_Style_Trình_Bày trong các Màn_Hình và Component_Chung sang class CSS tham chiếu Hệ_Token, sao cho sau khi hoàn thành không còn Inline_Style_Trình_Bày nào tồn tại trong phạm vi này.
2. WHERE một inline style được phân loại là Inline_Style_Động, THE Ứng_Dụng SHALL giữ nguyên inline style đó (không chuyển sang class CSS) và chỉ gán cho inline style đó các giá trị được tính tại runtime.
3. IF một inline style chứa giá trị màu, nền, bo góc hoặc shadow, THEN THE Ứng_Dụng SHALL thay giá trị đó bằng token tương ứng trong Hệ_Token, bất kể inline style đó được phân loại là trình bày hay động.
4. THE Ứng_Dụng SHALL không tạo thêm bất kỳ inline style nào chứa giá trị màu hoặc nền dạng literal (giá trị viết trực tiếp, không tham chiếu Hệ_Token) trong phạm vi công việc này, bất kể inline style đó được phân loại là trình bày hay động.
5. IF một Inline_Style_Trình_Bày hoặc một giá trị màu, nền, bo góc hoặc shadow cần chuyển đổi không có token tương ứng trong Hệ_Token, THEN THE Ứng_Dụng SHALL giữ nguyên giá trị gốc, không thay bằng giá trị literal mới, và đánh dấu trường hợp đó là cần bổ sung token để xử lý.
6. WHEN việc chuyển đổi inline style sang class/token hoàn tất, THE Ứng_Dụng SHALL hiển thị các Màn_Hình và Component_Chung với kết quả trực quan không thay đổi so với trước khi chuyển đổi.

### Requirement 5: Phủ kín và đồng bộ mọi màn hình

**User Story:** Là người dùng cuối, tôi muốn mọi màn hình trông và hành xử nhất quán theo phong cách kính, để trải nghiệm không bị lệch lạc giữa các trang.

#### Acceptance Criteria

1. THE Ứng_Dụng SHALL áp dụng Bộ_Class_Glass và Hệ_Token cho toàn bộ 15 Màn_Hình trong danh sách: Login, Chat, Tasks, Memory, Status, Dashboard, Marketplace, Extensions, ExtensionDetail, AgentStore, DeveloperDashboard, DeveloperUpload, CostDashboard, Settings, SetupWizard.
2. THE Tiêu_Chí_Đồng_Bộ cho mỗi Màn_Hình SHALL gồm bốn điều kiện đo được: (a) 100% giá trị màu được tham chiếu từ Hệ_Token; (b) toàn bộ bề mặt kính sử dụng class lấy từ Bộ_Class_Glass; (c) số lượng Inline_Style_Trình_Bày bằng 0; (d) số lượng giá trị màu hardcode lệch Hệ_Token bằng 0.
3. WHEN một Màn_Hình được rà soát, THE Màn_Hình SHALL thỏa toàn bộ bốn điều kiện trong Tiêu_Chí_Đồng_Bộ trước khi được đánh dấu hoàn tất.
4. WHEN một Màn_Hình được hiển thị, THE Ứng_Dụng SHALL áp dụng cùng một giá trị token về bán kính bo góc, shadow và viền specular cho các bề mặt kính cùng cấp, sao cho các bề mặt cùng cấp có giá trị token trùng khớp trên mọi Màn_Hình.
5. IF một Màn_Hình không thỏa ít nhất một điều kiện trong Tiêu_Chí_Đồng_Bộ khi rà soát, THEN THE Ứng_Dụng SHALL giữ Màn_Hình ở trạng thái chưa hoàn tất và đánh dấu cụ thể điều kiện không đạt cho người rà soát.

### Requirement 6: Phủ kín và đồng bộ mọi component dùng chung

**User Story:** Là người dùng cuối, tôi muốn các thành phần dùng chung như sidebar, thanh tiêu đề và hộp thoại đồng bộ với phong cách kính, để giao diện liền mạch ở mọi nơi chúng xuất hiện.

#### Acceptance Criteria

1. THE Ứng_Dụng SHALL áp dụng Hệ_Token cho toàn bộ 16 Component_Chung trong danh sách: AgentSetupPanel, AgentStatusBadge, AgentTabBar, AppIcons, ChatComposer, ChatEmptyState, ChatMessageList, ErrorBoundary, ModelSelector, OnboardingWizard, PermissionDialog, Sidebar, Skeleton, TitleBar, UpdateBanner, UpdateNotification.
2. WHERE một Component_Chung dựng một bề mặt nền dạng panel, card, thanh (bar) hoặc hộp thoại, THE Ứng_Dụng SHALL áp dụng một class từ Bộ_Class_Glass cho bề mặt đó.
3. THE Tiêu_Chí_Đồng_Bộ cho mỗi Component_Chung SHALL gồm bốn điều kiện đo được: (a) 100% giá trị màu được tham chiếu từ Hệ_Token; (b) mọi bề mặt nền dạng panel/card/bar/dialog dùng class từ Bộ_Class_Glass; (c) số lượng Inline_Style_Trình_Bày bằng 0; (d) không còn giá trị hex hoặc rgba nằm ngoài Hệ_Token, ngoại trừ giá trị trùng khớp với một token đã định nghĩa.
4. WHEN một Component_Chung được rà soát, THE Component_Chung SHALL thỏa toàn bộ bốn điều kiện trong Tiêu_Chí_Đồng_Bộ trước khi được đánh dấu hoàn tất.
5. WHEN một Component_Chung xuất hiện trên nhiều Màn_Hình, THE Ứng_Dụng SHALL hiển thị component đó với cùng giá trị token màu, cùng token bán kính bo góc và cùng class từ Bộ_Class_Glass ở mọi vị trí, không có biến thể style theo từng Màn_Hình.

### Requirement 7: Giữ hiệu năng khi dùng blur

**User Story:** Là người dùng cuối, tôi muốn giao diện kính chạy mượt, để hiệu ứng blur không gây giật khi cuộn hoặc chuyển màn hình.

#### Acceptance Criteria

1. WHILE người dùng cuộn nội dung trong một Màn_Hình, THE Ứng_Dụng SHALL duy trì tốc độ dựng hình trung bình tối thiểu 55 khung hình mỗi giây đo trên cửa sổ trượt 1 giây và không để xảy ra quá 2 khung hình bị bỏ lỡ liên tiếp, trên cấu hình tham chiếu của dự án.
2. THE Ứng_Dụng SHALL giới hạn số lớp `backdrop-filter` blur chồng nhau tối đa là 3 lớp tại bất kỳ điểm nào trên cây giao diện của một Màn_Hình.
3. WHERE một bề mặt không thay đổi nội dung hiển thị hoặc nền của nó trong suốt một phiên tương tác liên tục, THE Ứng_Dụng SHALL dùng nền token đặc thay vì `backdrop-filter`.
4. IF giá trị `--glass-blur` được yêu cầu đặt vượt quá 24px, THEN THE Hệ_Token SHALL kẹp giá trị áp dụng về tối đa 24px.
5. WHEN người dùng chuyển từ một Màn_Hình sang một Màn_Hình khác, THE Ứng_Dụng SHALL hoàn tất hiệu ứng chuyển cảnh trong tối đa 300 mili-giây trong khi duy trì tốc độ dựng hình trung bình tối thiểu 55 khung hình mỗi giây trên cấu hình tham chiếu của dự án.

### Requirement 8: Khả năng đọc và tương phản trên nền kính

**User Story:** Là người dùng cuối, kể cả người có thị lực hạn chế, tôi muốn chữ trên nền kính vẫn rõ ràng, để đọc nội dung không bị mờ hay chìm vào nền.

#### Acceptance Criteria

1. THE Ứng_Dụng SHALL đảm bảo Tỷ_Lệ_Tương_Phản giữa chữ thường (nhỏ hơn 18.66px đậm hoặc nhỏ hơn 24px thường) và nền tổng hợp phía sau lớp kính đạt tối thiểu 4.5:1, đo trên toàn bộ dải độ sáng của nền tổng hợp từ nền sáng nhất đến nền tối nhất.
2. THE Ứng_Dụng SHALL đảm bảo Tỷ_Lệ_Tương_Phản giữa chữ lớn (từ 18.66px đậm hoặc 24px thường trở lên) và nền tổng hợp phía sau lớp kính đạt tối thiểu 3:1, đo trên toàn bộ dải độ sáng của nền tổng hợp từ nền sáng nhất đến nền tối nhất.
3. WHERE một vùng kính đặt trên nền có độ sáng thay đổi, THE Ứng_Dụng SHALL dùng lớp nền token đủ độ đục để Tỷ_Lệ_Tương_Phản thực tế của chữ thường đạt tối thiểu 4.5:1 và của chữ lớn đạt tối thiểu 3:1 tại điểm nền sáng nhất trong vùng đó.
4. IF Tỷ_Lệ_Tương_Phản đo được của chữ trên một vùng kính thấp hơn ngưỡng tại Acceptance Criteria 1 hoặc 2, THEN THE Ứng_Dụng SHALL tăng độ đục nền hoặc chuyển sang nền token đặc dự phòng cho vùng đó, đồng thời giữ nguyên nội dung chữ.
5. THE Bộ_Class_Glass SHALL đặt độ đục nền (`--glass-bg`) đủ để chữ cấp một (`--color-text-primary`) đạt Tỷ_Lệ_Tương_Phản tối thiểu 4.5:1 trên nền tối nhất của Ứng_Dụng.

### Requirement 9: Không hồi quy chức năng

**User Story:** Là người dùng cuối, tôi muốn việc thiết kế lại không làm hỏng bất kỳ chức năng nào, để mọi thao tác vẫn hoạt động như trước.

#### Acceptance Criteria

1. THE Ứng_Dụng SHALL giữ nguyên cấu trúc điều hướng `useState<Page>` hiện có trong `App.tsx`, bao gồm giữ nguyên tập hợp các trang (Page) và toàn bộ các cặp chuyển trang (thao tác kích hoạt → trang đích) giống hệt như trước khi đổi style; với cùng một thao tác kích hoạt, THE Ứng_Dụng SHALL điều hướng tới cùng một trang đích như trước khi đổi style.
2. WHEN một trong các thao tác người dùng (đăng nhập, chuyển trang, gửi tin nhắn, cài tiện ích, lưu cài đặt) được thực hiện sau khi đổi style, THE Ứng_Dụng SHALL tạo ra cùng kết quả quan sát được như khi thực hiện thao tác đó trước khi đổi style, bao gồm: cùng trạng thái kết thúc, cùng dữ liệu được hiển thị hoặc được lưu, và cùng trang đích (nếu có điều hướng).
3. WHERE sự khác biệt giữa trước và sau khi đổi style chỉ nằm ở thuộc tính trình bày trực quan (màu sắc, khoảng cách, kiểu chữ, thời lượng animation, hoặc hiệu ứng hover), THE Ứng_Dụng SHALL vẫn được coi là không hồi quy, với điều kiện các khác biệt đó không làm thay đổi việc một thao tác có hoàn tất hay không, kết quả quan sát được của thao tác, hoặc trạng thái kết thúc.
4. THE Ứng_Dụng SHALL giữ nguyên toàn bộ tên class đang được tham chiếu trong logic JavaScript/TSX (ví dụ trong querySelector, classList, hoặc điều kiện so khớp theo tên class); IF một tên class bị đổi, THEN THE Ứng_Dụng SHALL cập nhật tất cả nơi tham chiếu tới tên class đó sao cho sau khi đổi, số tham chiếu trỏ tới tên class không còn tồn tại bằng 0.
5. WHEN dự án được build sau khi đổi style, THE Ứng_Dụng SHALL hoàn tất quá trình build với trạng thái thành công và không phát sinh lỗi build mới so với trước khi thay đổi.
6. WHEN bộ kiểm thử hiện có được chạy sau khi đổi style, THE Ứng_Dụng SHALL thực thi đầy đủ toàn bộ các kiểm thử đã có với số kiểm thử bị bỏ qua không tăng so với lần chạy trước khi thay đổi (baseline), và tất cả kiểm thử trước đây đạt SHALL tiếp tục đạt với 0 kiểm thử thất bại mới.
7. THE Ứng_Dụng SHALL giữ nguyên cấu hình cửa sổ Electron frameless và custom titlebar giống hệt như trước khi đổi style, đồng thời SHALL giữ vibrancy và nền trong suốt ở trạng thái tắt.

### Requirement 10: Khả năng kiểm chứng tình trạng đồng bộ

**User Story:** Là người rà soát, tôi muốn xác minh được từng màn hình và component đã đồng bộ, để biết chắc công việc phủ kín đã hoàn tất chứ không bỏ sót.

#### Acceptance Criteria

1. THE Ứng_Dụng SHALL cho phép kiểm chứng rằng cả ba tệp Stylesheet_Lệch không còn chứa bất kỳ giá trị nào trong tám giá trị hex slate/indigo (`#1e293b`, `#0f172a`, `#334155`, `#475569`, `#64748b`, `#6366f1`, `#3b82f6`, `#8b5cf6`) bằng cách tìm kiếm văn bản không phân biệt chữ hoa/thường trên cả ba tệp và nhận về tổng cộng 0 kết quả.
2. THE Ứng_Dụng SHALL cho phép kiểm chứng rằng không còn Inline_Style_Trình_Bày trong 15 Màn_Hình và 16 Component_Chung bằng cách liệt kê mọi vị trí `style={{` còn lại trong các tệp đó và xác nhận từng vị trí là Inline_Style_Động theo định nghĩa Glossary.
3. THE Tiêu_Chí_Đồng_Bộ SHALL được ghi nhận thành một danh sách kiểm tra (checklist) liệt kê đủ 15 Màn_Hình và 16 Component_Chung, trong đó mỗi mục ghi kết quả đạt/không đạt cho từng điều kiện trong bốn điều kiện Tiêu_Chí_Đồng_Bộ: dùng token màu từ Hệ_Token, dùng bề mặt kính từ Bộ_Class_Glass khi cần, không còn Inline_Style_Trình_Bày, và không còn giá trị màu hardcode lệch token.
4. WHEN tất cả 15 Màn_Hình và 16 Component_Chung đều có cả bốn điều kiện Tiêu_Chí_Đồng_Bộ được đánh dấu đạt trong checklist, THE Ứng_Dụng SHALL được coi là đã hoàn tất phạm vi đồng bộ glass.
5. IF bất kỳ phép kiểm chứng nào tại Acceptance Criteria 1, 2 hoặc 3 cho kết quả không đạt (tìm kiếm văn bản trả về nhiều hơn 0 kết quả, tồn tại một vị trí `style={{` không phải Inline_Style_Động, hoặc một mục checklist không đạt ít nhất một điều kiện Tiêu_Chí_Đồng_Bộ), THEN THE Ứng_Dụng SHALL giữ mục tương ứng ở trạng thái chưa đạt, SHALL NOT được coi là đã hoàn tất phạm vi đồng bộ glass, và checklist SHALL chỉ ra điều kiện chưa thỏa của mục đó.
