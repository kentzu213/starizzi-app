export type AgentProviderId = 'izziapi-managed';
export type ChatMessageRole = 'system' | 'user' | 'assistant';
export type ChatMessageState = 'queued' | 'streaming' | 'done' | 'error';
export type AgentRuntimeStatus = 'idle' | 'connecting' | 'running' | 'error';
export type AgentTaskStatus = 'todo' | 'in_progress' | 'blocked' | 'done';
export type AgentMemoryKind = 'fact' | 'preference' | 'constraint' | 'resource';
export type IntegrationProvider = 'telegram' | 'discord' | 'zalo';
export type IntegrationConnectionStatus = 'connected' | 'disconnected' | 'pending' | 'error';

export interface ChatSession {
  id: string;
  title: string;
  provider: AgentProviderId;
  createdAt: string;
  updatedAt: string;
}

export interface ChatMessage {
  id: string;
  sessionId: string;
  role: ChatMessageRole;
  content: string;
  state: ChatMessageState;
  createdAt: string;
  requestId?: string;
}

export interface AgentRuntimeState {
  sessionId?: string;
  state: AgentRuntimeStatus;
  lastError?: string;
  updatedAt: string;
}

export interface AgentTask {
  id: string;
  sessionId?: string;
  title: string;
  status: AgentTaskStatus;
  summary?: string;
  sourceMessageId?: string;
  createdAt: string;
  updatedAt: string;
}

export interface AgentMemory {
  id: string;
  sessionId?: string;
  kind: AgentMemoryKind;
  content: string;
  pinned: boolean;
  sourceMessageId?: string;
  createdAt: string;
  updatedAt: string;
}

// ── AI-company "Run" storage (agent-company spec, Phase 1) ──
// A Run is a durable work record (the blackboard): a goal + current lifecycle stage,
// with timestamped, agent-attributed entries (artifacts / notes / handoffs) carrying
// provenance. This is the storage backbone the company operates on.

export type AgentRunStatus = 'active' | 'done' | 'blocked' | 'archived';

export interface AgentRun {
  id: string;
  goal: string;
  /** Lifecycle stage: idea | prototype | build | polish | operate | gtm (free-form allowed). */
  stage: string;
  status: AgentRunStatus;
  createdAt: string;
  updatedAt: string;
}

export type AgentRunEntryKind = 'artifact' | 'note' | 'handoff' | 'event';

export interface AgentRunEntry {
  id: string;
  runId: string;
  kind: AgentRunEntryKind;
  /** Lifecycle stage that produced this entry. */
  stage?: string;
  /** Provenance: which agent/mission produced it. */
  agentId?: string;
  content: string;
  createdAt: string;
}

export interface IntegrationConnection {
  provider: IntegrationProvider;
  status: IntegrationConnectionStatus;
  accountLabel?: string;
  connectedAt?: string;
  lastError?: string;
}

export interface OnboardingState {
  seenAt?: string;
  dismissedAt?: string;
  completedAt?: string;
  shouldAutoOpen: boolean;
  hasPendingSetup: boolean;
  isCompleted: boolean;
}

export interface DiagnosticEvent {
  id: string;
  timestamp: string;
  type: string;
  status: 'success' | 'error' | 'info' | 'idle';
  detail: string;
  meta?: Record<string, unknown>;
}

export interface AgentStreamEvent {
  requestId: string;
  sessionId: string;
  type:
    | 'status'
    | 'assistant_start'
    | 'assistant_delta'
    | 'assistant_done'
    | 'task_upsert'
    | 'memory_upsert'
    | 'error';
  messageId?: string;
  delta?: string;
  state?: AgentRuntimeStatus;
  error?: string;
  task?: AgentTask;
  memory?: AgentMemory;
}

export interface AgentBootstrapPayload {
  session: ChatSession | null;
  messages: ChatMessage[];
  state: AgentRuntimeState;
}

export interface AgentSendMessageResult {
  requestId: string;
  userMessageId: string;
  assistantMessageId: string;
}

export interface AgentHistoryMessage {
  role: ChatMessageRole;
  content: string;
}

export interface ManagedAgentStreamRequest {
  sessionId: string;
  message: string;
  history: AgentHistoryMessage[];
  /** Pasted image attachments as data URLs; sent as multimodal `image_url` parts. */
  images?: string[];
  user?: {
    id?: string;
    email?: string;
    name?: string;
  };
}

export interface ManagedAgentStatus {
  state: AgentRuntimeStatus;
  lastError?: string;
  updatedAt?: string;
}

export type ManagedProviderStreamChunk = Pick<
  AgentStreamEvent,
  'type' | 'delta' | 'state' | 'error' | 'task' | 'memory'
>;
