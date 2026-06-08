# Architecture Selection — Custom LLM Provider

## Recommended Architecture

**Candidate A — Provider-Strategy + Secret-Store boundary (main process).**

Giới thiệu một interface `ChatProvider` chung. `ManagedAgentProvider` (đã có) và
`CustomOpenAIProvider` (mới) cùng implement interface này. Một `ProviderResolver` đọc
`ProviderSettingsStore` để quyết định provider nào đang active (managed XOR custom) và là nơi
duy nhất enforce quy tắc định tuyến. Một `SecretStore` riêng bọc Electron `safeStorage` +
`DatabaseManager.setSetting` là **ranh giới bí mật duy nhất** chạm `apiKey`. `AgentService` chỉ
gọi `resolver.resolve()` rồi `streamChat(request)`, giữ nguyên contract sự kiện stream.

## Rationale

Kiến trúc này đạt flow density thấp nhất (~0.30, đồ thị gọn một chiều) và cô lập bí mật vào
**đúng một component** (`SecretStore`, số component chạm key = 1) — trực tiếp đáp ứng yêu cầu bảo
mật hạng nhất. Routing được tập trung vào một `ProviderResolver` nên các invariant XOR/header/guard
được enforce tại một nơi thay vì rải khắp code, và việc thêm provider tương lai chỉ là implement
`ChatProvider`.

## Components

| Component | Loại | State sở hữu | Trách nhiệm (1 dòng) |
|-----------|------|--------------|----------------------|
| `ChatProvider` | Interface (mới) | – | Hợp đồng `streamChat()` + `testConnection()` chung cho mọi provider |
| `ManagedAgentProvider` | Class (đã có) | – | Luồng managed hiện tại (x-api-key, `getLocalConfig`) — bọc dưới interface, hành vi không đổi |
| `CustomOpenAIProvider` | Class (mới) | – | Build header theo `authType`, POST base URL custom, parse SSE OpenAI-compatible |
| `ProviderResolver` | Module (mới) | – | Chọn managed/custom theo settings; enforce XOR + guard hợp lệ |
| `ProviderSettingsStore` | Module (mới) | `CustomProviderConfig`, `useCustomProvider`, `activeProvider` | Lưu/đọc cấu hình non-secret + validate domain |
| `SecretStore` | Module (mới) | `apiKey` (encrypted) | **Security boundary**: encrypt/decrypt/mask/delete/redact key |
| `AgentService` | Class (đã có) | `runtimeState` | Orchestrate request, emit stream — gọi resolver thay vì khởi tạo provider trực tiếp |

## Information Flow

Ký hiệu: → gọi/ghi một chiều, ← nhận kết quả, – không có cạnh.

| Từ \ Tới | Resolver | SettingsStore | SecretStore | ManagedProvider | CustomProvider | AgentService |
|----------|----------|---------------|-------------|-----------------|----------------|--------------|
| `AgentService` | → | – | – | – | – | – |
| `ProviderResolver` | – | → | → (chỉ lấy key để đưa CustomProvider) | → | → | ← |
| `CustomOpenAIProvider` | – | – | ← (nhận key qua tham số tạm) | – | – | → stream |
| `ManagedAgentProvider` | – | – | – | – | – | → stream |
| `ProviderSettingsStore` | – | – | – | – | – | – |
| `SecretStore` | – | – | – | – | – | – |

Đặc điểm: đồ thị hướng một chiều (AgentService → Resolver → {SettingsStore, SecretStore,
Providers}); không có chu trình đồng bộ; `SecretStore` có fan-in = 1.

## Requirement Allocation

| REQ | Component chính | Ghi chú |
|-----|-----------------|---------|
| R1 Bảo mật key | `SecretStore` | encrypt/mask/delete/redact tại một nơi |
| R2 Cấu hình | `ProviderSettingsStore` (+ `SecretStore` cho key) | non-secret tách secret |
| R3 Bật/tắt + active | `ProviderResolver` + `ProviderSettingsStore` | enforce XOR |
| R4 Định tuyến chat | `CustomOpenAIProvider` (Resolver chọn) | header theo authType |
| R5 Validation | `ProviderSettingsStore` + guard ở `ProviderResolver` | validate ở main process |
| R6 Error handling | `CustomOpenAIProvider` + `SecretStore.redact` | không đổ raw, không lộ key |
| R7 Test connection | `CustomOpenAIProvider.testConnection()` | dùng key tạm |
| R8 Bảo toàn managed | `ManagedAgentProvider` (giữ nguyên) + `ProviderResolver` | default = managed |

## Key Design-Induced Invariants

- **INV-1/2/10 (Security):** chỉ `SecretStore` chạm `apiKey`; key at-rest luôn mã hoá; mọi error
  rời main process đều qua `SecretStore.redact`. Thiết kế ép buộc bằng cách không component nào
  khác có quyền đọc raw key ngoài lúc resolver truyền tham số tạm cho `CustomOpenAIProvider`.
- **INV-5 (XOR active):** chỉ `ProviderResolver.resolve()` trả về đúng một provider — không có
  đường nào khác tạo provider.
- **INV-6/7 (Routing/header):** `useCustomProvider=false` ⇒ managed (x-api-key); custom ⇒ header
  đúng theo `authType` (bearer XOR x-api-key) do `CustomOpenAIProvider` dựng.
- **INV-3/4 (Domain):** `ProviderSettingsStore` chỉ chấp nhận `selectedModel` ∈ danh sách cho phép
  và `baseUrl` là https hợp lệ.
- **INV-8 (Guard):** `ProviderResolver` từ chối active=custom khi config invalid/key rỗng → fallback managed.
- **INV-9 (Compat):** mọi provider trả cùng kiểu `ManagedProviderStreamChunk` → renderer không đổi.

## Alternatives Considered

| Candidate | Strength | Weakness | Why Not Selected |
|-----------|----------|----------|------------------|
| **B — Config-driven mở rộng `getLocalConfig`/1 provider** | Ít component & file nhất, ship nhanh, tái dùng trực tiếp code SSE | Key bị đọc ở ≥2 nơi (god object); routing/HTTP/secret/parse trộn trong 1 class | Vi phạm bảo mật hạng nhất (INV-1/2/10 khó đảm bảo) và god object score cao |
| **C — Gateway/Event-oriented** | Tách rời mạnh, hợp khi cần nhiều endpoint/hot-swap theo session | Event async làm INV-5 (XOR) dễ race; flow density cao nhất (~0.55); nhiều cạnh ↔ | Over-engineering cho nhu cầu hiện tại (1 endpoint, 1 phiên) |

## Metrics Summary

| Metric | Selected (A) | Alt B | Alt C |
|--------|--------------|-------|-------|
| Cross-cutting requirements % | ~25% (khu trú rõ) | ~12% nhưng dồn 1 chỗ | ~50% |
| Cross-cutting invariants % | thấp (mỗi nhóm 1 owner) | cao (secret rải) | trung-cao |
| Flow density edges/(N(N-1)) | ~0.30 | ~0.50 | ~0.55 |
| God object score | thấp | **cao** | thấp |
| Sync cycles | 0 | 0 | nguy cơ vòng event |
| Max fan-in / fan-out | SecretStore fan-in=1; Resolver fan-out=3 | Provider* fan-in cao | Gateway fan-in/out cao |
| Evolvability cost (thêm provider) | thấp (implement interface) | cao (thêm if) | thấp |
| **# component chạm key (security)** | **1** | ≥2 | 1 |
