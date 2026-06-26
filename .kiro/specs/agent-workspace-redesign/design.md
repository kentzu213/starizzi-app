# Tài liệu Thiết kế — Agent Workspace Redesign

## Overview

Thiết kế kỹ thuật để biến trang `chat` thành **Agent_Workspace** 3 vùng, **additive** trên kiến
trúc hiện có (Electron + React 19 + Zustand), tuân thủ Redesign–Preserve: giữ thương hiệu glass
cyan/purple, giữ `useState<Page>`, giữ dual-store chat, không bật vibrancy/light mode.

Nguyên tắc: **không viết lại** — tái dùng `agentGateway` store, `TOP_AGENTS`, `AgentTabBar`,
`ModelSelector`, `ChatComposer`, `ChatMessageList`, và Hệ_Token_Glass. Bổ sung 4 component mới +
1 stylesheet mới + 1 mô hình dữ liệu Loop. Toàn bộ class mới đặt tiền tố mới, **không đổi** tên
class cũ đang bị TSX/JS tham chiếu (`chat-page*`, `gw-*`, `model-selector*`, `chat-composer*`).

## Architecture

### Cây bố cục mới (bên trong `main-content` của trang chat)

```
.agent-workspace                      (CSS grid: 1fr  var(--aw-rail-width))
├── .agent-workspace__main            (cột giữa — chat hero, GIỮ NGUYÊN nội dung .chat-page cũ)
│   └── .chat-page  ▸ header / AgentTabBar / .chat-page__body / footer   (không đổi)
└── .agent-workspace__rail            (cột phải ~1/4 — glass-panel, nền tĩnh, KHÔNG thêm blur)
    ├── <BusinessStrip>   .aw-business      (balance/plan/budget + CTA nạp/nâng → izzi)
    ├── <AgentRail>       .aw-agents        (agents nhóm theo category, scroll, chiếm phần lớn)
    └── <LoopDock>        .aw-loops         (loop theo nhiệm vụ — neo đáy, góc phải dưới)
```

- Cột giữa giữ **nguyên** subtree `.chat-page` hiện tại → mọi hành vi/test chat không đổi (Req 6.3).
- Cột phải là **một** `glass-panel` (nền token đặc, không `backdrop-filter`) chứa 3 vùng con →
  tôn trọng ngân sách ≤3 lớp blur của glass spec (Req 7.2 của spec glass) vì rail không thêm blur.
- Responsive: dưới ngưỡng `--aw-collapse` (≈1040px) → rail thu thành nút bật/tắt overlay; cột giữa
  luôn hiển thị + giữ composer (Req 1.3, 1.6).

### Luồng phụ thuộc CSS (giữ cascade)

| Thứ tự | Tệp | Import tại | Ghi chú |
|---|---|---|---|
| 1 | `styles/index.css` | `main.tsx` | `:root` token + Bộ_Class_Glass (nguồn sự thật) |
| 2 | `styles/agent-gateway.css` | `pages/Chat.tsx` | style chat hiện có (không đổi) |
| 3 | `styles/agent-workspace.css` | `pages/Chat.tsx` (mới) | **mới** — chỉ chứa `.agent-workspace*`, `.aw-*`; token-only |

`agent-workspace.css` nạp sau nên có thể bọc `.chat-page` mà không sửa `agent-gateway.css`.

## Components and Interfaces

### 1. Mô hình dữ liệu Loop — `types/agent-loops.ts` (mới)

```ts
export type LoopTask =
  | 'research' | 'automation' | 'coding' | 'content' | 'data-rag' | 'orchestration';

export interface AgentLoop {
  id: string;
  label: string;            // "Nghiên cứu"
  task: LoopTask;
  description: string;
  icon: string;
  suggestedAgentId: string; // khớp ExternalAgent.id trong TOP_AGENTS
  suggestedModel: string;   // khớp ModelOption.id
  suggestedProvider: AIProvider;
}

export const AGENT_LOOPS: AgentLoop[];   // preset tĩnh (Req 3.5)

/** Hàm THUẦN — quyết định hành động khi chọn loop (test được, Req 8.2). */
export interface LoopPlan {
  action: 'configure-existing' | 'open-new';
  agentId: string | null;   // null nếu suggestedAgentId không khớp & không có phiên
  model: string;
  provider: AIProvider;
}
export function planLoopApplication(
  loop: AgentLoop,
  activeSession: AgentChatSession | null,
  agents: ExternalAgent[],
): LoopPlan;
```

Quy tắc `planLoopApplication` (Req 3.3, 3.4, 3.6, 7.3):
- Có phiên đang hoạt động → `configure-existing`, đặt model/provider của loop cho phiên đó;
  `agentId` giữ theo phiên hiện tại (không ép đổi agent đang chat).
- Không có phiên → `open-new` với `suggestedAgentId` **nếu** khớp một agent trong `TOP_AGENTS`.
- `suggestedAgentId` không khớp & không có phiên → `agentId = null` (caller bỏ qua mở agent an
  toàn, vẫn cho người dùng chat). Truy cập field bằng own-property, không theo prototype-chain.

Preset (6 loop, phủ 4 category):

| Loop | task | Agent gợi ý | Model gợi ý |
|---|---|---|---|
| Nghiên cứu | research | hermes | gemini-2.5-pro (izzi) |
| Tự động hoá | automation | n8n | izzi/auto |
| Lập trình | coding | autogpt | claude-4-sonnet (izzi) |
| Nội dung | content | openclaw | claude-4-sonnet (izzi) |
| Dữ liệu / RAG | data-rag | dify | izzi/auto |
| Đa agent | orchestration | crewai | izzi/auto |

### 2. `components/AgentRail.tsx` (mới)

```ts
interface AgentRailProps {
  agents: ExternalAgent[];
  activeAgentId: string | null;       // agentId của phiên đang hoạt động
  collapsed: boolean;
  onToggleCollapse: () => void;
  onSelectAgent: (agentId: string) => void;
}
```

- Nhóm `agents` theo `AgentCategory` qua hàm thuần `groupAgentsByCategory(agents)` (test Req 8.1).
- Nhãn nhóm tiếng Việt: autonomous→"Tự chủ", platform→"Nền tảng", orchestration→"Điều phối",
  workflow→"Tự động hoá". Mỗi nhóm chỉ hiện khi có ≥1 agent.
- Mỗi hàng agent: dot trạng thái (tái dùng quy ước `gw-tab__dot--*`), icon, tên, trạng thái;
  `--active` khi `agent.id === activeAgentId`.
- Class: `.aw-agents`, `.aw-agents__group`, `.aw-agents__group-title`, `.aw-agent`,
  `.aw-agent--active`, `.aw-agent__dot`, `.aw-agent__icon`, `.aw-agent__name`, `.aw-agent__status`.

### 3. `components/LoopDock.tsx` (mới)

```ts
interface LoopDockProps {
  loops: AgentLoop[];
  activeTask: LoopTask | null;
  onSelectLoop: (loop: AgentLoop) => void;
}
```

- Neo đáy rail (góc phải dưới). Mỗi loop: icon + label + task. `--active` theo `activeTask`.
- Class: `.aw-loops`, `.aw-loops__title`, `.aw-loop`, `.aw-loop--active`, `.aw-loop__icon`,
  `.aw-loop__label`, `.aw-loop__task`.

### 4. `components/BusinessStrip.tsx` (mới)

```ts
interface BusinessStripProps {
  user: { plan?: string; balance?: number } | null;
  onBuyApi?: () => void;
}
```

- Hiển thị balance USD + quy đổi VND (`Math.round(usd * 25500)` như CostDashboard), plan.
- Tự fetch budget qua `window.electronAPI?.budget?.getStatus()` trong `useEffect`; thiếu API →
  trạng thái rỗng hợp lệ (Req 4.6). Không lưu/log secret (Req 4.5/7.4).
- CTA "Nạp / Nâng gói" → `onBuyApi` (App nối `electronAPI.system.buyApi`).
- Class: `.aw-business`, `.aw-business__balance`, `.aw-business__vnd`, `.aw-business__plan`,
  `.aw-business__gauge`, `.aw-business__gauge-fill`, `.aw-business__cta`.

### 5. Sửa `pages/Chat.tsx` (tối thiểu, additive)

- Bọc nội dung trả về trong `.agent-workspace` > (`.agent-workspace__main` chứa `.chat-page` cũ
  **nguyên vẹn**) + (`.agent-workspace__rail` chứa 3 component mới).
- Thêm props `user?`, `onBuyApi?` (truyền xuống BusinessStrip). Giữ props cũ.
- Nối: `onSelectAgent` → `gwOpenChat`; `onSelectLoop` → dùng `planLoopApplication` rồi gọi
  `gwOpenChat` / `gwSetModel` / `newGatewaySession` tương ứng; `activeAgentId` =
  `activeGwSession?.agentId`. Giữ modal `agent-picker` cũ (mở từ "+" của tab bar) để không mất
  đường mở agent nào (Req 2.6).
- State cục bộ mới: `railCollapsed`, `activeTask`.

### 6. Sửa `App.tsx` (1 dòng — truyền props)

`renderPage()` case `'chat'`: thêm `user={currentUser}` và `onBuyApi={handleBuyApi}` vào
`<ChatPage .../>`. **Không** đổi `useState<Page>`, tập Page, hay cặp điều hướng (Req 6.1).

## Data Models

### Surface Classification (áp Bộ_Class_Glass)

| Bề mặt | Class glass | Lý do |
|---|---|---|
| `.agent-workspace__rail` | `glass-panel` | container tĩnh, nền đặc, không blur (ngân sách blur) |
| `.aw-agent`, `.aw-loop` (hàng) | — (token nền/hover, `--radius-glass-sm`) | phần tử list, không phải bề mặt kính nổi |
| `.aw-business` | nền token + `--radius-glass-sm` | dải thông tin, không cần blur |

## Bản đồ IA tab tool ↔ izziapi.com

> **Validates: Req 5.2, 12.2.** Ánh xạ các surface điều hướng chính của tool desktop sang
> surface tương ứng trên izziapi.com, đảm bảo IA nhất quán giữa hai môi trường.

| # | Surface Tool (desktop)         | Page / route              | Surface izzi (web)                  | Route izzi              | Ghi chú                              |
|---|-------------------------------|---------------------------|-------------------------------------|-------------------------|---------------------------------------|
| 1 | Agent Workspace (chat)        | `chat`                    | AI Base — Agent chat                | `/aibase`               | Hero surface; 3-zone layout           |
| 2 | Cost / Billing                | `costs`                   | Pricing / Billing                   | `/pricing`, `/billing`  | BusinessStrip deep-link → izzi        |
| 3 | Models / Providers            | `dashboard` (model info)  | Models                              | `/models`               | Model selector đồng bộ provider list  |
| 4 | Knowledge / Graph             | `knowledge`               | AI Base — Graph (second brain)      | `/aibase/graph`         | Phase 4 đã thêm; read-only           |
| 5 | Marketplace / Extensions      | `marketplace`, `extensions` | Marketplace                        | `/marketplace`          | Extension SDK + cộng đồng             |
| 6 | Account / Settings            | `settings`                | Account                             | `/account`              | Profile, API keys, plan management    |

**Nguyên tắc đồng bộ:**
- Token/thương hiệu: cả hai dùng chung Hệ_Token_Glass (accent cyan/purple, dark-only trên desktop).
- Điều hướng: Sidebar trái (desktop) ↔ Top nav (web) — cùng tập mục, khác bố cục.
- Deep-link: CTA "Nạp/Nâng gói" và "Mở trên izzi" dùng `electronAPI.system.buyApi` / `shell.openExternal`.
- Phase sau: surface Knowledge/Graph hiện read-only; phía GHI (agent-memory → graph) cần spec riêng với auth + budget.

## Correctness Properties

Tính năng chủ yếu là layout + reuse store; phần logic thuần đáng test:

### Property 1 (ví dụ-based, không PBT): nhóm agent phủ đủ & đúng category
`groupAgentsByCategory(TOP_AGENTS)` trả về các nhóm sao cho **tổng số agent across nhóm =
TOP_AGENTS.length** và mọi agent nằm đúng nhóm `category` của nó. **Validates: Req 8.1.**

### Property 2: planLoopApplication đúng theo trạng thái phiên
- Có phiên → `configure-existing`, model/provider = loop. 
- Không phiên + agent khớp → `open-new`, agentId = suggested.
- Không phiên + agent không khớp → agentId = null.
**Validates: Req 3.3, 3.4, 3.6, 8.2.**

## Error Handling

| Tình huống | Xử lý | Req |
|---|---|---|
| `electronAPI.budget` không có | BusinessStrip hiện trạng thái rỗng/đang tải, không throw | 4.6 |
| balance/plan undefined | Hiện "—" / "Free", không NaN | 4.6 |
| loop.suggestedAgentId lạ | `planLoopApplication` trả agentId=null, vẫn chat được | 3.6 |
| rail thu gọn ở cửa sổ hẹp | overlay bật/tắt, cột giữa luôn còn composer | 1.3, 1.6 |
| token glass thiếu | mọi `var(--token, fallback)` có fallback hợp lệ | (kế thừa glass) |

## Testing Strategy

- **Unit (Vitest)** `types/agent-loops.test.ts`:
  - `groupAgentsByCategory(TOP_AGENTS)`: tổng phủ = length; mỗi agent đúng nhóm (Req 8.1).
  - `planLoopApplication`: 3 ca (có phiên / không phiên+khớp / không phiên+không khớp) (Req 8.2).
- **Regression (đã có)**: `navigationMap`, `electronWindowConfig`, `inlineStyleAudit`,
  `glassTokens`, `glassContrast` tiếp tục đạt; 0 fail mới (Req 6.6, 8.3).
- **Build**: `pnpm --filter @openclaw/desktop build` thành công (Req 6.5).
- **Smoke thủ công** (người dùng chạy `pnpm dev`): chat 2 chế độ (legacy + gateway) vẫn chạy;
  chọn agent ở rail mở/đổi phiên; chọn loop đổi model; rail thu gọn ở cửa sổ hẹp.
- **inlineStyleAudit**: component mới chỉ dùng inline cho giá trị runtime (vd `width:${pct}%`);
  mọi màu/nền dùng token.


---

## Phase 2–5 — Design deltas (desktop, runnable)

> Mở rộng thiết kế cho các phase sau Phase 1. Giữ nguyên nguyên tắc: additive, token-only,
> reuse store, không hồi quy, không tạo bề mặt ghi thiếu auth.

### Phase 2 — Loop UX (Req 9)

- `types/agent-loops.ts`: thêm `starterPrompt: string` vào `AgentLoop` và preset; thêm hàm thuần
  `loopStarterDraft(loop): string` (trả về prompt khởi đầu, không side-effect).
- `Chat.tsx`: `handleSelectLoop` sau khi áp model → `setDraft(loopStarterDraft(loop))` (KHÔNG gửi).
- `LoopDock.tsx`: thêm trạng thái chi tiết (mô tả + agent/model gợi ý) khi hover/expand.
- `activeTask` đã có; đảm bảo phản chiếu loop gần nhất cho phiên.
- Test: `loopStarterDraft` + giữ `planLoopApplication` (không tự gửi/chạy nền).

### Phase 3 — Context/Memory panel (Req 10)

- `components/ContextPanel.tsx` (mới) trong rail (dưới AgentRail hoặc tab): feature-detect
  `window.electronAPI?.memory?.list?.(agentId)` (hoặc nguồn izzi tương đương). Read-only.
- `types/agent-memory.ts` (mới): `MemoryItem { id; title; source; createdAt }` + hàm thuần
  `normalizeMemoryItems(raw): MemoryItem[]` (own-property, bỏ mục thiếu `source` — no-orphan đọc).
- Thiếu API → empty state ("Chưa có ngữ cảnh" + gợi ý). Không hiển thị secret/PII.
- Class: `.aw-context*`. Test: `normalizeMemoryItems` (lọc no-source, không bịa).

### Phase 4 — Knowledge/Graph nav surface (Req 11)

- `App.tsx`: thêm `'knowledge'` vào union `Page`; `renderPage()` case `'knowledge'` →
  `<KnowledgePage />`; Sidebar EXPLORE_ITEMS thêm mục `knowledge`. **Giữ nguyên** mọi page + cặp
  điều hướng cũ.
- `pages/Knowledge.tsx` (mới): shell hiển thị graph data nếu `electronAPI`/izzi có
  (feature-detect), else empty + CTA `shell.openExternal('https://izziapi.com/aibase/graph')`.
  Read-only; token-only.
- **Cập nhật `navigationMap.test.ts`**: thêm `'knowledge'` vào `BASELINE_PAGES` + thêm assert cặp
  điều hướng cho mục Sidebar mới. (Đây là thay đổi có chủ đích cho tính năng mới — khác với
  ràng buộc Phase 1; mọi page/cặp cũ vẫn giữ.)

### Phase 5 — Token/IA sync (Req 12)

- Rà các surface mới (ContextPanel, KnowledgePage): 0 literal màu/nền ngoài token.
- Bản đồ IA tab tool ↔ izzi (mục 5 design Phase 1) — xác nhận đủ: Agent Workspace · Cost · Models ·
  Knowledge/Graph · Marketplace/Extensions · Account.
- Checkpoint cuối: `pnpm build` + `vitest run` + inlineStyleAudit.

### Ngoài phạm vi desktop (cross-repo / runtime / deploy) — KHÔNG auto-run

- **Loop execution thật + scheduler/cron**: cần agent runtime + `izzi-backend`. Bề mặt chạy phải
  qua auth + budget (security-baseline B). Cần spec riêng.
- **Agent-memory WRITE → knowledge graph izzi**: endpoint ghi nằm ở `izzi-backend` (auth + budget +
  no-orphan). Desktop chỉ gọi endpoint đã xác thực; không tạo surface ghi thiếu auth. Cần spec riêng.
- **Release production** (electron-builder + GitHub release): thao tác nguy hiểm, chỉ chạy thủ công
  khi người dùng duyệt.
