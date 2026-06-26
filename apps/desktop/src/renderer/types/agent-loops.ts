/**
 * Agent Loops — task-oriented loop presets for the Agent Workspace.
 *
 * A "loop" is a reusable, task-shaped agent configuration (agent + model). Selecting a
 * loop configures the active chat session. This module is PURE (no side effects): the UI
 * layer (Chat.tsx) reads the plan from `planLoopApplication` and drives the gateway store.
 *
 * Out of scope (later phases): real background execution, schedulers, and writing loop
 * runs into the izzi knowledge graph / agent memory.
 */
import type {
  AgentCategory,
  AgentChatSession,
  AIProvider,
  ExternalAgent,
} from './agent-registry';

// ── Loop model ──

export type LoopTask =
  | 'research'
  | 'automation'
  | 'coding'
  | 'content'
  | 'data-rag'
  | 'orchestration';

export interface AgentLoop {
  id: string;
  label: string;
  task: LoopTask;
  description: string;
  icon: string;
  /** Must match an ExternalAgent.id in TOP_AGENTS (validated at apply time). */
  suggestedAgentId: string;
  /** Must match a ModelOption.id in MODEL_PROVIDERS. */
  suggestedModel: string;
  suggestedProvider: AIProvider;
  /** Prompt khởi đầu chèn vào ô soạn tin khi chọn loop (Req 9.1). */
  starterPrompt: string;
}

// ── Static presets (Req 3.5: data-only, no execution) ──

export const AGENT_LOOPS: AgentLoop[] = [
  {
    id: 'loop-research',
    label: 'Nghiên cứu',
    task: 'research',
    description: 'Thu thập, tổng hợp và đối chiếu thông tin từ nhiều nguồn.',
    icon: '🔬',
    suggestedAgentId: 'hermes',
    suggestedModel: 'gemini-2.5-pro',
    suggestedProvider: 'izzi',
    starterPrompt: 'Hãy nghiên cứu và tổng hợp thông tin về chủ đề sau: ',
  },
  {
    id: 'loop-automation',
    label: 'Tự động hoá',
    task: 'automation',
    description: 'Kết nối dịch vụ và tự động hoá quy trình nhiều bước.',
    icon: '⚙️',
    suggestedAgentId: 'n8n',
    suggestedModel: 'izzi/auto',
    suggestedProvider: 'izzi',
    starterPrompt: 'Hãy giúp tôi tự động hoá quy trình sau: ',
  },
  {
    id: 'loop-coding',
    label: 'Lập trình',
    task: 'coding',
    description: 'Lập kế hoạch, viết và chạy code theo mục tiêu.',
    icon: '💻',
    suggestedAgentId: 'autogpt',
    suggestedModel: 'claude-4-sonnet',
    suggestedProvider: 'izzi',
    starterPrompt: 'Hãy giúp tôi lập trình tính năng sau: ',
  },
  {
    id: 'loop-content',
    label: 'Nội dung',
    task: 'content',
    description: 'Soạn thảo, biên tập và xuất bản nội dung.',
    icon: '✍️',
    suggestedAgentId: 'openclaw',
    suggestedModel: 'claude-4-sonnet',
    suggestedProvider: 'izzi',
    starterPrompt: 'Hãy giúp tôi soạn nội dung về: ',
  },
  {
    id: 'loop-data-rag',
    label: 'Dữ liệu / RAG',
    task: 'data-rag',
    description: 'Xây pipeline RAG, hỏi đáp trên kho tri thức của bạn.',
    icon: '🗂️',
    suggestedAgentId: 'dify',
    suggestedModel: 'izzi/auto',
    suggestedProvider: 'izzi',
    starterPrompt: 'Hãy giúp tôi xây dựng pipeline RAG cho nguồn dữ liệu: ',
  },
  {
    id: 'loop-orchestration',
    label: 'Đa agent',
    task: 'orchestration',
    description: 'Điều phối nhiều agent cộng tác theo vai trò.',
    icon: '🧩',
    suggestedAgentId: 'crewai',
    suggestedModel: 'izzi/auto',
    suggestedProvider: 'izzi',
    starterPrompt: 'Hãy điều phối các agent để thực hiện tác vụ: ',
  },
];

// ── Pure helpers ──

/** Vietnamese labels for agent categories shown as group titles in the Agent Rail. */
export const CATEGORY_LABELS: Record<AgentCategory, string> = {
  autonomous: 'Tự chủ',
  platform: 'Nền tảng',
  orchestration: 'Điều phối',
  workflow: 'Tự động hoá',
};

/** Stable display order of categories in the rail. */
export const CATEGORY_ORDER: AgentCategory[] = [
  'autonomous',
  'platform',
  'orchestration',
  'workflow',
];

export interface AgentGroup {
  category: AgentCategory;
  label: string;
  agents: ExternalAgent[];
}

/**
 * Group agents by category in a stable order. Only categories with >=1 agent are returned.
 * Total agents across groups always equals the input length (Req 8.1 — full coverage).
 */
export function groupAgentsByCategory(agents: ExternalAgent[]): AgentGroup[] {
  const groups: AgentGroup[] = [];
  for (const category of CATEGORY_ORDER) {
    const inCategory = agents.filter((a) => a.category === category);
    if (inCategory.length > 0) {
      groups.push({ category, label: CATEGORY_LABELS[category], agents: inCategory });
    }
  }
  return groups;
}

export interface LoopPlan {
  /** 'configure-existing' keeps the active session's agent and only sets the model. */
  action: 'configure-existing' | 'open-new';
  /** Agent to open when action is 'open-new'; null when the suggested agent is unknown. */
  agentId: string | null;
  model: string;
  provider: AIProvider;
}

/**
 * Decide what to do when a loop is selected (Req 3.3, 3.4, 3.6).
 * Pure: returns a plan; the caller drives the gateway store.
 *
 * - Active session exists  -> configure it (set model/provider), keep its agent.
 * - No session, agent known -> open a new session with the suggested agent.
 * - No session, agent unknown -> agentId null (caller skips opening, still lets user chat).
 */
export function planLoopApplication(
  loop: AgentLoop,
  activeSession: AgentChatSession | null,
  agents: ExternalAgent[],
): LoopPlan {
  if (activeSession) {
    return {
      action: 'configure-existing',
      agentId: activeSession.agentId,
      model: loop.suggestedModel,
      provider: loop.suggestedProvider,
    };
  }

  // Explicit own-property lookup via array search (no prototype-chain key access).
  const known = agents.some((a) => a.id === loop.suggestedAgentId);
  return {
    action: 'open-new',
    agentId: known ? loop.suggestedAgentId : null,
    model: loop.suggestedModel,
    provider: loop.suggestedProvider,
  };
}

/**
 * Return the starter prompt for a given loop (Req 9.1, 9.4).
 * Pure function — no side effects; the caller drives the composer draft.
 */
export function loopStarterDraft(loop: AgentLoop): string {
  return loop.starterPrompt;
}
