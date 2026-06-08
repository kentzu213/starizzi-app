import type {
  ManagedAgentStatus,
  ManagedAgentStreamRequest,
  ManagedProviderStreamChunk,
} from './types';

/**
 * Common provider interface. Both ManagedAgentProvider (existing) and
 * CustomOpenAIProvider (new) implement this so the AgentService routing layer
 * can treat them interchangeably (Provider-Strategy).
 */
export interface ChatProvider {
  streamChat(request: ManagedAgentStreamRequest): AsyncGenerator<ManagedProviderStreamChunk>;
  getStatus(sessionId?: string): Promise<ManagedAgentStatus | null>;
  testConnection?(): Promise<ProviderTestResult>;
}

export interface ProviderTestResult {
  ok: boolean;
  model?: string;
  /** message MUST be redacted of any API key before reaching this type. */
  message?: string;
  httpStatus?: number;
}
