# Design: settings-redesign

## Overview

Thiết kế lại trang Settings (`apps/desktop/src/renderer/pages/Settings.tsx`) từ một stack PHẲNG gồm 8 card xếp dọc thành một bố cục **nhóm theo chủ đề + điều hướng bằng tab**. Mục tiêu là làm gọn, dễ định vị, thu gọn hiển thị lỗi updater, và tách rõ thông tin chỉ-đọc với hành động — trong khi **bảo toàn 100% chức năng và dữ liệu hiện có**.

Kiến trúc áp dụng: **Candidate A — Section-oriented + Tab navigation** (xem `architecture_selection.md`). `SettingsPage` đóng vai container đọc store và điều phối; mỗi nhóm là một component con thuần trình bày. Thay đổi giới hạn ở tầng renderer của trang Settings:

- **Không** đổi store `agentWorkspace`, type dữ liệu, hay `electronAPI` (INV-8).
- **Không** đổi props mà `App.tsx` truyền vào `SettingsPage` (`user`, `onLogout`, `onRefresh`, `onOpenClawQuickInstall`, `onBuyApi`).
- Tái dùng class CSS sẵn có; chỉ thêm CSS tối thiểu cho thanh nav dạng sidebar và khối lỗi thu gọn nếu thực sự cần.

Nguyên tắc dẫn lối: thay đổi tối thiểu (surgical), không phát minh abstraction thừa, tận dụng design system hiện có.

## Architecture

Theo kiến trúc đã chọn, trang gồm 1 container + 1 nav + 1 banner điều kiện + 6 section trình bày. Luồng dữ liệu một chiều: container đọc store → truyền slice + callback xuống section; section phát callback lên container cho các hành động cần điều phối (refresh, logout).

```
App.tsx
  └─ <SettingsPage user onLogout onRefresh onOpenClawQuickInstall onBuyApi />
        │  (đọc store qua selector; giữ activeSection; useEffect nạp ban đầu)
        ├─ <OnboardingBanner/>        (chỉ khi onboardingState.hasPendingSetup)
        ├─ <SettingsNav active onSelect/>     ← onSelect(section)
        └─ vùng nội dung — render đúng 1 section theo activeSection:
             ├─ <AccountSection user onOpenDashboard/>
             ├─ <RunnerPlanSection runtimeState user/>
             ├─ <UpdatesSection updaterState onCheck onDownload onRestart/>   (giữ isUpdaterErrorExpanded)
             ├─ <IntegrationsSection integrations onRefresh/>
             ├─ <DiagnosticsSection diagnostics onRefresh/>
             └─ <DangerZoneSection onLogout/>
```

### Phân vùng trách nhiệm (information flow)

| From \ To | Page | Nav | Account | RunnerPlan | Updates | Integrations | Diagnostics | Danger |
|-----------|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|
| Page | — | → props | → props | → props | → props | → props | → props | → props |
| Nav | ← onSelect | — | | | | | | |
| Integrations | ← onRefresh | | | | | — | | |
| Diagnostics | ← onRefresh | | | | | | — | |
| Danger | ← onLogout | | | | | | | — |

`Updates`, `Account`, `RunnerPlan` không có cạnh ngược: hành động của chúng (check/download/restart, mở dashboard) gọi thẳng store action/`electronAPI` được container truyền xuống dưới dạng callback đã bind, không cần đẩy state lên.

### Bố cục nhóm (mapping từ 8 card phẳng → 6 nhóm)

| Nhóm (section) | Gom từ card cũ | Dữ liệu/hành động |
|----------------|----------------|-------------------|
| Account | "Account" | name/email/role/activeKeys/joined + mở dashboard |
| Runner & Plan | "Managed Runner" | runtimeState badge, Plan, Balance, last status, last error |
| Updates | "Desktop updates" | state/version/availableVersion/progress + check/download/restart + lỗi thu gọn |
| Integrations | "Integrations" | danh sách provider + status + làm mới |
| Diagnostics | "Diagnostics" | danh sách event + empty state + làm mới |
| Danger zone | "Danger zone" | đăng xuất |

Card cũ **"Core actions"** (Mở/cài OpenClaw, Mua API, Refresh profile) là các hành động xuyên suốt, không thuộc một nhóm dữ liệu. Thiết kế đặt chúng vào một **action bar cố định ở đầu trang** (ngoài vùng tab, luôn hiển thị) để không lạc mất action nào và không trộn với dữ liệu chỉ-đọc (R4). Banner **"Finish setup"** giữ ở đầu trang, hiển thị có điều kiện (R1.4).

> Quyết định: dùng tab/section thay vì stack dọc. `activeSection` mặc định là `'account'` để vùng nội dung không bao giờ trống (INV-2).

## Components and Interfaces

Tất cả định nghĩa dưới đây nằm trong `apps/desktop/src/renderer/pages/Settings.tsx` (có thể giữ chung một file để đổi tối thiểu; các section là function component nội bộ). Không tạo file mới trừ khi cần.

### Kiểu dùng chung

```ts
type SettingsSectionId =
  | 'account'
  | 'runner'
  | 'updates'
  | 'integrations'
  | 'diagnostics'
  | 'danger';

interface SectionMeta {
  id: SettingsSectionId;
  label: string; // tiếng Việt: "Tài khoản", "Runner & Plan", "Cập nhật", ...
}
```

### `SettingsPage` (container) — chữ ký giữ NGUYÊN

```ts
interface SettingsPageProps {
  user: any;
  onLogout: () => void;
  onRefresh?: () => void;
  onOpenClawQuickInstall?: () => void;
  onBuyApi?: () => void;
}
```

State & dữ liệu:
- Local state mới: `const [activeSection, setActiveSection] = useState<SettingsSectionId>('account');`
- Selector store (giữ nguyên như hiện tại): `runtimeState`, `diagnostics`, `onboardingState`, `integrations`, `updaterState`, `refreshDiagnostics`, `refreshIntegrations`, `openOnboarding`, `checkForUpdates`, `downloadUpdate`, `restartToUpdate`.
- `useEffect` nạp ban đầu **giữ nguyên**: `void Promise.all([refreshDiagnostics(10), refreshIntegrations()])` với deps `[refreshDiagnostics, refreshIntegrations]` → chạy một lần, độc lập với `activeSection` (INV-3, R2.5, R5.4).

Render:
1. `page-header` (giữ nguyên tiêu đề/subtitle).
2. `OnboardingBanner` nếu `onboardingState?.hasPendingSetup`.
3. Action bar chung (Core actions): `onOpenClawQuickInstall`, `onBuyApi`, `onRefresh` — dùng `action-row` + `btn`.
4. `SettingsNav` với `active={activeSection}` và `onSelect={setActiveSection}`.
5. `switch(activeSection)` render đúng một section.

### `SettingsNav`

```ts
interface SettingsNavProps {
  active: SettingsSectionId;
  onSelect: (id: SettingsSectionId) => void;
}
```
- Render danh sách `SECTIONS: SectionMeta[]` thành các nút tab.
- Tái dùng pattern `ext-detail__tabs` / `ext-detail__tab` + `ext-detail__tab--active` (đã có trong `index.css`). Đây là nav ngang dạng tab; phù hợp số nhóm ít (6) và không cần CSS mới.
- Highlight nhóm active bằng class `--active` (R2.3).

### `OnboardingBanner`

```ts
interface OnboardingBannerProps {
  onOpen: () => void; // = openOnboarding
}
```
- Tái dùng `card section-gap card--accent` + `card__header` + `btn btn--primary btn--sm` y như khối "Finish setup" hiện tại. Chỉ render khi container quyết định (điều kiện `hasPendingSetup`).

### `AccountSection`

```ts
interface AccountSectionProps {
  user: any;
  onOpenDashboard: () => void; // window.electronAPI?.shell.openExternal('https://izziapi.com/dashboard/settings')
}
```
- `card` + `card__header` (nút "Mở trên IzziAPI") + `settings-group` chứa các `SettingRow` (name/email/role/activeKeys/joined). Tái dùng helper `SettingRow` hiện có.

### `RunnerPlanSection`

```ts
interface RunnerPlanSectionProps {
  runtimeState: AgentRuntimeState;
  user: any;
}
```
- `card` + `settings-group`: dòng "Connection" với `AgentStatusBadge`, `SettingRow` Plan/Balance/Last agent status, và `Last error` (chỉ khi `runtimeState.lastError`). Giữ nguyên định dạng ngày `toLocaleString('vi-VN')`.

### `UpdatesSection` (sở hữu `isUpdaterErrorExpanded`)

```ts
interface UpdatesSectionProps {
  updaterState: DesktopUpdaterState;
  onCheck: () => void;    // checkForUpdates
  onDownload: () => void; // downloadUpdate
  onRestart: () => void;  // restartToUpdate
}
```
- Local: `const [isUpdaterErrorExpanded, setExpanded] = useState(false);`
- `card__header` + `action-row`: nút "Kiểm tra" luôn hiển thị; "Tải xuống" chỉ khi `updaterState.state === 'available'`; "Khởi động lại" chỉ khi `'downloaded'` (INV-6, R5.3 — giữ nguyên điều kiện hiện tại).
- `settings-group` với `SettingRow` State/Current version/Available version/Progress (giữ nguyên).
- **Lỗi updater**: KHÔNG còn dùng `SettingRow label="Updater error" value={raw}`. Thay bằng khối thu gọn (chi tiết ở phần Error Handling).

### `IntegrationsSection`

```ts
interface IntegrationsSectionProps {
  integrations: IntegrationConnection[];
  onRefresh: () => void; // refreshIntegrations
}
```
- Giữ nguyên render hiện tại: `settings-item` cho mỗi provider + `sync-badge--{success|error|idle}` theo `status`. Nút "Làm mới" ở `card__header`.

### `DiagnosticsSection`

```ts
interface DiagnosticsSectionProps {
  diagnostics: DiagnosticEvent[];
  onRefresh: () => void; // refreshDiagnostics(10)
}
```
- Giữ nguyên: empty state `empty-copy` khi rỗng (R5.5); ngược lại `diagnostic-list` + `diagnostic-card`. Nút "Làm mới" gọi `refreshDiagnostics(10)`.

### `DangerZoneSection`

```ts
interface DangerZoneSectionProps {
  onLogout: () => void;
}
```
- Giữ nguyên `card` + `card__title--danger` + `danger-row` + `btn btn--danger`.

### Ánh xạ tới mã hiện tại
- File chạm: chỉ `apps/desktop/src/renderer/pages/Settings.tsx` (và `index.css` nếu cần class mới tối thiểu).
- `App.tsx`: không đổi (chữ ký `SettingsPage` giữ nguyên).
- Store/types/electronAPI: không đổi.

## Data Models

Dùng lại nguyên các type đã có, **không định nghĩa type dữ liệu mới** (chỉ thêm union UI `SettingsSectionId` ở tầng component):

- `AgentRuntimeState` (`src/main/agent/types.ts`): `{ sessionId?, state: 'idle'|'connecting'|'running'|'error', lastError?, updatedAt }`.
- `DiagnosticEvent`: `{ id, timestamp, type, status: 'success'|'error'|'info'|'idle', detail, meta? }`.
- `IntegrationConnection`: `{ provider, status: 'connected'|'disconnected'|'pending'|'error', accountLabel?, connectedAt?, lastError? }`.
- `OnboardingState`: `{ ..., shouldAutoOpen, hasPendingSetup, isCompleted }`.
- `DesktopUpdaterState` (`src/main/updater/types.ts`): `{ state, version?, availableVersion?, progress?, error?, checkedAt? }`.
- `user` (prop, kiểu `any` như hiện tại): các field đọc gồm `plan`, `balance`, `name`, `email`, `role`, `activeKeys`, `createdAt`.

## Error Handling

Trọng tâm: **làm gọn hiển thị lỗi updater** (R3) mà không mất thông tin và không phá bố cục.

Hành vi hiện tại (cần thay): `{updaterState.error && <SettingRow label="Updater error" value={updaterState.error} />}` đổ nguyên chuỗi lỗi (có thể là stack-trace/JSON dài) vào một dòng → tràn/rối.

Thiết kế mới trong `UpdatesSection`:
- Chỉ render khối lỗi khi `updaterState.error` truthy; nếu rỗng/undefined → không render gì (R3.4, INV-4).
- Mặc định **thu gọn**: hiển thị một dòng tóm tắt ngắn + nút "Xem chi tiết" (toggle `isUpdaterErrorExpanded`). Tóm tắt = dòng đầu tiên của lỗi hoặc cắt theo độ dài (vd `error.split('\n')[0]`, giới hạn ~120 ký tự), kèm dấu hiệu còn nội dung.
- Khi mở rộng: hiển thị **toàn bộ** `updaterState.error` (R3.3, INV-5) trong vùng có giới hạn — `<pre>`/`<div>` với `max-height` + `overflow:auto` + `white-space: pre-wrap; word-break: break-word`, để nội dung dài cuộn trong khối thay vì tràn trang (R3.5).
- Nút toggle đổi nhãn "Xem chi tiết" ↔ "Thu gọn".

Phác thảo:
```tsx
{updaterState.error && (
  <div className="settings-item settings-item--error">
    <div className="settings-item__label">Updater error</div>
    <button className="btn btn--ghost btn--sm" onClick={() => setExpanded(v => !v)}>
      {isUpdaterErrorExpanded ? 'Thu gọn' : 'Xem chi tiết'}
    </button>
  </div>
)}
{updaterState.error && !isUpdaterErrorExpanded && (
  <div className="settings-item__description settings-error__summary">
    {firstLine(updaterState.error)}
  </div>
)}
{updaterState.error && isUpdaterErrorExpanded && (
  <pre className="settings-error__detail">{updaterState.error}</pre>
)}
```

CSS mới tối thiểu (chỉ khi class sẵn có không đủ): `.settings-error__detail { max-height: 200px; overflow: auto; white-space: pre-wrap; word-break: break-word; }` và `.settings-error__summary { color: var(--color-error); }`. Mọi thứ khác tái dùng `settings-item`, `btn--ghost`, `settings-item__description`.

Các lỗi khác (runtime `lastError`, integration `lastError`) giữ nguyên cách hiển thị hiện tại — không nằm trong phạm vi làm gọn của feature này.

## Testing Strategy

Ràng buộc thực tế: trang Settings là component trình bày; repo hiện có smoke test ở tầng store (`agentWorkspace.smoke.test.ts`, vitest). Feature **không đổi store**, nên:

1. **Smoke test store hiện có** (`agentWorkspace.smoke.test.ts`): chạy lại để xác nhận không hồi quy — đảm bảo các action mà trang dùng (`checkForUpdates`/`downloadUpdate`/`refreshDiagnostics`/`refreshIntegrations`/onboarding) vẫn hành xử như cũ. Đây là lưới an toàn cho R5.6 (không đổi store) và R5.2 (action vẫn nối đúng).
2. **Kiểm thử thủ công / smoke UI** theo checklist bám acceptance criteria:
   - Đổi tab hiển thị đúng nhóm, có highlight active; mở trang thấy nhóm mặc định (R2.1–R2.4).
   - Đổi tab nhiều lần không gọi lại `refreshDiagnostics`/`refreshIntegrations` (R2.5/R5.4) — quan sát số lần gọi (vd qua log/spy hoặc devtools network/IPC).
   - Khi `updaterState.error` có giá trị: thấy bản thu gọn; bấm "Xem chi tiết" thấy đầy đủ; khi rỗng không thấy khối lỗi (R3).
   - Tất cả nút hành động chạy đúng handler: check/download/restart (đúng điều kiện state), refresh dx/integrations, open onboarding, OpenClaw, buy API, refresh profile, mở dashboard, logout (R5.2/R5.3).
   - Empty state diagnostics/integrations hiển thị đúng (R5.5).
3. **(Tuỳ chọn, nếu thiết lập test renderer)** Nếu sau này thêm React Testing Library: viết unit test cho `UpdatesSection` (toggle lỗi) và `SettingsNav` (đổi active) vì đây là hai component giữ state cục bộ — đúng theo phân vùng invariant (INV-2/3, INV-4/5). Hiện chưa bắt buộc vì repo chưa có hạ tầng test renderer; không tạo mới trong phạm vi "thiết kế lại cho gọn".

Tiêu chí done: smoke test store xanh + checklist thủ công bám AC đều đạt, và mọi hành động/dữ liệu cũ còn nguyên.
