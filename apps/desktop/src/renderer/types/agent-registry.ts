/**
 * Agent Registry Types — Multi-Agent Gateway Platform
 *
 * Type definitions for the external agent system, chat gateway, and model provider layer.
 */

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

export type AgentSetupMethod = 'docker' | 'npm' | 'pip' | 'native';
export type AgentCategory = 'autonomous' | 'platform' | 'orchestration' | 'workflow';
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
}

export interface AgentChatSession {
  id: string;
  agentId: string;
  agentName: string;
  agentIcon: string;
  messages: GatewayChatMessage[];
  model: string;
  provider: AIProvider;
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
      { id: 'izzi/auto', name: 'Izzi Smart Router', provider: 'izzi', checked: true },
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

export const TOP_AGENTS: ExternalAgent[] = [
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
    dockerImage: 'langgenius/dify-api:latest',
    dockerComposeUrl: 'https://raw.githubusercontent.com/langgenius/dify/main/docker/docker-compose.yaml',
    defaultPort: 3000,
    chatEndpoint: '/v1/chat-messages',
    healthEndpoint: '/health',
    status: 'not-installed',
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
    dockerImage: 'autogpt/autogpt:latest',
    defaultPort: 8000,
    chatEndpoint: '/api/v1/agents/run',
    healthEndpoint: '/health',
    status: 'not-installed',
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
    dockerImage: 'crewai/crewai:latest',
    defaultPort: 8080,
    chatEndpoint: '/api/v1/crews/run',
    healthEndpoint: '/health',
    status: 'not-installed',
    supportedProviders: ['izzi', 'openai', 'anthropic', 'gemini', 'openrouter', 'ollama'],
    setupSteps: [
      'Cài đặt Python environment',
      'Pull Docker image hoặc pip install crewai',
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
    dockerImage: 'n8nio/n8n:latest',
    defaultPort: 5678,
    chatEndpoint: '/webhook/chat',
    healthEndpoint: '/healthz',
    status: 'not-installed',
    supportedProviders: ['izzi', 'openai', 'anthropic', 'gemini', 'openrouter', 'ollama'],
    setupSteps: [
      'Pull Docker image n8nio/n8n',
      'Khởi động container với port mapping',
      'Truy cập web UI tại localhost:5678',
      'Tạo workflow với AI nodes',
      'Cấu hình webhook cho chat',
    ],
    features: ['400+ integrations', 'Visual workflow builder', 'AI agent nodes', 'Webhook triggers', 'Self-hosted'],
    tags: ['workflow', 'automation', 'integrations', 'no-code'],
  },
];
