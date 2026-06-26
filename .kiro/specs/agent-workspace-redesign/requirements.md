# Requirements Document — Agent Workspace Redesign

## Introduction

Tài liệu này mô tả yêu cầu cho việc **tái cấu trúc giao diện** của Starizzi (`apps/desktop`)
từ mô hình "app nhiều trang phẳng" thành một **môi trường làm việc lấy AI Agent làm trung
tâm** (agent-centric workspace), lấy cảm hứng từ tham chiếu Gumloop và đồng bộ với cấu trúc
mới của izziapi.com (Starizzi là sản phẩm desktop của izziapi.com).

Tầm nhìn cốt lõi (do người dùng chốt):

1. **Chat là không gian làm việc trung tâm** — nơi người dùng chọn AI Agent ngay trong phiên
   chat để làm việc; **agent-loop** (vòng lặp tác vụ của agent) là trọng tâm.
2. **Bố cục 3 vùng**:
   - **Giữa**: hội thoại chat / agent-loop (hero).
   - **Phải (≈1/4 màn hình)**: panel **Agent & Nhóm Agent** — chọn/đổi agent đang làm việc.
   - **Góc phải dưới**: bộ chọn **Loop theo nhiệm vụ công việc**.
3. **Đồng bộ với izziapi.com**: cấu trúc tab hợp lý, phong cách thiết kế thống nhất, và
   **tích hợp business model** (balance/plan/budget + lối nạp tiền/nâng gói) vào tool.

Trọng tâm xuyên suốt: **không hồi quy** (giữ nguyên điều hướng và hợp đồng class của
`ios26-glass-redesign`), **giữ thương hiệu glass** (cyan `#67e8f9` + purple `#a78bfa`, dark-only),
**bảo mật** (không tạo bề mặt chạy/ghi thiếu xác thực), và **khả năng kiểm chứng**.

### Phạm vi (In Scope)

- Tái cấu trúc trang `chat` thành **Agent Workspace** 3 vùng (additive, dựng bên trong
  `main-content`, giữ `Sidebar` trái cho điều hướng cấp cao).
- Panel Agent/Nhóm Agent bền vững ở rail phải (thay cho `agent-picker` dạng modal), dựng từ
  `TOP_AGENTS`, nhóm theo `category` (autonomous / platform / orchestration / workflow).
- Bộ chọn **Loop** theo nhiệm vụ ở góc phải dưới, dựa trên một **mô hình dữ liệu loop** (bắt
  đầu bằng preset tĩnh theo nhiệm vụ; chưa wiring thực thi/scheduler).
- **Status strip business model**: hiển thị balance (USD + quy đổi VND), plan (free/pro/max),
  thước đo budget, và CTA "nạp tiền / nâng gói" deep-link sang izziapi.com (qua
  `electronAPI.system.buyApi` đã có).
- **Đồng bộ thiết kế & IA với izzi**: ánh xạ tab của tool sang các surface của izzi; dùng
  chung hệ token glass; đề xuất một surface "Knowledge/Graph" (second brain) ở mức điều hướng.

### Phi mục tiêu (Out of Scope — ghi để tránh scope creep)

- **Thực thi loop thật / scheduler / cron** và **wiring agent-memory vào knowledge graph**
  của izzi (second brain). Bản này chỉ dựng **mô hình + UI**; thực thi để phase sau.
- Xây dựng lại backend billing/auth; tool chỉ **đọc** dữ liệu qua `electronAPI` sẵn có và
  **deep-link** sang web izzi cho thanh toán.
- Gỡ bỏ luồng OpenClaw legacy (`agentWorkspace` store) — phải giữ song song, không phá.
- Bật light mode / vibrancy / transparent ở tầng Electron (giữ dark-only, frameless như cũ).
- Tạo React primitive mới ngoài phạm vi workspace; viết lại các trang không liên quan
  (Marketplace, Extensions, Settings...) ngoài phần đồng bộ token/tab tối thiểu.

## Glossary

- **Ứng_Dụng**: Tầng renderer của `apps/desktop` (React 19 + Vite + Electron, dark-only glass).
- **Agent_Workspace**: Bố cục 3 vùng mới của trang `chat`: vùng Chat (giữa), Agent_Rail (phải),
  Loop_Dock (góc phải dưới).
- **Agent_Rail**: Panel bền vững ở cột phải hiển thị Agent và Nhóm_Agent, cho phép mở/đổi phiên.
- **Nhóm_Agent**: Tập hợp agent theo `AgentCategory` (`autonomous`, `platform`,
  `orchestration`, `workflow`) lấy từ `TOP_AGENTS` trong `types/agent-registry.ts`.
- **Loop**: Một cấu hình tác vụ tái sử dụng được, gắn với một nhiệm vụ công việc (ví dụ
  "Nghiên cứu", "Tự động hoá", "Lập trình"), gồm tối thiểu: id, nhãn, nhiệm vụ, agent gợi ý,
  model gợi ý, mô tả. Bản này dùng **preset tĩnh**, chưa thực thi.
- **Loop_Dock**: Vùng góc phải dưới hiển thị danh sách Loop theo nhiệm vụ để người dùng chọn.
- **Business_Strip**: Dải hiển thị balance/plan/budget + CTA nạp tiền/nâng gói, đồng bộ izzi.
- **Hệ_Token_Glass**: Hệ design token glass iOS-26 đã có trong `styles/index.css` (đầu ra của
  spec `ios26-glass-redesign`): `--glass-*`, `--radius-glass-*`, `--color-accent-*`,
  `--color-accent-gradient` (cyan/purple).
- **Điều_Hướng**: Cơ chế `useState<Page>` trong `App.tsx` với tập trang hiện có (`chat`,
  `tasks`, `memory`, `status`, `dashboard`, `marketplace`, `agents`, `extensions`, `settings`,
  `setup`, `costs`).
- **Hợp_Đồng_Glass**: Các bất biến không-hồi-quy do `ios26-glass-redesign` Req 9 đặt ra (giữ
  `useState<Page>`, giữ tên class bị JS/TSX tham chiếu, giữ cấu hình Electron frameless).

## Requirements

### Requirement 1: Agent_Workspace 3 vùng

**User Story:** Là người dùng, tôi muốn trang chat trở thành một không gian làm việc lấy agent
làm trung tâm với chat ở giữa, agent ở phải và loop ở góc phải dưới, để chọn agent và bắt đầu
một loop công việc ngay trong một màn hình.

#### Acceptance Criteria

1. THE Ứng_Dụng SHALL dựng Agent_Workspace bên trong vùng `main-content` của trang `chat`,
   gồm ba vùng: vùng Chat ở giữa, Agent_Rail ở cột phải, và Loop_Dock ở góc phải dưới.
2. THE Agent_Rail SHALL chiếm khoảng một phần tư chiều rộng khả dụng của Agent_Workspace
   trên cấu hình cửa sổ tham chiếu, và vùng Chat SHALL chiếm phần chiều rộng còn lại.
3. WHERE chiều rộng cửa sổ nhỏ hơn ngưỡng thu gọn của dự án, THE Ứng_Dụng SHALL thu gọn
   Agent_Rail thành dạng có thể bật/tắt (collapsible) mà không che khuất vùng Chat.
4. THE Loop_Dock SHALL được neo ở góc phải dưới của Agent_Workspace và SHALL không che khuất
   ô soạn tin (composer) của vùng Chat.
5. THE Agent_Workspace SHALL áp dụng Hệ_Token_Glass cho mọi bề mặt mới (panel/card/bar) và
   SHALL NOT đưa vào giá trị màu/nền/bo góc/shadow hardcode nằm ngoài Hệ_Token_Glass.
6. WHEN người dùng đổi kích thước cửa sổ, THE Agent_Workspace SHALL giữ vùng Chat luôn hiển
   thị và không bị tràn (overflow) ngang gây mất composer.

### Requirement 2: Agent_Rail — Agent & Nhóm Agent (cột phải)

**User Story:** Là người dùng, tôi muốn thấy danh sách agent theo nhóm ở cột phải và chọn agent
để làm việc, để không phải mở hộp thoại chọn agent mỗi lần.

#### Acceptance Criteria

1. THE Agent_Rail SHALL hiển thị toàn bộ agent trong `TOP_AGENTS`, **nhóm theo** `AgentCategory`
   với tiêu đề nhóm cho từng category có ít nhất một agent.
2. THE Agent_Rail SHALL hiển thị cho mỗi agent tối thiểu: icon, tên hiển thị, và trạng thái
   (`running` / `stopped` / `not-installed` / `error`) lấy từ `agentGateway` store.
3. WHEN người dùng chọn một agent trong Agent_Rail, THE Ứng_Dụng SHALL mở hoặc chuyển sang
   phiên chat của agent đó (tương đương hành vi `openAgentChat` hiện có) và đánh dấu agent đó
   là đang hoạt động trong rail.
4. WHERE đã tồn tại phiên đang hoạt động cho một agent, THE Agent_Rail SHALL hiển thị chỉ báo
   trực quan cho agent đó (trạng thái "đang mở").
5. THE Ứng_Dụng SHALL giữ hành vi điều hướng và dữ liệu của `agentGateway` store không đổi
   (mở/đóng/đổi phiên, gửi tin, chọn model) so với trước khi có Agent_Rail.
6. WHEN Agent_Rail thay thế hộp thoại `agent-picker` dạng modal, THE Ứng_Dụng SHALL giữ
   nguyên khả năng mở phiên cho mọi agent mà modal trước đó hỗ trợ (không mất agent nào).

### Requirement 3: Loop_Dock — chọn Loop theo nhiệm vụ (góc phải dưới)

**User Story:** Là người dùng, tôi muốn chọn một "loop" theo loại nhiệm vụ công việc ở góc phải
dưới, để nhanh chóng cấu hình agent cho đúng việc cần làm.

#### Acceptance Criteria

1. THE Ứng_Dụng SHALL định nghĩa một mô hình dữ liệu Loop có tối thiểu các trường: `id`,
   `label`, `task` (nhiệm vụ), `description`, `suggestedAgentId`, `suggestedModel`.
2. THE Loop_Dock SHALL hiển thị một danh sách Loop preset được nhóm/gắn nhãn theo nhiệm vụ
   công việc, mỗi Loop hiển thị nhãn và nhiệm vụ của nó.
3. WHEN người dùng chọn một Loop, THE Ứng_Dụng SHALL áp cấu hình gợi ý của Loop đó vào phiên
   chat đang hoạt động (đặt agent gợi ý nếu chưa có phiên, và đặt model gợi ý cho phiên).
4. IF không có phiên chat nào đang hoạt động khi chọn Loop, THEN THE Ứng_Dụng SHALL mở một
   phiên mới với agent gợi ý của Loop trước khi áp model gợi ý.
5. THE mô hình dữ liệu Loop SHALL là dữ liệu tĩnh/preset trong bản này và SHALL NOT kích hoạt
   thực thi nền, scheduler, hay ghi ra mạng khi được chọn.
6. WHERE một Loop tham chiếu `suggestedAgentId` không khớp agent nào trong `TOP_AGENTS`, THE
   Ứng_Dụng SHALL bỏ qua phần áp agent một cách an toàn (không crash) và vẫn cho người dùng chat.

### Requirement 4: Business_Strip — tích hợp business model izzi

**User Story:** Là người dùng, tôi muốn thấy số dư, gói và mức chi tiêu của mình ngay trong môi
trường làm việc và có lối nạp tiền/nâng gói, để kiểm soát chi phí mà không rời app.

#### Acceptance Criteria

1. THE Business_Strip SHALL hiển thị balance hiện tại của người dùng (USD) và một giá trị quy
   đổi VND, lấy từ dữ liệu hồ sơ người dùng qua `electronAPI` hiện có.
2. THE Business_Strip SHALL hiển thị plan hiện tại (ví dụ free/pro/max) của người dùng.
3. WHERE dữ liệu budget khả dụng (qua `electronAPI.budget`), THE Business_Strip SHALL hiển thị
   một chỉ báo mức dùng so với hạn mức (ví dụ phần trăm budget tháng).
4. WHEN người dùng kích hoạt CTA nạp tiền/nâng gói, THE Ứng_Dụng SHALL mở trang pricing/billing
   của izziapi.com qua cơ chế deep-link hiện có (`electronAPI.system.buyApi`).
5. THE Ứng_Dụng SHALL NOT lưu, in ra, hay ghi log bất kỳ secret nào (API key, token) khi hiển
   thị Business_Strip; chỉ hiển thị dữ liệu không nhạy cảm (balance, plan, mức dùng).
6. IF dữ liệu balance/plan/budget không khả dụng, THEN THE Business_Strip SHALL hiển thị trạng
   thái rỗng/đang tải hợp lệ thay vì giá trị giả hoặc lỗi chưa bắt.

### Requirement 5: Đồng bộ thiết kế & IA với izziapi.com

**User Story:** Là người dùng của hệ sinh thái izzi, tôi muốn tool desktop trông và được tổ chức
nhất quán với izziapi.com, để trải nghiệm liền mạch giữa web và desktop.

#### Acceptance Criteria

1. THE Ứng_Dụng SHALL dùng Hệ_Token_Glass (accent cyan/purple) làm nguồn màu duy nhất cho các
   bề mặt của Agent_Workspace, không tạo bảng màu riêng lệch khỏi thương hiệu izzi.
2. THE tài liệu thiết kế (design.md) SHALL chứa một **bản đồ tab/IA** ánh xạ các surface của
   tool sang các surface tương ứng của izziapi.com (ví dụ Chat/Agent, Models, Cost/Billing,
   Marketplace, Knowledge/Graph, Account).
3. WHERE izzi định hướng "second brain" (knowledge graph + agent memory), THE bản đồ IA SHALL
   bao gồm một mục điều hướng dự kiến cho surface Knowledge/Graph, **được đánh dấu là phase sau**
   (chưa bắt buộc dựng UI đầy đủ trong bản này).
4. WHEN một bề mặt mới của Agent_Workspace cùng cấp với một bề mặt đã tuân thủ Hệ_Token_Glass,
   THE Ứng_Dụng SHALL áp cùng giá trị token bán kính/shadow/viền cho hai bề mặt cùng cấp.

### Requirement 6: Không hồi quy điều hướng, chat, và Hợp_Đồng_Glass

**User Story:** Là người dùng, tôi muốn việc tái cấu trúc không làm hỏng điều hướng, chat hiện
có hay các kiểm thử đã đạt, để mọi thứ vẫn hoạt động như trước.

#### Acceptance Criteria

1. THE Ứng_Dụng SHALL giữ nguyên cấu trúc `useState<Page>` và toàn bộ tập trang trong Điều_Hướng;
   với cùng một thao tác kích hoạt, THE Ứng_Dụng SHALL điều hướng tới cùng trang đích như trước.
2. THE Ứng_Dụng SHALL giữ nguyên mọi tên class đang bị JavaScript/TSX tham chiếu; IF một tên
   class buộc phải đổi, THEN THE Ứng_Dụng SHALL cập nhật mọi nơi tham chiếu sao cho số tham
   chiếu mồ côi bằng 0.
3. THE Ứng_Dụng SHALL giữ song song cả hai store chat (`agentWorkspace` legacy và `agentGateway`)
   và SHALL giữ kết quả quan sát được của các thao tác chat (gửi tin, mở/đổi/đóng phiên, chọn
   model) không đổi so với trước.
4. THE Ứng_Dụng SHALL giữ cấu hình cửa sổ Electron frameless và custom titlebar như cũ, với
   vibrancy và transparent ở trạng thái tắt.
5. WHEN dự án được build sau thay đổi, THE Ứng_Dụng SHALL build thành công không phát sinh lỗi
   build mới so với baseline.
6. WHEN bộ kiểm thử hiện có được chạy sau thay đổi (bao gồm `navigationMap`, `electronWindowConfig`,
   `inlineStyleAudit`, các test glass), THE Ứng_Dụng SHALL giữ tất cả kiểm thử trước đây đạt vẫn
   đạt, với 0 thất bại mới và số test bị skip không tăng so với baseline.

### Requirement 7: Bảo mật bề mặt mới (auth, secret, input)

**User Story:** Là chủ sản phẩm, tôi muốn mọi bề mặt mới tuân thủ security-baseline, để không tạo
lỗ hổng khi mở rộng môi trường agent.

#### Acceptance Criteria

1. THE Ứng_Dụng SHALL NOT tạo bất kỳ bề mặt nào chạy loop/agent hoặc ghi dữ liệu ra mạng mà
   không qua xác thực (izzi key hoặc JWT) và hạn mức/billing như các surface `/v1`, `/api` khác.
2. THE Ứng_Dụng SHALL giữ mọi API key/secret của agent ở tiến trình main (không lộ ra renderer),
   như cơ chế `dockerAgent` qua IPC hiện có.
3. WHERE Loop_Dock áp cấu hình từ dữ liệu preset, THE Ứng_Dụng SHALL truy cập các trường bằng
   own-property/lookup tường minh, không đi theo prototype-chain (chống prototype pollution).
4. THE Ứng_Dụng SHALL NOT ghi balance/plan kèm danh tính người dùng vào memory graph hay
   Obsidian vault; dữ liệu nhạy cảm chỉ hiển thị tại runtime.

### Requirement 8: Khả năng kiểm chứng

**User Story:** Là người rà soát, tôi muốn xác minh được Agent_Workspace đã dựng đúng và không
hồi quy, để biết chắc công việc hoàn tất.

#### Acceptance Criteria

1. THE Ứng_Dụng SHALL cho phép kiểm chứng Agent_Rail liệt kê đủ số agent trong `TOP_AGENTS` và
   nhóm đúng theo `AgentCategory` bằng một unit test trên hàm/dữ liệu thuần.
2. THE Ứng_Dụng SHALL cho phép kiểm chứng logic áp cấu hình Loop (Req 3.3/3.4/3.6) bằng unit
   test trên hàm thuần (chọn loop → cấu hình phiên), bao gồm ca không có phiên và ca agent
   gợi ý không khớp.
3. THE Ứng_Dụng SHALL cho phép kiểm chứng không hồi quy điều hướng và cấu hình Electron bằng
   các test hiện có (`navigationMap`, `electronWindowConfig`) tiếp tục đạt.
4. WHEN toàn bộ điều kiện nghiệm thu của Req 1–7 được rà soát và đạt, THE Agent_Workspace
   SHALL được coi là hoàn tất phạm vi bản này.

## Các quyết định mở (cần người dùng chốt trước khi sang design.md)

1. **Giữ Sidebar trái?** Đề xuất: GIỮ (Gumloop cũng có nav trái; bắt buộc theo Hợp_Đồng_Glass
   Req 9). Bố cục cuối: `[nav trái | chat giữa | rail agent/loop phải]`.
2. **Loop là gì cụ thể?** Đề xuất: bản này = preset tĩnh theo nhiệm vụ (Nghiên cứu, Tự động hoá,
   Lập trình, Nội dung...). Thực thi/scheduler + tie-in agent-memory (second brain) để phase sau.
3. **Tab izzi nào ưu tiên đồng bộ?** Đề xuất thứ tự: Agent Workspace (core) → Cost/Billing →
   Models/Providers → Knowledge/Graph (đánh dấu phase sau) → Marketplace/Extensions → Account.


---

## Requirements — Các phase tiếp theo (desktop, runnable)

> Phase 1 (Req 1–8) đã hoàn tất. Các requirement dưới đây phủ phần việc **làm được trong repo
> desktop này** và an toàn để "run all". Phần cross-repo (izzi-backend) + release nằm ở mục
> "Ngoài phạm vi run-all" trong `tasks.md`.

### Requirement 9: Loop UX hoàn thiện (Phase 2)

**User Story:** Là người dùng, tôi muốn chọn một loop là có ngay khung công việc để bắt đầu, để
loop thực sự hữu ích chứ không chỉ đổi model.

#### Acceptance Criteria

1. THE mô hình `AgentLoop` SHALL có thêm trường `starterPrompt`; WHEN người dùng chọn một loop,
   THE Ứng_Dụng SHALL chèn `starterPrompt` vào ô soạn tin (draft) và SHALL NOT tự động gửi.
2. THE Ứng_Dụng SHALL ghi nhớ loop (task) gần nhất được chọn cho phiên đang hoạt động và hiển
   thị trạng thái active tương ứng trong Loop_Dock.
3. WHERE người dùng xem chi tiết một loop, THE Ứng_Dụng SHALL hiển thị mô tả, agent gợi ý và
   model gợi ý của loop đó.
4. THE logic seed/ghi-nhớ loop SHALL là hàm thuần, kiểm thử được, và SHALL NOT chạy nền,
   scheduler hay ghi ra mạng.

### Requirement 10: Panel Ngữ cảnh / Bộ nhớ (read-only, Phase 3)

**User Story:** Là người dùng, tôi muốn thấy ngữ cảnh/bộ nhớ trước đó của agent đang chọn, để
tiếp nối công việc — đây là phía ĐỌC của "second brain".

#### Acceptance Criteria

1. THE Ứng_Dụng SHALL hiển thị một panel ngữ cảnh/bộ nhớ **chỉ-đọc** cho agent đang chọn.
2. THE Ứng_Dụng SHALL feature-detect nguồn dữ liệu (qua `electronAPI`/izzi); IF nguồn không khả
   dụng THEN THE Ứng_Dụng SHALL hiển thị empty state hợp lệ và SHALL NOT bịa dữ liệu.
3. THE Ứng_Dụng SHALL NOT ghi hoặc hiển thị secret/PII; chỉ hiển thị tiêu đề/nguồn không nhạy cảm.
4. WHERE một mục bộ nhớ được hiển thị, THE Ứng_Dụng SHALL kèm nguồn của mục đó (no-orphan phía đọc).

### Requirement 11: Surface điều hướng Knowledge/Graph (Phase 4)

**User Story:** Là người dùng hệ sinh thái izzi, tôi muốn mở Knowledge/Graph ngay trong tool,
đồng bộ với `/aibase/graph` của izzi.

#### Acceptance Criteria

1. THE Ứng_Dụng SHALL thêm một surface điều hướng `knowledge` (Knowledge/Graph) vào tập Page và
   Sidebar, đồng thời **giữ nguyên** toàn bộ page và cặp điều hướng đã có (chỉ thêm, không bớt).
2. WHEN thêm `knowledge`, THE Ứng_Dụng SHALL cập nhật baseline của `navigationMap.test.ts` để
   bao gồm `knowledge` và SHALL giữ mọi kiểm thử khác tiếp tục đạt.
3. THE KnowledgePage SHALL hiển thị dữ liệu graph nếu API khả dụng (feature-detect), ELSE hiển
   thị empty state + CTA mở izzi web; **chỉ-đọc**, không tạo bề mặt ghi thiếu xác thực.
4. THE Ứng_Dụng SHALL dùng Hệ_Token_Glass cho KnowledgePage, không thêm literal màu/nền mới.

### Requirement 12: Đồng bộ thiết kế & token với izzi (Phase 5)

**User Story:** Là người dùng, tôi muốn mọi surface mới đồng bộ token và IA với izzi, để trải
nghiệm nhất quán.

#### Acceptance Criteria

1. THE mọi surface mới SHALL tham chiếu Hệ_Token_Glass; số literal màu/nền mới ngoài token = 0.
2. THE `design.md` SHALL chứa và giữ cập nhật bản đồ IA tab tool ↔ izzi.
3. WHEN build và bộ test chạy, THE Ứng_Dụng SHALL đạt toàn bộ, và `inlineStyleAudit` SHALL không
   phát hiện Inline_Style_Trình_Bày mới trong các tệp đã đụng.
