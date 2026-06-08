# Requirements Document

## Introduction

Hiện tại desktop app (Electron + React + TypeScript ở `apps/desktop`) chỉ chạy chat qua
managed runner mặc định của IzziAPI: `ManagedAgentProvider.streamChat()` đọc cấu hình từ
`~/.openclaw/openclaw.json` (`getLocalConfig()`), gọi `POST <baseUrl>/chat/completions`
với header `x-api-key`, body OpenAI-compatible và parse SSE.

Tính năng **Custom LLM Provider** cho phép người dùng tự cắm một endpoint LLM
tương thích OpenAI của riêng họ (ví dụ `https://cpab.hiennq.dev/v1/chat/completions`),
khai báo base URL, API key, kiểu auth (`Bearer` hoặc `x-api-key`) và chọn model trong
một danh sách cố định, rồi bật để dùng thay cho managed runner. Khi tắt, app quay lại
managed runner như cũ. Quản lý cấu hình nằm ở một section mới trong trang Settings
(tái dùng pattern tab/section sẵn có).

Mục tiêu thiết kế:
- Đứng **cạnh** managed runner chứ không thay thế: managed runner luôn là fallback mặc định.
- Hỗ trợ khác biệt auth quan trọng: endpoint người dùng dùng `Authorization: Bearer`,
  còn izziapi.com dùng `x-api-key` → cấu hình cho phép chọn `authType`.
- **Bảo mật API key là ưu tiên hạng nhất** (Requirement 1): key nhập runtime, lưu mã hoá
  bằng Electron `safeStorage` (tái dùng pattern của `auth-manager.ts`), không bao giờ commit,
  không bao giờ log, chỉ hiển thị dạng masked.

### Phạm vi model cho phép (cố định)
Custom provider CHỈ cho chọn 1 trong 4 model:
`gpt-5.5`, `gpt-5.4`, `gpt-5.4-mini`, `gpt-5.3-codex`.

## Glossary

- **Managed runner**: luồng hiện tại qua `ManagedAgentProvider` + `getLocalConfig()`.
- **Custom provider**: endpoint OpenAI-compatible do người dùng tự khai báo.
- **Active provider**: provider đang được dùng cho `sendMessage` tại một thời điểm.
- **Secure storage**: Electron `safeStorage` mã hoá → lưu base64 qua `DatabaseManager.setSetting`.
- **Masked key**: chuỗi che, chỉ lộ 4 ký tự cuối (ví dụ `••••••••abcd`).

---

## Requirements

## Requirement 1 — Bảo mật API key (HẠNG NHẤT)

**User Story:** Là người dùng cắm endpoint LLM riêng, tôi muốn API key của mình được lưu
an toàn và không bao giờ bị lộ qua repo, log hay UI, để key không bị rò rỉ.

#### Acceptance Criteria

1. WHEN người dùng lưu một API key cho custom provider THEN the system SHALL mã hoá key
   bằng Electron `safeStorage.encryptString` (nếu `safeStorage.isEncryptionAvailable()`)
   trước khi lưu, và lưu chuỗi base64 qua `DatabaseManager.setSetting` (KHÔNG lưu plaintext
   vào file config được commit).
2. WHERE `safeStorage.isEncryptionAvailable()` trả về `false` THEN the system SHALL vẫn
   lưu được key nhưng SHALL ghi một diagnostic event cảnh báo rằng mã hoá OS không khả dụng,
   và SHALL KHÔNG ghi giá trị key vào diagnostic đó.
3. WHEN bất kỳ thành phần nào ghi log/console hoặc diagnostic event liên quan tới custom
   provider THEN the system SHALL KHÔNG bao giờ in giá trị API key (full hoặc một phần >
   4 ký tự cuối) ra log.
4. WHEN UI hiển thị lại key đã lưu THEN the system SHALL chỉ hiển thị dạng masked (tối đa
   4 ký tự cuối), KHÔNG bao giờ trả full key về renderer trừ khi người dùng đang nhập mới.
5. WHEN người dùng bấm "Xoá key" THEN the system SHALL xoá bản mã hoá khỏi secure storage
   (`deleteSetting`) và SHALL đảm bảo key không còn được dùng cho request kế tiếp.
6. WHEN một lỗi (HTTP/exception) được tạo ra từ luồng custom provider THEN the system SHALL
   redact mọi chuỗi giống API key trong message lỗi trước khi hiển thị hoặc ghi diagnostic.
7. THE system SHALL KHÔNG ghi API key thật vào bất kỳ file nào nằm trong repository
   (config commit, source, test, ví dụ); mọi ví dụ SHALL dùng placeholder
   (ví dụ `<YOUR_API_KEY>`, `cpa_xxx...`).

---

## Requirement 2 — Cấu hình custom provider

**User Story:** Là người dùng, tôi muốn nhập base URL, API key, kiểu auth và chọn model,
để khai báo endpoint LLM riêng của mình.

#### Acceptance Criteria

1. WHEN người dùng mở section "Custom Provider" trong Settings THEN the system SHALL hiển thị
   form gồm: base URL, API key, kiểu auth (`Bearer` | `x-api-key`), và model selector.
2. WHEN người dùng chọn model THEN the system SHALL chỉ cho chọn 1 trong danh sách cố định
   `{gpt-5.5, gpt-5.4, gpt-5.4-mini, gpt-5.3-codex}`.
3. WHEN người dùng chọn kiểu auth THEN the system SHALL cho chọn đúng một trong hai:
   `Bearer` (header `Authorization: Bearer <API_KEY>`) hoặc `x-api-key`
   (header `x-api-key: <API_KEY>`), mặc định là `Bearer`.
4. WHEN người dùng bấm "Lưu" với cấu hình hợp lệ THEN the system SHALL lưu base URL, authType,
   selectedModel (non-secret) và lưu API key riêng qua secure storage (Requirement 1).
5. WHEN người dùng mở lại Settings sau khi đã lưu THEN the system SHALL khôi phục base URL,
   authType, selectedModel và hiển thị key dạng masked nếu đã có key.
6. WHEN người dùng sửa và lưu lại cấu hình THEN the system SHALL cập nhật cấu hình mà KHÔNG
   yêu cầu nhập lại key nếu key cũ vẫn còn (trừ khi người dùng chủ động nhập key mới hoặc xoá).

---

## Requirement 3 — Bật/tắt và chọn active provider

**User Story:** Là người dùng, tôi muốn bật/tắt việc dùng custom provider, để chuyển qua lại
giữa managed runner mặc định và endpoint riêng của tôi.

#### Acceptance Criteria

1. WHEN người dùng bật toggle "Dùng custom provider" THEN the system SHALL đặt active provider
   = custom cho các `sendMessage` kế tiếp.
2. WHEN người dùng tắt toggle THEN the system SHALL đặt active provider = managed (mặc định)
   cho các `sendMessage` kế tiếp.
3. THE system SHALL đảm bảo tại mọi thời điểm chỉ có đúng một active provider (managed XOR custom).
4. WHEN người dùng bật custom provider NHƯNG cấu hình chưa hợp lệ (thiếu key, URL sai, model
   không hợp lệ) THEN the system SHALL từ chối bật, hiển thị lý do gọn và GIỮ active provider
   = managed.
5. WHEN trạng thái active provider thay đổi THEN the system SHALL persist lựa chọn để giữ
   nguyên sau khi khởi động lại app.

---

## Requirement 4 — Định tuyến chat tới active provider

**User Story:** Là người dùng đã bật custom provider, tôi muốn tin nhắn chat được gửi tới
endpoint riêng của tôi với đúng header auth và streaming, để dùng model của mình ngay trong app.

#### Acceptance Criteria

1. WHEN active provider = custom VÀ người dùng gửi tin nhắn (`sendMessage`) THEN the system
   SHALL gửi `POST` tới base URL custom (nối `/chat/completions` nếu base URL chưa có path
   đó, theo quy tắc tránh double `/v1` như managed runner) với body OpenAI-compatible
   (`{model, messages, stream:true}`).
2. WHEN active provider = custom VÀ authType = `Bearer` THEN the system SHALL đặt header
   `Authorization: Bearer <API_KEY>` (KHÔNG đặt `x-api-key`).
3. WHEN active provider = custom VÀ authType = `x-api-key` THEN the system SHALL đặt header
   `x-api-key: <API_KEY>` (KHÔNG đặt `Authorization`).
4. WHEN endpoint custom trả về SSE OpenAI-compatible THEN the system SHALL parse các chunk
   `data: {choices:[{delta:{content}}]}`, xử lý `[DONE]` và `finish_reason === 'stop'`,
   và stream delta về renderer giống hệt luồng managed hiện tại.
5. WHEN active provider = custom THEN the system SHALL gửi đúng `model` = selectedModel đã
   cấu hình trong body request.
6. THE system SHALL tái dùng cùng contract sự kiện stream (`assistant_start`,
   `assistant_delta`, `assistant_done`, `status`, `error`) để renderer không cần thay đổi cách
   hiển thị.

---

## Requirement 5 — Validation cấu hình

**User Story:** Là người dùng, tôi muốn được chặn lại khi nhập cấu hình sai, để tránh request
chắc chắn thất bại.

#### Acceptance Criteria

1. WHEN người dùng lưu hoặc bật custom provider THEN the system SHALL yêu cầu base URL là một
   URL `https` hợp lệ; WHEN URL không phải `https` hoặc không parse được THEN the system SHALL
   từ chối và hiển thị thông báo gọn.
2. WHEN người dùng lưu hoặc bật custom provider THEN the system SHALL yêu cầu selectedModel
   thuộc danh sách cho phép; WHEN model không hợp lệ THEN the system SHALL từ chối.
3. WHEN người dùng bật custom provider mà API key rỗng/chưa có THEN the system SHALL từ chối
   bật và hiển thị thông báo yêu cầu nhập key.
4. WHEN authType không thuộc `{Bearer, x-api-key}` THEN the system SHALL từ chối lưu.
5. WHERE việc validate diễn ra THEN the system SHALL thực hiện validate ở main process trước
   khi thực sự dùng cấu hình (không chỉ dựa vào validate phía renderer).

---

## Requirement 6 — Xử lý lỗi gọn gàng (không đổ raw)

**User Story:** Là người dùng, tôi muốn thấy thông báo lỗi ngắn gọn khi auth sai hoặc mạng
lỗi, để hiểu vấn đề mà không bị tràn ngập log thô.

#### Acceptance Criteria

1. WHEN endpoint custom trả HTTP 401/403 THEN the system SHALL hiển thị thông báo gọn dạng
   "Xác thực thất bại (HTTP 401) — kiểm tra API key/kiểu auth" mà KHÔNG đổ raw body và KHÔNG
   lộ key.
2. WHEN endpoint custom trả HTTP 4xx/5xx khác THEN the system SHALL hiển thị mã lỗi + một
   dòng tóm tắt (tái dùng pattern `summarizeError` ở Settings cho phần raw nếu cần xem chi tiết).
3. WHEN có lỗi mạng/timeout THEN the system SHALL hiển thị thông báo gọn ("Không kết nối được
   tới endpoint / hết thời gian chờ") và SHALL đặt trạng thái runtime = `error` qua cùng cơ chế
   `emitStatus` hiện tại.
4. WHEN một lỗi được tạo ra THEN the system SHALL redact API key khỏi mọi message trước khi
   ghi diagnostic hoặc hiển thị (liên kết Requirement 1.6).
5. WHEN custom provider lỗi THEN the system SHALL KHÔNG tự động fallback ngầm sang managed (để
   tránh che giấu cấu hình sai), mà SHALL báo lỗi rõ ràng cho người dùng.

---

## Requirement 7 — Test connection (tuỳ chọn nhưng nên có)

**User Story:** Là người dùng, tôi muốn bấm "Test connection" để xác minh key/URL/model trước
khi dùng, để biết cấu hình đúng mà không phải gửi tin nhắn thật.

#### Acceptance Criteria

1. WHEN người dùng bấm "Test connection" THEN the system SHALL gửi một request nhỏ
   (ví dụ `max_tokens` thấp, một message ngắn) tới endpoint custom với header auth và model
   đã cấu hình.
2. WHEN request test thành công (HTTP 2xx) THEN the system SHALL hiển thị kết quả "OK" kèm
   model đã xác minh.
3. WHEN request test thất bại THEN the system SHALL hiển thị lý do gọn theo Requirement 6
   (không đổ raw, không lộ key).
4. WHEN người dùng đang nhập key mới chưa lưu THEN the system SHALL cho phép test với key vừa
   nhập mà KHÔNG buộc phải lưu trước, và SHALL KHÔNG log key đó.

---

## Requirement 8 — Bảo toàn managed runner mặc định

**User Story:** Là người dùng (và để không phá vỡ hành vi hiện tại), tôi muốn managed runner
vẫn hoạt động y như cũ khi không bật custom provider.

#### Acceptance Criteria

1. WHEN active provider = managed (mặc định, hoặc sau khi tắt custom) THEN the system SHALL
   chạy luồng chat đúng như hiện tại qua `ManagedAgentProvider` + `getLocalConfig()` với header
   `x-api-key`, không thay đổi hành vi.
2. THE system SHALL KHÔNG sửa đổi đường dẫn config managed (`~/.openclaw/openclaw.json`) hay
   header/format request của managed runner.
3. WHEN custom provider chưa từng được cấu hình THEN the system SHALL mặc định active = managed
   và app SHALL hoạt động bình thường không có lỗi.
4. WHEN người dùng xoá toàn bộ cấu hình custom THEN the system SHALL trở về trạng thái như
   chưa từng cấu hình custom (active = managed).
5. THE system SHALL giữ nguyên contract IPC `agent:sendMessage` và contract sự kiện
   `agent:stream` để renderer hiện tại không phải thay đổi.
