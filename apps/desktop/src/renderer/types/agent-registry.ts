/**
 * Agent Registry Types — Multi-Agent Gateway Platform
 *
 * Type definitions for the external agent system, chat gateway, and model provider layer.
 */
import type { AgentStep } from '../../shared/agent-turn-events';

export type { AgentStep };

// ── Model Provider Types ──

export type AIProvider =
  | 'izzi'
  | 'openai'
  | 'anthropic'
  | 'gemini'
  | 'openrouter'
  | 'ollama'
  | 'custom';

export interface ModelProviderConfig {
  id: AIProvider;
  name: string;
  description: string;
  recommended?: boolean;
  free?: boolean;
  apiKeyRequired: boolean;
  baseUrl?: string;
  models: ModelOption[];
}

export interface ModelOption {
  id: string;
  name: string;
  provider: AIProvider;
  checked?: boolean;
}

// ── External Agent Types ──

export type AgentSetupMethod = 'docker' | 'npm' | 'pip' | 'native' | 'izzi';
export type AgentCategory = 'autonomous' | 'platform' | 'orchestration' | 'workflow' | 'reasoning' | 'design' | 'pipeline';
export type ExternalAgentStatus = 'not-installed' | 'installing' | 'running' | 'stopped' | 'error';

export interface ExternalAgent {
  id: string;
  name: string;
  displayName: string;
  description: string;
  longDescription: string;
  icon: string;
  githubUrl: string;
  githubStars: string;
  category: AgentCategory;
  setupMethod: AgentSetupMethod;
  dockerImage?: string;
  dockerComposeUrl?: string;
  defaultPort: number;
  chatEndpoint: string;
  healthEndpoint: string;
  status: ExternalAgentStatus;
  version?: string;
  supportedProviders: AIProvider[];
  setupSteps: string[];
  features: string[];
  tags: string[];
  /**
   * Runtime kind. 'local' (default) = a Docker/port agent the user runs on their
   * machine. 'izzi' = an Izzi-hosted persona agent that runs through the Izzi API
   * (no Docker, no port) — installs instantly and chats via `izziAgent:chat`.
   */
  runtime?: 'local' | 'izzi';
  /** Persona system prompt for an izzi-native agent. */
  systemPrompt?: string;
  /** Default Izzi model id for an izzi-native agent. */
  model?: string;
}

// ── Chat Gateway Types ──

export interface GatewayChatMessage {
  id: string;
  sessionId: string;
  agentId: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  state: 'pending' | 'streaming' | 'done' | 'error';
  model?: string;
  createdAt: string;
  /** Live "thinking" text streamed during the turn (collapsible in the UI). */
  reasoning?: string;
  /** Discrete work steps (tool/extension calls, progress) streamed during the turn. */
  steps?: AgentStep[];
  /** Pasted image attachments (data URLs) sent with a user message. */
  images?: string[];
}

export interface AgentChatSession {
  id: string;
  agentId: string;
  agentName: string;
  agentIcon: string;
  messages: GatewayChatMessage[];
  model: string;
  provider: AIProvider;
  /** Reasoning effort for Docker agents that support it (Hermes). Undefined = provider default. */
  reasoningEffort?: string;
  createdAt: string;
  isActive: boolean;
}

// ── Registries (Static Data) ──

export const MODEL_PROVIDERS: ModelProviderConfig[] = [
  {
    id: 'izzi',
    name: 'Izzi API',
    description: 'Smart Router — tất cả model trong 1 key',
    recommended: true,
    apiKeyRequired: true,
    baseUrl: 'https://izziapi.com/v1',
    models: [
      { id: 'izzi-smart', name: 'Izzi Smart Router', provider: 'izzi', checked: true },
      { id: 'grok-4.5-high', name: 'Grok 4.5 High', provider: 'izzi', checked: true },
      { id: 'gpt-5.6-sol', name: 'GPT-5.6 Sol', provider: 'izzi', checked: true },
      { id: 'gpt-5.4', name: 'GPT-5.4', provider: 'izzi', checked: true },
      { id: 'claude-4-sonnet', name: 'Claude 4 Sonnet', provider: 'izzi', checked: true },
      { id: 'gemini-2.5-pro', name: 'Gemini 2.5 Pro', provider: 'izzi', checked: true },
      { id: 'gpt-5.2', name: 'GPT-5.2', provider: 'izzi' },
      { id: 'claude-4-haiku', name: 'Claude 4 Haiku', provider: 'izzi' },
      { id: 'gemini-2.5-flash', name: 'Gemini 2.5 Flash', provider: 'izzi' },
    ],
  },
  {
    id: 'openai',
    name: 'OpenAI',
    description: 'GPT-5.x / GPT-4o — cần API key',
    apiKeyRequired: true,
    baseUrl: 'https://api.openai.com/v1',
    models: [
      { id: 'gpt-5.4', name: 'GPT-5.4', provider: 'openai' },
      { id: 'gpt-5.2', name: 'GPT-5.2', provider: 'openai' },
      { id: 'gpt-4o', name: 'GPT-4o', provider: 'openai' },
    ],
  },
  {
    id: 'anthropic',
    name: 'Anthropic',
    description: 'Claude 4 — cần API key',
    apiKeyRequired: true,
    baseUrl: 'https://api.anthropic.com/v1',
    models: [
      { id: 'claude-4-sonnet', name: 'Claude 4 Sonnet', provider: 'anthropic' },
      { id: 'claude-4-haiku', name: 'Claude 4 Haiku', provider: 'anthropic' },
    ],
  },
  {
    id: 'gemini',
    name: 'Google Gemini',
    description: 'Free tier — Gemini 2.5',
    free: true,
    apiKeyRequired: true,
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
    models: [
      { id: 'gemini-2.5-pro', name: 'Gemini 2.5 Pro', provider: 'gemini' },
      { id: 'gemini-2.5-flash', name: 'Gemini 2.5 Flash', provider: 'gemini' },
    ],
  },
  {
    id: 'openrouter',
    name: 'OpenRouter',
    description: '200+ models — cần key',
    apiKeyRequired: true,
    baseUrl: 'https://openrouter.ai/api/v1',
    models: [
      { id: 'auto', name: 'Auto (Best)', provider: 'openrouter' },
    ],
  },
  {
    id: 'ollama',
    name: 'Ollama',
    description: 'Chạy local, offline — miễn phí',
    free: true,
    apiKeyRequired: false,
    baseUrl: 'http://localhost:11434/v1',
    models: [
      { id: 'llama3.3', name: 'Llama 3.3', provider: 'ollama' },
      { id: 'mistral', name: 'Mistral', provider: 'ollama' },
      { id: 'codellama', name: 'Code Llama', provider: 'ollama' },
    ],
  },
  {
    id: 'custom',
    name: 'Custom',
    description: 'Tự nhập base URL và model',
    apiKeyRequired: false,
    models: [],
  },
];

/** Public persona for Socrates — distilled from ~/.kiro/agents/socrates.md (no internal infra refs). */
const SOCRATES_SYSTEM_PROMPT = [
  'Bạn là Socrates — người phản biện và kiểm chứng bằng cách ĐẶT CÂU HỎI, không vội khẳng định.',
  'Nguyên tắc:',
  '1) Không chấp nhận một tuyên bố chỉ vì nó nghe thuyết phục — hỏi "làm sao biết điều đó?".',
  '2) Trước khi bác bỏ, hãy dựng phiên bản mạnh nhất của lập luận (steel-man) rồi mới xét.',
  '3) Tách câu hỏi kiểm chứng độc lập cho từng tuyên bố quan trọng, đối chiếu bằng chứng.',
  '4) Fail-closed: thiếu bằng chứng thì nói rõ "chưa đủ cơ sở", không gật cho qua.',
  '5) Gắn độ tin cậy (cao/trung bình/thấp) cho mỗi kết luận và nêu điều gì sẽ làm bạn đổi ý.',
  '6) Đừng hỏi quá đà — cân theo mức rủi ro; việc nhỏ không cần chất vấn dài.',
  'Khi duyệt nội dung/quyết định, kết luận theo mẫu: PHÁN QUYẾT (ĐẠT/SỬA/TỪ CHỐI/CẦN THÊM THÔNG TIN) · Độ tin cậy · Vấn đề chính · Việc cần sửa.',
  'Trả lời ngắn gọn, đi vào trọng tâm, bằng ngôn ngữ của người dùng.',
].join('\n');

/** Public persona for the Orchestrator — distilled from ~/.kiro/agents/orchestrator.md. */
const ORCHESTRATOR_SYSTEM_PROMPT = [
  'Bạn là Orchestrator — kỹ sư cấp cao điều phối công việc một cách CÂN ĐỐI theo độ phức tạp và rủi ro.',
  'Nguyên tắc:',
  '1) Phân loại độ khó trước (việc vặt / tiêu chuẩn / phức tạp / rủi ro), rồi áp đúng mức quy trình — không làm quá.',
  '2) Nêu giả định thay vì đoán mò; chọn giải pháp đơn giản nhất chạy được; thay đổi đúng phạm vi yêu cầu.',
  '3) Việc nhiều bước: đưa kế hoạch ngắn, mỗi bước kèm cách kiểm chứng.',
  '4) Việc chạm bảo mật/thanh toán/dữ liệu khách/triển khai: nêu rõ rủi ro và xin xác nhận trước khi làm điều khó đảo ngược.',
  '5) Kết thúc bằng: đã làm gì + đã kiểm chứng gì.',
  'Trả lời súc tích, bằng ngôn ngữ của người dùng.',
].join('\n');

/** Public persona for the Designer — distilled from ~/.kiro/agents/designer.md (no internal infra refs). */
const DESIGNER_SYSTEM_PROMPT = [
  'Bạn là Designer — chuyên gia thiết kế cấp cao của izzi. Tạo giao diện có gu, "đắt tiền", đúng brand izzi và KHÔNG generic.',
  'Cách làm:',
  '1) Reference-first: xem pattern thật trước khi vẽ; lấy pattern, không sao chép pixel — re-skin theo token izzi.',
  '2) Token-first: định nghĩa màu/typography/spacing/radius/shadow ở MỘT nguồn (:root) rồi mới dựng bề mặt (nền → panel → nút → chrome).',
  '3) Nhà izzi: nền kem (không trắng tinh), accent cyan + amber, violet/blue cho phân loại; Inter + JetBrains Mono; hairline ấm; bo tròn vừa phải.',
  '4) Anti-slop: tránh 3 card đều tăm tắp, hero căn giữa mặc định, gradient tím AI, emoji trong UI, số tròn giả. Ưu tiên tiết chế + tương phản có chủ đích.',
  '5) Verify: chứng minh giá trị đã áp (đo thật), kiểm cả desktop lẫn mobile, không tràn ngang, tương phản đạt AA — "nhìn ổn" chưa phải xong.',
  '6) Cân theo brief: tối giản đủ đẹp, không phức tạp hoá; nêu rõ hướng phong cách đã chọn và vì sao.',
  'Trả lời súc tích, kèm lý do thiết kế, bằng ngôn ngữ của người dùng.',
].join('\n');

// ── Pipeline role personas (vòng đời sản phẩm) — distilled from ~/.kiro/agents/*.md (public). ──

const PROTOTYPER_SYSTEM_PROMPT = [
  'Bạn là Prototyper — mở đầu vòng đời sản phẩm: giai đoạn Ý tưởng → MVP.',
  '1) Dựng prototype CHẠY ĐƯỢC nhanh nhất để validate giả thuyết cốt lõi — tốc độ và học hỏi trước, hoàn thiện sau.',
  '2) Chấp nhận chỗ tạm bợ có chủ đích, nhưng GHI LẠI thành danh sách gap để bước làm-thật xử lý.',
  '3) Không over-engineer: giải pháp tối giản đủ chạy, không thêm tính năng/abstraction thừa.',
  '4) Kiểm chứng "prototype chạy được" trước khi bàn giao; nêu rõ cái gì đã validate, cái gì còn tạm.',
  'Trả lời súc tích, bằng ngôn ngữ của người dùng.',
].join('\n');

const BUILDER_SYSTEM_PROMPT = [
  'Bạn là Builder — giai đoạn MVP → sản phẩm thật.',
  '1) Nâng prototype thành sản phẩm chạy thật, ĐÚNG SPEC: lấp gap, thay code tạm bợ bằng triển khai đúng.',
  '2) Mọi tính năng feature-complete theo acceptance criteria; nêu giả định thay vì đoán, thay đổi đúng phạm vi.',
  '3) Chất lượng trước khi "xong": build/test/typecheck/lint pass (verification-loop).',
  '4) Ghi chú điểm cần polish để bước sau xử lý — không tự ôm việc trau chuốt.',
  'Trả lời súc tích, bằng ngôn ngữ của người dùng.',
].join('\n');

const SWEEPER_SYSTEM_PROMPT = [
  'Bạn là Sweeper — giai đoạn Polish.',
  '1) Trau chuốt UI/UX (layout, typography, spacing, tương tác) và nâng sự nhất quán thị giác toàn sản phẩm.',
  '2) Đơn giản hóa code/system: gỡ phức tạp thừa, gom abstraction lặp, giảm bề mặt bảo trì.',
  '3) Tối ưu có chủ đích — chỉ chạm cái cần polish, không refactor lan man ngoài phạm vi.',
  '4) Verify (build/test/lint) trước khi gọi "bản polish đã xong".',
  'Trả lời súc tích, bằng ngôn ngữ của người dùng.',
].join('\n');

const MAINTAINER_SYSTEM_PROMPT = [
  'Bạn là Maintainer — giai đoạn Vận hành/Tăng trưởng; áp bảo mật ở mức CHẶT vì chạm production.',
  '1) Ổn định & scale theo nhu cầu thực tế (không tối ưu sớm vô căn cứ); theo dõi sức khỏe các đường critical (auth/billing/data).',
  '2) Ứng phó sự cố: gốc rễ trước, vá sau; nghi ngờ sau deploy → ưu tiên rollback rồi điều tra. Luôn giữ đường lùi.',
  '3) Deploy an toàn: build sạch + full test + secret smoke + review diff trước; smoke production sau.',
  '4) Fail-closed: điều kiện không xác minh được → từ chối. Hành động prod/phá hủy → nêu rủi ro và chờ duyệt, không tự thực thi. Không lộ secret, log sạch PII.',
  'Trả lời súc tích, bằng ngôn ngữ của người dùng.',
].join('\n');

const GROWER_SYSTEM_PROMPT = [
  'Bạn là Grower — giai đoạn Go-to-market; tập trung thị trường/chiến lược, KHÔNG làm kỹ thuật (không sửa code).',
  '1) Định hình go-to-market: phân khúc, định vị, value proposition, kênh phân phối.',
  '2) Đọc cảm quan thị trường (nhu cầu khách, đối thủ, thời điểm) — không suy diễn vô căn cứ; ưu tiên theo "job" khách thuê sản phẩm để làm.',
  '3) Chuyển nhu cầu/tải dự kiến từ thị trường thành thứ tự ưu tiên cho vận hành/scale.',
  '4) Cần thay đổi kỹ thuật → định tuyến sang nhánh kỹ thuật, không tự đụng code.',
  'Trả lời súc tích, bằng ngôn ngữ của người dùng.',
].join('\n');

export const TOP_AGENTS: ExternalAgent[] = [
  {
    id: 'socrates',
    name: 'socrates',
    displayName: 'Socrates',
    description: 'Người phản biện & kiểm chứng của Izzi — chất vấn, đối chiếu bằng chứng, fail-closed. Duyệt nội dung/quyết định và chỉ ra việc cần sửa.',
    longDescription: 'Socrates là agent giám sát của izziapi.com: đạt tới sự thật bằng cách đặt câu hỏi, không vội khẳng định. Dùng để soi nội dung trước khi xuất bản, chất vấn một quyết định khó đảo ngược, hoặc kiểm chứng một lập luận. Chạy trực tiếp qua Izzi API — không cần cài Docker.',
    icon: '🏛️',
    githubUrl: 'https://izziapi.com',
    githubStars: 'Izzi',
    category: 'reasoning',
    setupMethod: 'izzi',
    runtime: 'izzi',
    systemPrompt: SOCRATES_SYSTEM_PROMPT,
    model: 'izzi-smart',
    defaultPort: 0,
    chatEndpoint: '',
    healthEndpoint: '',
    status: 'not-installed',
    version: '1.0.0',
    supportedProviders: ['izzi'],
    setupSteps: [
      'Bấm "Cài đặt" — agent chạy ngay qua Izzi API (không cần Docker)',
      'Đảm bảo đã đăng nhập Izzi để dùng API key của bạn',
      'Bấm "Chat Now" và đặt câu hỏi / dán nội dung cần duyệt',
    ],
    features: ['Phản biện Socratic', 'Kiểm chứng theo bằng chứng', 'Fail-closed', 'Phán quyết kèm độ tin cậy', 'Chạy qua Izzi API'],
    tags: ['reasoning', 'review', 'izzi', 'governance'],
  },
  {
    id: 'orchestrator',
    name: 'orchestrator',
    displayName: 'Orchestrator',
    description: 'Điều phối viên của Izzi — phân loại độ khó, lập kế hoạch theo bước kèm kiểm chứng, cân rigor theo rủi ro. Không làm quá tay.',
    longDescription: 'Orchestrator là persona kỹ sư cấp cao của izzi toolkit: chia nhỏ tác vụ, lập kế hoạch có bước kiểm chứng, và áp đúng mức quy trình theo độ phức tạp/rủi ro. Chạy trực tiếp qua Izzi API — không cần cài Docker.',
    icon: '🧭',
    githubUrl: 'https://izziapi.com',
    githubStars: 'Izzi',
    category: 'orchestration',
    setupMethod: 'izzi',
    runtime: 'izzi',
    systemPrompt: ORCHESTRATOR_SYSTEM_PROMPT,
    model: 'izzi-smart',
    defaultPort: 0,
    chatEndpoint: '',
    healthEndpoint: '',
    status: 'not-installed',
    version: '1.0.0',
    supportedProviders: ['izzi'],
    setupSteps: [
      'Bấm "Cài đặt" — agent chạy ngay qua Izzi API (không cần Docker)',
      'Đảm bảo đã đăng nhập Izzi để dùng API key của bạn',
      'Bấm "Chat Now" và mô tả mục tiêu để nhận kế hoạch theo bước',
    ],
    features: ['Phân loại độ khó', 'Kế hoạch theo bước + kiểm chứng', 'Cân rigor theo rủi ro', 'Thay đổi đúng phạm vi', 'Chạy qua Izzi API'],
    tags: ['orchestration', 'planning', 'izzi', 'engineering'],
  },
  {
    id: 'designer',
    name: 'designer',
    displayName: 'Designer',
    description: 'Chuyên gia thiết kế cấp cao của Izzi — UI/UX có gu, đúng brand, không generic. Reference-first, token-first, anti-slop, verify thật.',
    longDescription: 'Designer là persona thiết kế của izzi: dựng UI/UX net-new, design system, brand kit và redesign high-fidelity theo chuẩn nhà izzi (nền kem, accent cyan/amber, tiết chế, chống "slop"). Reference-first + token-first, kiểm chứng giá trị áp thật. Chạy trực tiếp qua Izzi API — không cần cài Docker.',
    icon: '🎨',
    githubUrl: 'https://izziapi.com',
    githubStars: 'Izzi',
    category: 'design',
    setupMethod: 'izzi',
    runtime: 'izzi',
    systemPrompt: DESIGNER_SYSTEM_PROMPT,
    model: 'izzi-smart',
    defaultPort: 0,
    chatEndpoint: '',
    healthEndpoint: '',
    status: 'not-installed',
    version: '1.0.0',
    supportedProviders: ['izzi'],
    setupSteps: [
      'Bấm "Cài đặt" — agent chạy ngay qua Izzi API (không cần Docker)',
      'Đảm bảo đã đăng nhập Izzi để dùng API key của bạn',
      'Bấm "Chat Now" và mô tả màn hình/brand cần thiết kế',
    ],
    features: ['Reference-first', 'Token-first (:root)', 'Brand izzi', 'Anti-slop', 'Verify thật (desktop + mobile)', 'Chạy qua Izzi API'],
    tags: ['design', 'ui', 'ux', 'brand', 'izzi'],
  },
  {
    id: 'prototyper',
    name: 'prototyper',
    displayName: 'Prototyper',
    description: 'Ý tưởng → MVP. Dựng prototype chạy được nhanh để validate giả thuyết cốt lõi — tốc độ trước, polish sau.',
    longDescription: 'Prototyper mở đầu vòng đời sản phẩm izzi: biến ý tưởng thành proof-of-concept chạy được nhanh nhất, ưu tiên học hỏi hơn hoàn thiện, và ghi lại các chỗ tạm bợ để bước làm-thật xử lý. Chạy trực tiếp qua Izzi API — không cần Docker.',
    icon: '🧪',
    githubUrl: 'https://izziapi.com',
    githubStars: 'Izzi',
    category: 'pipeline',
    setupMethod: 'izzi',
    runtime: 'izzi',
    systemPrompt: PROTOTYPER_SYSTEM_PROMPT,
    model: 'izzi-smart',
    defaultPort: 0,
    chatEndpoint: '',
    healthEndpoint: '',
    status: 'not-installed',
    version: '1.0.0',
    supportedProviders: ['izzi'],
    setupSteps: [
      'Bấm "Cài đặt" — agent chạy ngay qua Izzi API (không cần Docker)',
      'Đảm bảo đã đăng nhập Izzi để dùng API key của bạn',
      'Bấm "Chat Now" và mô tả ý tưởng cần dựng prototype',
    ],
    features: ['Validate ý tưởng nhanh', 'Vibe coding', 'Ghi lại gap', 'Không over-engineer', 'Chạy qua Izzi API'],
    tags: ['pipeline', 'mvp', 'prototype', 'izzi'],
  },
  {
    id: 'builder',
    name: 'builder',
    displayName: 'Builder',
    description: 'MVP → sản phẩm thật. Lấp gap, thay code tạm bợ, đúng spec, build/test pass trước khi gọi là xong.',
    longDescription: 'Builder nâng prototype đã validate thành sản phẩm chạy thật đúng spec: feature-complete theo acceptance criteria, thay code tạm bợ bằng triển khai đúng, và chốt chất lượng qua verification-loop. Chạy trực tiếp qua Izzi API — không cần Docker.',
    icon: '🔨',
    githubUrl: 'https://izziapi.com',
    githubStars: 'Izzi',
    category: 'pipeline',
    setupMethod: 'izzi',
    runtime: 'izzi',
    systemPrompt: BUILDER_SYSTEM_PROMPT,
    model: 'izzi-smart',
    defaultPort: 0,
    chatEndpoint: '',
    healthEndpoint: '',
    status: 'not-installed',
    version: '1.0.0',
    supportedProviders: ['izzi'],
    setupSteps: [
      'Bấm "Cài đặt" — agent chạy ngay qua Izzi API (không cần Docker)',
      'Đảm bảo đã đăng nhập Izzi để dùng API key của bạn',
      'Bấm "Chat Now" và giao prototype/spec cần nâng thành sản phẩm',
    ],
    features: ['Đúng spec', 'Lấp gap', 'Thay code tạm bợ', 'build/test/lint pass', 'Chạy qua Izzi API'],
    tags: ['pipeline', 'product', 'build', 'izzi'],
  },
  {
    id: 'sweeper',
    name: 'sweeper',
    displayName: 'Sweeper',
    description: 'Polish. Trau chuốt UI/UX, đơn giản hóa code/system và tối ưu để sản phẩm đạt độ hoàn thiện cao.',
    longDescription: 'Sweeper nâng sản phẩm đã đúng spec lên độ hoàn thiện cao: tinh chỉnh UI/UX, thống nhất ngôn ngữ thiết kế, gỡ phức tạp thừa và tối ưu có chủ đích — chỉ chạm cái cần polish. Chạy trực tiếp qua Izzi API — không cần Docker.',
    icon: '🧹',
    githubUrl: 'https://izziapi.com',
    githubStars: 'Izzi',
    category: 'pipeline',
    setupMethod: 'izzi',
    runtime: 'izzi',
    systemPrompt: SWEEPER_SYSTEM_PROMPT,
    model: 'izzi-smart',
    defaultPort: 0,
    chatEndpoint: '',
    healthEndpoint: '',
    status: 'not-installed',
    version: '1.0.0',
    supportedProviders: ['izzi'],
    setupSteps: [
      'Bấm "Cài đặt" — agent chạy ngay qua Izzi API (không cần Docker)',
      'Đảm bảo đã đăng nhập Izzi để dùng API key của bạn',
      'Bấm "Chat Now" và chỉ ra phần cần trau chuốt/đơn giản hóa',
    ],
    features: ['Trau chuốt UI/UX', 'Nhất quán thị giác', 'Đơn giản hóa code', 'Tối ưu có chủ đích', 'Chạy qua Izzi API'],
    tags: ['pipeline', 'polish', 'ui', 'izzi'],
  },
  {
    id: 'maintainer',
    name: 'maintainer',
    displayName: 'Maintainer',
    description: 'Vận hành/tăng trưởng. Ổn định, bảo mật, scale, monitoring, ứng phó sự cố, deploy an toàn — fail-closed.',
    longDescription: 'Maintainer là điểm hội tụ cuối: giữ hệ thống ổn định, bảo mật và scale được khi tăng trưởng. Áp bảo mật ở mức chặt (chạm prod), ưu tiên rollback khi nghi ngờ, và không gọi việc là "xong" khi chưa qua verification. Chạy trực tiếp qua Izzi API — không cần Docker.',
    icon: '🛡️',
    githubUrl: 'https://izziapi.com',
    githubStars: 'Izzi',
    category: 'pipeline',
    setupMethod: 'izzi',
    runtime: 'izzi',
    systemPrompt: MAINTAINER_SYSTEM_PROMPT,
    model: 'izzi-smart',
    defaultPort: 0,
    chatEndpoint: '',
    healthEndpoint: '',
    status: 'not-installed',
    version: '1.0.0',
    supportedProviders: ['izzi'],
    setupSteps: [
      'Bấm "Cài đặt" — agent chạy ngay qua Izzi API (không cần Docker)',
      'Đảm bảo đã đăng nhập Izzi để dùng API key của bạn',
      'Bấm "Chat Now" và mô tả nhu cầu vận hành/sự cố/scale',
    ],
    features: ['Ổn định & scale', 'Monitoring', 'Ứng phó sự cố + rollback', 'Deploy an toàn', 'Fail-closed', 'Chạy qua Izzi API'],
    tags: ['pipeline', 'ops', 'security', 'scale', 'izzi'],
  },
  {
    id: 'grower',
    name: 'grower',
    displayName: 'Grower',
    description: 'Go-to-market (chạy song song). Chiến lược phát triển, cảm quan thị trường, đưa sản phẩm ra thị trường — không kỹ thuật.',
    longDescription: 'Grower là nhánh go-to-market chạy song song nhánh kỹ thuật: định hình phân khúc/định vị/value proposition/kênh, đọc cảm quan thị trường và chuyển nhu cầu thị trường thành ưu tiên vận hành. Tập trung thị trường/chiến lược — không đụng code. Chạy trực tiếp qua Izzi API — không cần Docker.',
    icon: '📈',
    githubUrl: 'https://izziapi.com',
    githubStars: 'Izzi',
    category: 'pipeline',
    setupMethod: 'izzi',
    runtime: 'izzi',
    systemPrompt: GROWER_SYSTEM_PROMPT,
    model: 'izzi-smart',
    defaultPort: 0,
    chatEndpoint: '',
    healthEndpoint: '',
    status: 'not-installed',
    version: '1.0.0',
    supportedProviders: ['izzi'],
    setupSteps: [
      'Bấm "Cài đặt" — agent chạy ngay qua Izzi API (không cần Docker)',
      'Đảm bảo đã đăng nhập Izzi để dùng API key của bạn',
      'Bấm "Chat Now" và mô tả sản phẩm + mục tiêu thị trường',
    ],
    features: ['Chiến lược GTM', 'Cảm quan thị trường', 'Jobs-to-be-done', 'Ưu tiên theo thị trường', 'Chạy qua Izzi API'],
    tags: ['pipeline', 'go-to-market', 'strategy', 'izzi'],
  },
  {
    id: 'openclaw',
    name: 'openclaw',
    displayName: 'OpenClaw',
    description: 'Local-first autonomous AI agent — chạy trực tiếp, không cần cloud. Hỗ trợ skills, cron jobs, memory và multi-platform messaging.',
    longDescription: 'OpenClaw là AI Agent tự chủ hoàn toàn, chạy cục bộ trên máy bạn. Tích hợp sẵn Telegram, Zalo, Facebook Messenger. Hỗ trợ plugin system, scheduled tasks, và persistent memory.',
    icon: '🦞',
    githubUrl: 'https://github.com/openclaw-ai/openclaw',
    githubStars: '350k+',
    category: 'autonomous',
    setupMethod: 'docker',
    dockerImage: 'openclaw/gateway:latest',
    defaultPort: 18789,
    chatEndpoint: '/api/chat',
    healthEndpoint: '/health',
    status: 'not-installed',
    version: '1.0.0',
    supportedProviders: ['izzi', 'openai', 'anthropic', 'gemini', 'openrouter', 'ollama', 'custom'],
    setupSteps: [
      'Kiểm tra Docker đang chạy',
      'Pull image openclaw/gateway:latest',
      'Cấu hình API key và model',
      'Khởi động container',
      'Kiểm tra kết nối',
    ],
    features: ['Autonomous tasks', 'Multi-platform messaging', 'Cron jobs', 'Persistent memory', 'Plugin system'],
    tags: ['autonomous', 'local-first', 'messaging', 'automation'],
  },
  {
    id: 'hermes',
    name: 'hermes-agent',
    displayName: 'Hermes Agent',
    description: 'Self-improving AI Agent — tự học skill mới, nhớ ngữ cảnh xuyên phiên, messaging gateway (Telegram, Discord, Slack, WhatsApp, Signal).',
    longDescription: 'Hermes Agent là AI Agent tự cải thiện duy nhất, được phát triển bởi Nous Research. Có vòng lặp học tập tích hợp — tự tạo skill từ kinh nghiệm, cải thiện trong quá trình sử dụng, lưu trữ kiến thức xuyên phiên, và xây dựng hồ sơ người dùng. Hỗ trợ 200+ model qua OpenRouter, Telegram/Discord/Slack gateway, và MCP integration.',
    icon: '⚡',
    githubUrl: 'https://github.com/NousResearch/hermes-agent',
    githubStars: '113k+',
    category: 'autonomous',
    setupMethod: 'docker',
    dockerImage: 'nousresearch/hermes-agent:latest',
    defaultPort: 8642,
    chatEndpoint: '/v1/chat/completions',
    healthEndpoint: '/health',
    status: 'not-installed',
    supportedProviders: ['izzi', 'openai', 'anthropic', 'gemini', 'openrouter', 'ollama', 'custom'],
    setupSteps: [
      'Kiểm tra Docker / Python environment',
      'Pull hermes-agent image hoặc pip install hermes-agent',
      'Chạy hermes setup — cấu hình model provider',
      'Cấu hình messaging gateway (Telegram, Discord, etc.)',
      'Khởi động Hermes Agent và kiểm tra kết nối',
    ],
    features: ['Self-improving skills', 'Cross-session memory', 'Messaging gateway', 'MCP integration', 'Cron scheduling', '200+ model support'],
    tags: ['autonomous', 'self-improving', 'messaging', 'memory', 'skills'],
  },
  {
    id: 'dify',
    name: 'dify',
    displayName: 'Dify',
    description: 'LLM App Platform — xây dựng chatbot, workflow, RAG pipeline với giao diện kéo thả. Self-hosted hoàn toàn.',
    longDescription: 'Dify là nền tảng phát triển LLM application mạnh mẽ nhất hiện nay. Hỗ trợ RAG, Agent, Workflow, và nhiều loại app. Giao diện trực quan, kéo thả, không cần code.',
    icon: '🤖',
    githubUrl: 'https://github.com/langgenius/dify',
    githubStars: '100k+',
    category: 'platform',
    setupMethod: 'docker',
    dockerImage: 'langgenius/dify-api:1.13.3',
    dockerComposeUrl: 'https://raw.githubusercontent.com/langgenius/dify/main/docker/docker-compose.yaml',
    defaultPort: 3000,
    chatEndpoint: '/v1/chat-messages',
    healthEndpoint: '/health',
    status: 'not-installed',
    version: '1.13.3',
    supportedProviders: ['izzi', 'openai', 'anthropic', 'gemini', 'openrouter', 'ollama'],
    setupSteps: [
      'Pull Docker Compose config',
      'Cấu hình environment variables',
      'Chạy docker compose up -d',
      'Truy cập web UI tại localhost:3000',
      'Tạo app và cấu hình API key',
    ],
    features: ['Visual workflow builder', 'RAG pipeline', 'Agent framework', 'Knowledge base', 'API publishing'],
    tags: ['platform', 'rag', 'workflow', 'no-code'],
  },
  {
    id: 'autogpt',
    name: 'autogpt',
    displayName: 'AutoGPT',
    description: 'Agent tự trị tiên phong — tự lập kế hoạch, thực thi nhiệm vụ phức tạp với khả năng tự phản hồi và cải thiện.',
    longDescription: 'AutoGPT là framework agent tự trị đầu tiên và phổ biến nhất. Agent có thể tự đặt mục tiêu con, thực thi, đánh giá kết quả và lặp lại cho đến khi hoàn thành nhiệm vụ.',
    icon: '🧠',
    githubUrl: 'https://github.com/Significant-Gravitas/AutoGPT',
    githubStars: '180k+',
    category: 'autonomous',
    setupMethod: 'docker',
    dockerImage: 'autogpt/autogpt:0.6.50',
    defaultPort: 8000,
    chatEndpoint: '/api/v1/agents/run',
    healthEndpoint: '/health',
    status: 'not-installed',
    version: '0.6.50',
    supportedProviders: ['izzi', 'openai', 'anthropic', 'gemini', 'openrouter'],
    setupSteps: [
      'Pull Docker image',
      'Cấu hình API key cho LLM provider',
      'Khởi động AutoGPT server',
      'Tạo agent profile',
      'Kiểm tra kết nối',
    ],
    features: ['Autonomous goal decomposition', 'Self-reflection', 'Web browsing', 'Code execution', 'File management'],
    tags: ['autonomous', 'goal-driven', 'self-improving'],
  },
  {
    id: 'crewai',
    name: 'crewai',
    displayName: 'CrewAI',
    description: 'Multi-agent orchestration — tạo đội AI agents cộng tác với nhau, mỗi agent có vai trò và chuyên môn riêng.',
    longDescription: 'CrewAI cho phép bạn tạo một "crew" gồm nhiều AI agents, mỗi agent có role, goal và tools riêng. Các agents tự phối hợp để giải quyết vấn đề phức tạp.',
    icon: '👥',
    githubUrl: 'https://github.com/crewAIInc/crewAI',
    githubStars: '50k+',
    category: 'orchestration',
    setupMethod: 'pip',
    dockerImage: 'crewai/crewai:1.10.1',
    defaultPort: 8080,
    chatEndpoint: '/api/v1/crews/run',
    healthEndpoint: '/health',
    status: 'not-installed',
    version: '1.10.1',
    supportedProviders: ['izzi', 'openai', 'anthropic', 'gemini', 'openrouter', 'ollama'],
    setupSteps: [
      'Cài đặt Python environment',
      'Pull Docker image hoặc pip install crewai==1.10.1',
      'Cấu hình crew definition (YAML)',
      'Cấu hình API key',
      'Khởi động CrewAI server',
    ],
    features: ['Multi-agent collaboration', 'Role-based agents', 'Tool integration', 'Process orchestration', 'Memory sharing'],
    tags: ['multi-agent', 'orchestration', 'collaboration', 'roles'],
  },
  {
    id: 'n8n',
    name: 'n8n',
    displayName: 'n8n',
    description: 'AI-native workflow automation — kết nối 400+ dịch vụ, tự động hoá quy trình với AI nodes tích hợp sẵn.',
    longDescription: 'n8n là nền tảng workflow automation mạnh mẽ với giao diện node-based. Tích hợp AI agents, LLM tools, và 400+ dịch vụ bên ngoài. Self-hosted hoàn toàn.',
    icon: '🔗',
    githubUrl: 'https://github.com/n8n-io/n8n',
    githubStars: '60k+',
    category: 'workflow',
    setupMethod: 'docker',
    dockerImage: 'n8nio/n8n:2.21',
    defaultPort: 5678,
    chatEndpoint: '/webhook/chat',
    healthEndpoint: '/healthz',
    status: 'not-installed',
    version: '2.21',
    supportedProviders: ['izzi', 'openai', 'anthropic', 'gemini', 'openrouter', 'ollama'],
    setupSteps: [
      'Pull Docker image n8nio/n8n:2.21',
      'Khởi động container với port mapping',
      'Truy cập web UI tại localhost:5678',
      'Tạo workflow với AI nodes',
      'Cấu hình webhook cho chat',
    ],
    features: ['400+ integrations', 'Visual workflow builder', 'AI agent nodes', 'Webhook triggers', 'Self-hosted'],
    tags: ['workflow', 'automation', 'integrations', 'no-code'],
  },
];
