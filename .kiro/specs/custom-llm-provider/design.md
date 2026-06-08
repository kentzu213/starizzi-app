# Design — Custom LLM Provider

## Overview

Tính năng cho phép người dùng cắm một endpoint LLM tương thích OpenAI của riêng họ và dùng
ngay trong app, đứng cạnh managed runner mặc định (IzziAPI). Thiết kế theo kiến trúc đã chọn
trong `architecture_selection.md`: **Provider-Strategy + Secret-Store boundary** trong main
process. Điểm cốt lõi:

- Một interface `ChatProvider` chung; `ManagedAgentProvider` (đã có) và `CustomOpenAIProvider`
  (mới) cùng implement.
- `ProviderResolver` chọn provider active (managed XOR custom) và là nơi duy nhất enforce routing.
- `SecretStore` là ranh giới bí mật duy nhất chạm API key (bọc Electron `safeStorage` +
  `DatabaseManager.setSetting`, tái dùng đúng pattern của `auth-manager.ts`).
- `ProviderSettingsStore` giữ cấu hình non-secret + flag, validate domain.
- Contract IPC `agent:sendMessage` và sự kiện `agent:stream` **không đổi** → renderer chat
  không phải sửa; chỉ thêm IPC mới cho cấu hình provider và một section UI trong Settings.

Khác biệt auth quan trọng đã phản ánh: endpoint người dùng dùng `Authorization: Bearer`,
izziapi.com dùng `x-api-key` → `CustomOpenAIProvider` dựng header theo `authType` đã cấu hình.

## Architecture

> Đã đọc lại `architecture_selection.md` trước khi viết phần này.

```
Renderer (Settings: section "Custom Provider")
   │  electronAPI.customProvider.{getConfig,saveConfig,setEnabled,deleteKey,testConnection}
   ▼ (IPC: customProvider:*)
Main process
   ┌─────────────────────────────────────────────────────────────┐
   │ AgentService.sendMessage → runManagedRequest                 │
   │        │ (đổi: không new ManagedAgentProvider trực tiếp)     │
   │        ▼                                                      │
   │ ProviderResolver.resolve()                                   │
   │     ├─ đọc ProviderSettingsStore (useCustomProvider, config) │
   │     ├─ nếu custom hợp lệ → SecretStore.getKey() (tạm)        │
   │     │        └→ new CustomOpenAIProvider(config, key)        │
   │     └─ ngược lại → ManagedAgentProvider (như cũ)             │
   │                                                              │
   │ <ChatProvider>.streamChat(request) → yield ManagedProvider-  │
   │     StreamChunk → AgentService emit 'agent:stream'           │
   └─────────────────────────────────────────────────────────────┘
SecretStore  ──(safeStorage encrypt/decrypt)──> DatabaseManager.settings
ProviderSettingsStore ──(JSON non-secret)──> DatabaseManager.settings
```

Luồng chat hiện tại được giữ nguyên: `AgentService.runManagedRequest()` vẫn lặp
`for await (const event of provider.streamChat(...))` và emit cùng các sự kiện
(`assistant_start`/`assistant_delta`/`assistant_done`/`status`/`error`). Điểm thay đổi duy nhất
trong `AgentService` là nguồn `provider`: từ "field cố định" → "kết quả của `resolver.resolve()`
mỗi request".

## Components and Interfaces

### 1. `ChatProvider` (interface mới) — `apps/desktop/src/main/agent/chat-provider.ts`

```ts
export interface ChatProvider {
  streamChat(request: ManagedAgentStreamRequest): AsyncGenerator<ManagedProviderStreamChunk>;
  getStatus(sessionId?: string): Promise<ManagedAgentStatus | null>;
  testConnection?(): Promise<ProviderTestResult>;
}

export interface ProviderTestResult {
  ok: boolean;
  model?: string;
  // message đã được redact key trước khi tới đây
  message?: string;
  httpStatus?: number;
}
```

`ManagedAgentProvider` hiện đã có `streamChat`/`getStatus` đúng chữ ký → chỉ cần
`implements ChatProvider` (không đổi hành vi).

### 2. `CustomOpenAIProvider` (mới) — `apps/desktop/src/main/agent/custom-openai-provider.ts`

```ts
export class CustomOpenAIProvider implements ChatProvider {
  constructor(
    private config: CustomProviderConfig,   // non-secret
    private apiKey: string,                  // nhận tham số tạm từ Resolver; KHÔNG lưu ra ngoài
  ) {}

  private getChatUrl(): string {
    // Tái dùng quy tắc tránh double-path như ManagedAgentProvider.getChatUrl:
    // nếu baseUrl đã kết thúc bằng /chat/completions → dùng nguyên;
    // nếu kết thúc bằng /v1 → nối /chat/completions; ngược lại nối /v1/chat/completions.
  }

  private buildHeaders(): Record<string, string> {
    const headers = { 'Content-Type': 'application/json', Accept: 'text/event-stream' };
    if (this.config.authType === 'bearer') headers['Authorization'] = `Bearer ${this.apiKey}`;
    else headers['x-api-key'] = this.apiKey;
    return headers;
  }

  async *streamChat(request) { /* POST + SSE parse: tái dùng nguyên logic SSE của
     ManagedAgentProvider (data: {choices:[{delta:{content}}]}, [DONE], finish_reason==='stop') */ }

  async testConnection(): Promise<ProviderTestResult> { /* 1 request nhỏ, max_tokens thấp */ }

  async getStatus() { return { state: 'idle', updatedAt: new Date().toISOString() }; }
}
```

Lưu ý chống lặp code: phần parse SSE nên được tách thành một helper dùng chung
(`streamOpenAISse(response)`), để `ManagedAgentProvider` và `CustomOpenAIProvider` dùng lại
cùng một parser — tránh god object và đảm bảo INV-9 (stream contract giống nhau).

### 3. `ProviderResolver` (mới) — `apps/desktop/src/main/agent/provider-resolver.ts`

```ts
export class ProviderResolver {
  constructor(
    private settings: ProviderSettingsStore,
    private secrets: SecretStore,
    private managed: ManagedAgentProvider,
  ) {}

  // Trả về provider active cho request hiện tại. Enforce XOR + guard.
  resolve(): ChatProvider {
    if (!this.settings.isCustomEnabled()) return this.managed;       // INV-6
    const cfg = this.settings.getConfig();
    const validation = validateCustomConfig(cfg);                    // INV-3/4
    const key = this.secrets.getKey();                               // tạm thời
    if (!validation.ok || !key) return this.managed;                 // INV-8 guard
    return new CustomOpenAIProvider(cfg, key);                       // INV-5/7
  }
}
```

### 4. `ProviderSettingsStore` (mới) — `apps/desktop/src/main/agent/provider-settings-store.ts`

- Lưu/đọc JSON non-secret qua `DatabaseManager.setSetting('custom_provider_config', json)` và
  `setSetting('custom_provider_enabled', '0'|'1')`.
- `validateCustomConfig()`: kiểm tra `baseUrl` là https hợp lệ (`new URL` + `protocol==='https:'`),
  `authType ∈ {bearer, x-api-key}`, `selectedModel ∈ ALLOWED_MODELS`.
- `getMaskedView()`: trả config + `hasKey` + `maskedKeyHint` (lấy từ SecretStore, KHÔNG full key).

```ts
export const ALLOWED_MODELS = ['gpt-5.5', 'gpt-5.4', 'gpt-5.4-mini', 'gpt-5.3-codex'] as const;
export type AllowedModel = typeof ALLOWED_MODELS[number];
```

### 5. `SecretStore` (mới, security boundary) — `apps/desktop/src/main/agent/secret-store.ts`

Tái dùng đúng pattern của `auth-manager.ts`:

```ts
export class SecretStore {
  constructor(private db: DatabaseManager) {}
  private static KEY = 'custom_provider_api_key';

  setKey(plain: string): void {
    const enc = safeStorage.isEncryptionAvailable()
      ? safeStorage.encryptString(plain).toString('base64')
      : plain; // ghi diagnostic cảnh báo (KHÔNG log giá trị)
    this.db.setSetting(SecretStore.KEY, enc);
  }
  getKey(): string | null {
    const stored = this.db.getSetting(SecretStore.KEY);
    if (!stored) return null;
    return safeStorage.isEncryptionAvailable()
      ? safeStorage.decryptString(Buffer.from(stored, 'base64')) : stored;
  }
  deleteKey(): void { this.db.deleteSetting(SecretStore.KEY); }
  hasKey(): boolean { return !!this.db.getSetting(SecretStore.KEY); }
  maskedHint(): string | null { const k = this.getKey(); return k ? '••••' + k.slice(-4) : null; }
  redact(text: string): string { const k = this.getKey(); return k ? text.split(k).join('••••') : text; }
}
```

`SecretStore` là **component duy nhất** gọi `safeStorage`/đọc raw key. Mọi nơi khác chỉ nhận key
qua tham số tạm (Resolver → CustomProvider) hoặc nhận masked hint.

### 6. Thay đổi `AgentService` (đã có) — `apps/desktop/src/main/agent/agent-service.ts`

- Constructor khởi tạo `SecretStore`, `ProviderSettingsStore`, `ProviderResolver` (giữ
  `ManagedAgentProvider` như field managed).
- Trong `runManagedRequest()`: thay `this.provider.streamChat(...)` bằng
  `this.resolver.resolve().streamChat(...)`. Phần còn lại không đổi → giữ contract sự kiện.
- Thêm các method mỏng: `getProviderConfig()`, `saveProviderConfig()`, `setCustomEnabled()`,
  `deleteProviderKey()`, `testProviderConnection()` để IPC gọi.

### 7. Preload + IPC (mới) — `apps/desktop/src/main/preload.ts`, `apps/desktop/src/main/index.ts`

Thêm namespace `customProvider` vào `electronAPI`, tái dùng pattern `ipcRenderer.invoke`:

| IPC channel | Tham số | Trả về |
|-------------|---------|--------|
| `customProvider:getConfig` | – | `{ config, enabled, hasKey, maskedKeyHint }` (KHÔNG full key) |
| `customProvider:saveConfig` | `{ baseUrl, authType, selectedModel, apiKey? }` | `{ ok, errors? }` |
| `customProvider:setEnabled` | `enabled: boolean` | `{ ok, activeProvider, errors? }` |
| `customProvider:deleteKey` | – | `{ ok }` |
| `customProvider:testConnection` | `{ apiKey? }` (key tạm chưa lưu) | `ProviderTestResult` (đã redact) |

`index.ts` đăng ký `ipcMain.handle(...)` cho từng channel, ủy quyền cho `agentService`
(giống các handler `agent:*` hiện có).

### 8. UI — `apps/desktop/src/renderer/pages/Settings.tsx`

- Thêm `'customProvider'` vào `SettingsSectionId` và mảng `SECTIONS` (label "Custom Provider").
- Thêm `CustomProviderSection` tái dùng class CSS sẵn có (`card`, `card__header`, `settings-group`,
  `settings-item`, `btn btn--primary/secondary/ghost`, `action-row`). Gồm:
  - Toggle "Dùng custom provider".
  - Input base URL.
  - Select kiểu auth (`Bearer` | `x-api-key`).
  - Select model (4 lựa chọn cố định).
  - Input API key (`type="password"`); nếu đã có key thì hiển thị masked hint + nút "Xoá key".
  - Nút "Test connection" và "Lưu".
  - Vùng lỗi gọn tái dùng pattern `summarizeError` (đã có trong file) cho chi tiết.
- `agent-registry.ts` đã có sẵn nhánh `id: 'custom'` (apiKeyRequired/models[]) — có thể tham
  chiếu nhưng danh sách model dùng cho tính năng này là `ALLOWED_MODELS` cố định ở main process
  (nguồn chân lý), tránh phụ thuộc registry renderer cho ràng buộc domain (INV-3 validate ở main).

## Data Models

```ts
// Non-secret — lưu plaintext JSON qua db.setSetting('custom_provider_config')
export interface CustomProviderConfig {
  baseUrl: string;                 // https hợp lệ
  authType: 'bearer' | 'x-api-key';
  selectedModel: AllowedModel;     // ∈ ALLOWED_MODELS
}

// Flag — db.setSetting('custom_provider_enabled', '0' | '1')
// Secret — db.setSetting('custom_provider_api_key', <base64 safeStorage>)  (chỉ SecretStore chạm)

export type ActiveProvider = 'managed' | 'custom';
```

Nơi lưu:
- Config + flag: SQLite `settings` table qua `DatabaseManager.{getSetting,setSetting,deleteSetting}`
  (không phải file commit).
- API key: cùng `settings` table NHƯNG giá trị đã được `safeStorage` mã hoá (base64). Không bao
  giờ ghi vào `~/.openclaw/openclaw.json` hay bất kỳ file repo.

`activeProvider` là giá trị suy ra: `enabled && valid(config) && hasKey ? 'custom' : 'managed'`
(không lưu riêng để tránh lệch trạng thái — nguồn chân lý là `enabled` + validation).

## Error Handling

Tái dùng cơ chế hiện tại: lỗi từ `streamChat` được `AgentService.runManagedRequest()` bắt, set
message state = `error`, emit `status: error` + event `error`. Bổ sung cho custom provider:

| Tình huống | Hành vi |
|-----------|---------|
| HTTP 401/403 | Thông báo gọn: "Xác thực thất bại (HTTP 401) — kiểm tra API key/kiểu auth". KHÔNG đổ raw body, KHÔNG lộ key (R6.1, INV-10) |
| HTTP 4xx/5xx khác | "Endpoint trả HTTP <mã>" + 1 dòng tóm tắt; chi tiết raw chỉ hiện khi người dùng bấm "Xem chi tiết" (pattern `summarizeError`) |
| Timeout/mạng | "Không kết nối được tới endpoint / hết thời gian chờ" (axios timeout giữ 120000ms như managed) |
| Config invalid khi gửi | Resolver fallback managed theo INV-8; UI đã chặn bật từ trước (R5) |
| Lỗi bất kỳ | `SecretStore.redact(message)` trước khi ghi diagnostic/emit (R6.4) |

Không tự fallback ngầm sang managed khi custom lỗi runtime (R6.5) — báo lỗi rõ để người dùng sửa
cấu hình. (Resolver chỉ fallback ở thời điểm `resolve()` khi config/keys không hợp lệ, không phải
khi request thất bại.)

## Security

Đây là mục bảo mật hạng nhất, ánh xạ Requirement 1:

1. **Lưu key qua safeStorage:** chỉ `SecretStore` gọi `safeStorage.encryptString/decryptString`,
   lưu base64 vào `settings` table (tái dùng pattern `auth-manager.ts`). Không ghi key vào file
   commit (R1.1, INV-2).
2. **Khi safeStorage không khả dụng:** vẫn lưu được nhưng ghi diagnostic cảnh báo, tuyệt đối
   không kèm giá trị key (R1.2).
3. **Không log key:** không component nào in key ra console/log/diagnostic; mọi message lỗi đi qua
   `SecretStore.redact()` (R1.3, R6.4, INV-1/10).
4. **Masked khi hiển thị:** IPC `getConfig` chỉ trả `maskedKeyHint` (4 ký tự cuối) + `hasKey`,
   không bao giờ trả full key về renderer (R1.4).
5. **Xoá key:** `deleteKey()` xoá khỏi `settings`; request kế tiếp sẽ thiếu key → Resolver fallback
   managed (R1.5).
6. **Truyền key tối thiểu:** key chỉ rời `SecretStore` dưới dạng tham số tạm cho
   `CustomOpenAIProvider` ngay trước khi gửi HTTP; không lưu thành thuộc tính bền vững, không đưa
   vào log/diagnostic.
7. **Không commit key thật:** mọi tài liệu/ví dụ/test chỉ dùng placeholder `<YOUR_API_KEY>` /
   `cpa_xxx...` (R1.7).
8. **Cảnh báo bảo mật chung:** endpoint gọi đi qua HTTPS (validate `protocol==='https:'`), tránh gửi
   key qua kênh không mã hoá.

## Testing Strategy

Unit test (Jest/Vitest theo cấu hình hiện có của `apps/desktop`; KHÔNG dùng key thật — chỉ
placeholder/fake):

1. **Auth-header builder** (`CustomOpenAIProvider.buildHeaders`): `authType='bearer'` ⇒ có
   `Authorization: Bearer <fake>`, không có `x-api-key`; `authType='x-api-key'` ⇒ ngược lại
   (R4.2/4.3, INV-7).
2. **Model validation** (`validateCustomConfig`): model ∈ ALLOWED_MODELS pass; ngoài danh sách
   fail; baseUrl non-https fail; authType lạ fail (R5, INV-3/4).
3. **Provider resolver** (`ProviderResolver.resolve`): enabled=false ⇒ managed; enabled=true +
   config hợp lệ + có key ⇒ custom; enabled=true nhưng thiếu key/invalid ⇒ managed (R3/R8,
   INV-5/6/8).
4. **getChatUrl**: baseUrl kết thúc `/v1` ⇒ nối `/chat/completions`; kết thúc
   `/chat/completions` ⇒ giữ nguyên (không double-path).
5. **SSE parser dùng chung**: feed chuỗi SSE giả lập (`data: {...delta...}`, `[DONE]`,
   `finish_reason:'stop'`) ⇒ yield đúng `assistant_delta`/`assistant_done` (INV-9). Mock HTTP
   (axios) trả stream giả.
6. **Secret redaction** (`SecretStore.redact`): message chứa fake key ⇒ bị che; (INV-1/10).
   `maskedHint` ⇒ chỉ 4 ký tự cuối.
7. **Error mapping**: mock HTTP 401 ⇒ message gọn không chứa raw body/key (R6.1).
8. **Smoke test store**: set→get→delete config/flag qua `DatabaseManager` (in-memory) hoạt động;
   key set ⇒ `hasKey` true, get trả lại đúng giá trị fake, delete ⇒ `hasKey` false.

Mock: dùng axios mock cho mọi HTTP (không gọi mạng thật), `safeStorage` có thể mock
`isEncryptionAvailable` cả hai nhánh. Test connection (R7) test với mock 2xx/4xx, key tạm không
được log.

Bảo toàn: thêm 1 test khẳng định khi `enabled=false`, resolver trả về đúng instance
`ManagedAgentProvider` và luồng managed không bị thay đổi (R8).

## Correctness Properties

Các bất biến do thiết kế áp đặt (ánh xạ từ phân tích → mục tiêu kiểm thử property/example):

### Property 1: Cô lập bí mật (INV-1/2/10)

Với mọi đường thực thi, giá trị API key không xuất hiện trong log/diagnostic/error message;
`SecretStore` là nơi duy nhất gọi `safeStorage`. Test: redact mọi message lỗi chứa key giả ⇒
không còn key.

**Validates: Requirements 1.1, 1.3, 1.6, 6.4**

### Property 2: Header đúng theo authType (INV-7)

`authType='bearer'` ⇒ luôn chỉ có header `Authorization: Bearer …`; `authType='x-api-key'` ⇒ luôn
chỉ có header `x-api-key`. Hai header không bao giờ xuất hiện đồng thời.

**Validates: Requirements 4.2, 4.3**

### Property 3: Model luôn hợp lệ (INV-3)

Cấu hình lưu/được dùng luôn có `selectedModel ∈ ALLOWED_MODELS`; giá trị ngoài danh sách bị từ
chối ở main process.

**Validates: Requirements 2.2, 5.2**

### Property 4: Định tuyến XOR (INV-5/6/8)

`resolve()` luôn trả đúng một provider; `enabled=false` ⇒ managed; `enabled=true` nhưng config
invalid/thiếu key ⇒ managed (không bao giờ trả custom không hợp lệ).

**Validates: Requirements 3.3, 3.4, 8.1**

### Property 5: Stream contract bất biến (INV-9)

Managed và custom phát cùng tập sự kiện
(`assistant_start`/`assistant_delta`/`assistant_done`/`status`/`error`) với cùng kiểu
`ManagedProviderStreamChunk` ⇒ renderer không phân biệt được nguồn provider.

**Validates: Requirements 4.4, 4.6, 8.5**

### Property 6: URL https (INV-4)

Mọi `baseUrl` được chấp nhận đều parse được và có `protocol==='https:'`.

**Validates: Requirements 5.1**
