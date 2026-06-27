/**
 * Agent Gateway Store — Zustand state for multi-agent chat gateway
 *
 * Manages chat sessions across multiple agents, model selection,
 * and agent status tracking.
 */
import { create } from 'zustand';
import type {
  AgentChatSession,
  AIProvider,
  ExternalAgent,
  ExternalAgentStatus,
  GatewayChatMessage,
} from '../types/agent-registry';
import { TOP_AGENTS } from '../types/agent-registry';

function createLocalId(prefix: string): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `${prefix}-${crypto.randomUUID()}`;
  }
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

interface AgentGatewayState {
  // Agent registry
  agents: ExternalAgent[];

  // Chat sessions (one per active agent tab)
  sessions: AgentChatSession[];
  activeSessionId: string | null;

  // UI state
  isSending: boolean;
  errorMessage: string | null;

  // Actions — Agent management
  updateAgentStatus: (agentId: string, status: ExternalAgentStatus, version?: string) => void;
  refreshAgentStatuses: () => Promise<void>;

  // Actions — Chat gateway
  openAgentChat: (agentId: string) => void;
  closeAgentChat: (sessionId: string) => void;
  switchSession: (sessionId: string) => void;
  sendGatewayMessage: (text: string) => Promise<boolean>;
  newGatewaySession: (agentId: string) => void;
  setSessionModel: (sessionId: string, model: string, provider: AIProvider) => void;

  // Getters
  activeSession: () => AgentChatSession | null;
  getAgentById: (agentId: string) => ExternalAgent | undefined;
}

export const useAgentGatewayStore = create<AgentGatewayState>((set, get) => ({
  agents: TOP_AGENTS.map((agent) => ({ ...agent })),
  sessions: [],
  activeSessionId: null,
  isSending: false,
  errorMessage: null,

  updateAgentStatus: (agentId, status, version) => {
    set((state) => ({
      agents: state.agents.map((a) =>
        a.id === agentId ? { ...a, status, version: version ?? a.version } : a,
      ),
    }));
  },

  refreshAgentStatuses: async () => {
    const { agents } = get();

    for (const agent of agents) {
      if (agent.status === 'not-installed') continue;
      if (agent.runtime === 'izzi') continue; // izzi-native agents have no local port to poll

      try {
        const url = `http://127.0.0.1:${agent.defaultPort}${agent.healthEndpoint}`;
        const res = await fetch(url, { signal: AbortSignal.timeout(3000) });
        const nextStatus: ExternalAgentStatus = res.ok ? 'running' : 'error';

        set((state) => ({
          agents: state.agents.map((a) =>
            a.id === agent.id ? { ...a, status: nextStatus } : a,
          ),
        }));
      } catch {
        // Agent not reachable — mark as stopped if was running
        set((state) => ({
          agents: state.agents.map((a) =>
            a.id === agent.id && a.status === 'running'
              ? { ...a, status: 'stopped' }
              : a,
          ),
        }));
      }
    }
  },

  openAgentChat: (agentId) => {
    const { sessions, agents } = get();

    // If session for this agent already exists, switch to it
    const existing = sessions.find((s) => s.agentId === agentId && s.isActive);
    if (existing) {
      set({ activeSessionId: existing.id });
      return;
    }

    const agent = agents.find((a) => a.id === agentId);
    if (!agent) return;

    const newSession: AgentChatSession = {
      id: createLocalId('gw-session'),
      agentId: agent.id,
      agentName: agent.displayName,
      agentIcon: agent.icon,
      messages: [],
      model: 'izzi/auto',
      provider: 'izzi',
      createdAt: new Date().toISOString(),
      isActive: true,
    };

    set((state) => ({
      sessions: [...state.sessions, newSession],
      activeSessionId: newSession.id,
    }));
  },

  closeAgentChat: (sessionId) => {
    set((state) => {
      const nextSessions = state.sessions.filter((s) => s.id !== sessionId);
      const nextActiveId =
        state.activeSessionId === sessionId
          ? nextSessions[nextSessions.length - 1]?.id ?? null
          : state.activeSessionId;

      return {
        sessions: nextSessions,
        activeSessionId: nextActiveId,
      };
    });
  },

  switchSession: (sessionId) => {
    set({ activeSessionId: sessionId });
  },

  sendGatewayMessage: async (text) => {
    const content = text.trim();
    if (!content || get().isSending) return false;

    const session = get().activeSession();
    if (!session) return false;

    const agent = get().agents.find((a) => a.id === session.agentId);
    if (!agent) return false;

    const createdAt = new Date().toISOString();
    const userMsgId = createLocalId('gw-user');
    const assistantMsgId = createLocalId('gw-assistant');

    const userMessage: GatewayChatMessage = {
      id: userMsgId,
      sessionId: session.id,
      agentId: session.agentId,
      role: 'user',
      content,
      state: 'done',
      model: session.model,
      createdAt,
    };

    const assistantMessage: GatewayChatMessage = {
      id: assistantMsgId,
      sessionId: session.id,
      agentId: session.agentId,
      role: 'assistant',
      content: '',
      state: 'streaming',
      model: session.model,
      createdAt,
    };

    // Optimistic update
    set((state) => ({
      isSending: true,
      errorMessage: null,
      sessions: state.sessions.map((s) =>
        s.id === session.id
          ? { ...s, messages: [...s.messages, userMessage, assistantMessage] }
          : s,
      ),
    }));

    // Try to call agent's chat API
    try {
      // Izzi-native persona agents (Socrates, Orchestrator) run through the Izzi
      // API in the MAIN process — the key stays in main, never in the renderer.
      if (agent.runtime === 'izzi') {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const izziApi = (window as any).electronAPI?.izziAgent;
        if (izziApi?.chat) {
          const history = session.messages
            .filter((m) => m.state === 'done' && m.content)
            .slice(-8)
            .map((m) => ({ role: m.role, content: m.content }));
          const r = await izziApi.chat({
            systemPrompt: agent.systemPrompt ?? '',
            message: content,
            history,
            model: session.model,
          });
          const reply = r?.reply
            ? r.reply
            : r?.error === 'no-key'
              ? '⚠️ Cần đăng nhập Izzi (hoặc cấu hình API key) để chat với agent này.'
              : `⚠️ ${agent.displayName} chưa trả lời được (${r?.error ?? 'không rõ'}).`;
          set((state) => ({
            isSending: false,
            sessions: state.sessions.map((s) =>
              s.id === session.id
                ? {
                    ...s,
                    messages: s.messages.map((m) =>
                      m.id === assistantMsgId ? { ...m, content: reply, state: 'done' as const } : m,
                    ),
                  }
                : s,
            ),
          }));
          return true;
        }
        // No bridge (browser dev) — be honest, don't fake a reply.
        set((state) => ({
          isSending: false,
          sessions: state.sessions.map((s) =>
            s.id === session.id
              ? {
                  ...s,
                  messages: s.messages.map((m) =>
                    m.id === assistantMsgId
                      ? {
                          ...m,
                          content: 'ℹ️ Mở trong app Izzi (đã đăng nhập) để chat với agent này.',
                          state: 'done' as const,
                        }
                      : m,
                  ),
                }
              : s,
          ),
        }));
        return true;
      }

      // Docker agents with an OpenAI-compatible endpoint (e.g. Hermes) route
      // through the main process via IPC — the API key stays in main and is
      // never exposed to the renderer.
      const dockerAgentApi = (window as any).electronAPI?.dockerAgent;
      const isOpenAiCompatible =
        agent.setupMethod === 'docker' && agent.chatEndpoint === '/v1/chat/completions';

      if (isOpenAiCompatible && dockerAgentApi?.chat) {
        const r = await dockerAgentApi.chat(
          { id: agent.id, defaultPort: agent.defaultPort },
          content,
        );

        if (r.ok && r.reply) {
          set((state) => ({
            isSending: false,
            sessions: state.sessions.map((s) =>
              s.id === session.id
                ? {
                    ...s,
                    messages: s.messages.map((m) =>
                      m.id === assistantMsgId
                        ? { ...m, content: r.reply as string, state: 'done' as const }
                        : m,
                    ),
                  }
                : s,
            ),
          }));
          return true;
        }

        // Honest error from the agent/provider (no fallback simulation).
        const errReply =
          `⚠️ ${agent.displayName} chưa trả lời được.\n\n**Lỗi:** ${r.error ?? 'không rõ'}\n\n` +
          'Nếu lỗi liên quan tới provider/model, hãy cấu hình model provider (API key) ' +
          'hoặc chạy `hermes setup` cho agent, rồi thử lại.';

        set((state) => ({
          isSending: false,
          errorMessage: null,
          sessions: state.sessions.map((s) =>
            s.id === session.id
              ? {
                  ...s,
                  messages: s.messages.map((m) =>
                    m.id === assistantMsgId ? { ...m, content: errReply, state: 'done' as const } : m,
                  ),
                }
              : s,
          ),
        }));
        return true;
      }

      const url = `http://127.0.0.1:${agent.defaultPort}${agent.chatEndpoint}`;

      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: content,
          model: session.model,
          provider: session.provider,
          stream: false,
        }),
        signal: AbortSignal.timeout(60000),
      });

      if (!response.ok) {
        throw new Error(`Agent returned ${response.status}: ${response.statusText}`);
      }

      const data = await response.json();
      const reply = data.reply || data.message || data.content || data.answer || 'No response from agent.';

      set((state) => ({
        isSending: false,
        sessions: state.sessions.map((s) =>
          s.id === session.id
            ? {
                ...s,
                messages: s.messages.map((m) =>
                  m.id === assistantMsgId ? { ...m, content: reply, state: 'done' as const } : m,
                ),
              }
            : s,
        ),
      }));

      return true;
    } catch (error) {
      void error; // External agent unreachable is expected; message handled below.

      // Fallback: this is an external, self-hosted agent. Be honest — Izzi did not
      // install/run it; the user must start it themselves at the expected port.
      const fallbackReply = `⚠️ Chưa kết nối được tới ${agent.displayName} ở 127.0.0.1:${agent.defaultPort}.\n\n${agent.displayName} là agent mã nguồn mở bên ngoài — Izzi không tự cài/chạy nó. Bạn cần tự khởi chạy agent ở máy mình, sau đó mới chat được.\n\n**Cách kiểm tra:**\n1. Đảm bảo ${agent.displayName} đang chạy và lắng nghe ở port ${agent.defaultPort}\n2. Mở lại "${agent.displayName}" trong Agent Hub → bấm "Kiểm tra kết nối"\n3. Xem hướng dẫn cài đặt tại: ${agent.githubUrl}`;

      set((state) => ({
        isSending: false,
        errorMessage: null, // Don't show error banner for expected disconnects
        sessions: state.sessions.map((s) =>
          s.id === session.id
            ? {
                ...s,
                messages: s.messages.map((m) =>
                  m.id === assistantMsgId ? { ...m, content: fallbackReply, state: 'done' as const } : m,
                ),
              }
            : s,
        ),
      }));

      return true;
    }
  },

  newGatewaySession: (agentId) => {
    const { agents } = get();
    const agent = agents.find((a) => a.id === agentId);
    if (!agent) return;

    // Mark old sessions for this agent as inactive
    set((state) => ({
      sessions: state.sessions.map((s) =>
        s.agentId === agentId ? { ...s, isActive: false } : s,
      ),
    }));

    // Create new session
    const newSession: AgentChatSession = {
      id: createLocalId('gw-session'),
      agentId: agent.id,
      agentName: agent.displayName,
      agentIcon: agent.icon,
      messages: [],
      model: 'izzi/auto',
      provider: 'izzi',
      createdAt: new Date().toISOString(),
      isActive: true,
    };

    set((state) => ({
      sessions: [...state.sessions, newSession],
      activeSessionId: newSession.id,
    }));
  },

  setSessionModel: (sessionId, model, provider) => {
    set((state) => ({
      sessions: state.sessions.map((s) =>
        s.id === sessionId ? { ...s, model, provider } : s,
      ),
    }));
  },

  activeSession: () => {
    const { sessions, activeSessionId } = get();
    return sessions.find((s) => s.id === activeSessionId) ?? null;
  },

  getAgentById: (agentId) => {
    return get().agents.find((a) => a.id === agentId);
  },
}));
