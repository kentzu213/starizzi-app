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
import { connectionActionForProvider, deriveEndpointLabel } from '../types/model-catalog';
import type { AgentTurnEvent } from '../../shared/agent-turn-events';
import { sanitizeStoredSessions, capForPersist, pickActiveId } from './gatewayPersist';
import { shouldUseIzziApiRoute } from './agentGateway-routing';

interface GatewayPersistApi {
  list?: () => Promise<unknown[]>;
  save?: (session: unknown) => Promise<unknown>;
  delete?: (id: string) => Promise<unknown>;
}

/** Access the main-process gateway persistence bridge (absent in browser dev). */
function gatewayPersistApi(): GatewayPersistApi | undefined {
  if (typeof window === 'undefined') return undefined;
  return (window as unknown as { electronAPI?: { gatewaySessions?: GatewayPersistApi } }).electronAPI
    ?.gatewaySessions;
}

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
  /** turnId of the in-flight agent turn — powers the Stop button + mid-turn steering. */
  currentTurnId: string | null;
  /** Composer draft + attachments — kept in the store so they survive tab switches. */
  composerDraft: string;
  composerImages: string[];
  errorMessage: string | null;
  /** Session id currently being reconfigured (e.g. reasoning effort → container restart). */
  reconfiguringSessionId: string | null;

  /** True once chat history has been restored from disk (guards a double-load). */
  hydrated: boolean;

  /** Models discovered live from the enabled custom connection (codex-lb /v1/models). */
  availableModels: string[];
  availableModelsState: 'idle' | 'loading' | 'ok' | 'error';
  /** Human label for the local model group, derived from the connection base URL. */
  availableModelsLabel: string;

  // Actions — Agent management
  updateAgentStatus: (agentId: string, status: ExternalAgentStatus, version?: string) => void;
  refreshAgentStatuses: () => Promise<void>;

  /** Restore persisted chat sessions from the main-process store (once). */
  hydrateFromDisk: () => Promise<void>;

  /** Apply a live turn event (content/reasoning/step) to its assistant message. */
  applyStreamEvent: (event: AgentTurnEvent) => void;

  // Actions — Chat gateway
  openAgentChat: (agentId: string) => void;
  closeAgentChat: (sessionId: string) => void;
  switchSession: (sessionId: string) => void;
  sendGatewayMessage: (text: string, images?: string[]) => Promise<boolean>;
  /** Stop the in-flight agent turn (Stop button) — keeps the partial answer. */
  abortGateway: () => Promise<void>;
  /** Inject a steering message into the running agent turn (adjust mid-work). */
  injectGateway: (text: string) => Promise<boolean>;
  /** Composer draft setters (persisted state above). */
  setComposerDraft: (value: string) => void;
  setComposerImages: (value: string[] | ((prev: string[]) => string[])) => void;
  newGatewaySession: (agentId: string) => void;
  setSessionModel: (sessionId: string, model: string, provider: AIProvider) => void;
  /** Refresh the live model list from the enabled custom connection (/v1/models). */
  refreshAvailableModels: () => Promise<void>;
  /**
   * Pick the active model: a 'custom' (codex-lb/local) model points+enables the
   * custom connection at it; an 'izzi' model disables it so generic agents use
   * izzi. Also reflects the pick on the active session. izzi persona agents route
   * izzi regardless (handled by sendGatewayMessage).
   */
  setActiveModel: (model: string, provider: AIProvider) => Promise<void>;
  /** Change a Docker agent's reasoning effort (rewrites config + restarts container). */
  setReasoningEffort: (effort: string) => Promise<boolean>;

  // Getters
  activeSession: () => AgentChatSession | null;
  getAgentById: (agentId: string) => ExternalAgent | undefined;
}

export const useAgentGatewayStore = create<AgentGatewayState>((set, get) => ({
  agents: TOP_AGENTS.map((agent) => ({ ...agent })),
  sessions: [],
  activeSessionId: null,
  isSending: false,
  currentTurnId: null,
  composerDraft: '',
  composerImages: [],
  errorMessage: null,
  reconfiguringSessionId: null,
  hydrated: false,
  availableModels: [],
  availableModelsState: 'idle',
  availableModelsLabel: 'codex-lb (local)',

  hydrateFromDisk: async () => {
    if (get().hydrated) return;
    const api = gatewayPersistApi();
    if (!api?.list) {
      set({ hydrated: true });
      return;
    }
    try {
      const raw = await api.list();
      const restored = sanitizeStoredSessions(raw);
      // Don't clobber sessions the user already opened this launch.
      if (restored.length > 0 && get().sessions.length === 0) {
        set({ sessions: restored, activeSessionId: pickActiveId(restored), hydrated: true });
      } else {
        set({ hydrated: true });
      }
    } catch {
      set({ hydrated: true });
    }
  },

  updateAgentStatus: (agentId, status, version) => {
    set((state) => ({
      agents: state.agents.map((a) =>
        a.id === agentId ? { ...a, status, version: version ?? a.version } : a,
      ),
    }));
  },

  refreshAgentStatuses: async () => {
    // Sync from the MAIN process (`docker ps` by container name) — reliable and
    // CORS-free. A renderer fetch to the agent's health endpoint is unreliable:
    // the store resets to 'not-installed' on every launch, and some agents (e.g.
    // Hermes' aiohttp server) reject browser-origin requests with 403 — so a
    // running agent would keep showing "Not Installed". `docker ps` sees the truth.
    const dockerApi = (typeof window !== 'undefined'
      ? (window as unknown as { electronAPI?: { dockerAgent?: { status?: (p: { id: string; defaultPort: number }) => Promise<{ running: boolean; installed?: boolean }> } } }).electronAPI?.dockerAgent
      : undefined);
    if (!dockerApi?.status) return; // no bridge (browser dev) — nothing to sync

    for (const agent of get().agents) {
      if (agent.runtime === 'izzi') continue; // izzi-native agents have no container
      if (agent.setupMethod !== 'docker') continue; // only docker agents have containers
      if (agent.status === 'installing') continue; // don't clobber an in-progress install

      try {
        const res = await dockerApi.status({ id: agent.id, defaultPort: agent.defaultPort });
        const running = !!res?.running;
        const installed = !!res?.installed;
        set((state) => ({
          agents: state.agents.map((a) => {
            if (a.id !== agent.id) return a;
            if (running) return { ...a, status: 'running' };
            // A container that exists but isn't running is INSTALLED + stopped
            // (e.g. Hermes crashed/exited) — show 'stopped', not 'not-installed'.
            if (installed) return { ...a, status: 'stopped' };
            // Truly absent: only downgrade a previously-'running' badge.
            if (a.status === 'running') return { ...a, status: 'stopped' };
            return a;
          }),
        }));
      } catch {
        // best-effort — leave the current status untouched
      }
    }
  },

  applyStreamEvent: (event) => {
    set((state) => ({
      sessions: state.sessions.map((s) => {
        if (!s.messages.some((m) => m.id === event.turnId)) return s;
        return {
          ...s,
          messages: s.messages.map((m) => {
            if (m.id !== event.turnId) return m;
            if (event.kind === 'delta') {
              return { ...m, content: m.content + event.text, state: 'streaming' as const };
            }
            if (event.kind === 'reasoning') {
              return { ...m, reasoning: (m.reasoning ?? '') + event.text, state: 'streaming' as const };
            }
            if (event.kind === 'step') {
              const steps = Array.isArray(m.steps) ? [...m.steps] : [];
              const idx = steps.findIndex((x) => x.id === event.step.id);
              if (idx >= 0) steps[idx] = event.step;
              else steps.push(event.step);
              return { ...m, steps, state: 'streaming' as const };
            }
            return m;
          }),
        };
      }),
    }));
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
      model: agent.id === 'hermes' ? 'gpt-5.5' : 'izzi-smart',
      provider: agent.id === 'hermes' ? 'custom' : 'izzi',
      reasoningEffort: agent.id === 'hermes' ? 'xhigh' : undefined,
      createdAt: new Date().toISOString(),
      isActive: true,
    };

    set((state) => ({
      sessions: [...state.sessions, newSession],
      activeSessionId: newSession.id,
    }));
  },

  closeAgentChat: (sessionId) => {
    // Drop the persisted copy too, so a closed tab doesn't come back on restart.
    void gatewayPersistApi()?.delete?.(sessionId);
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

  abortGateway: async () => {
    const turnId = get().currentTurnId;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const api = (window as any).electronAPI?.customProvider;
    if (turnId && api?.abort) {
      try {
        await api.abort(turnId);
      } catch {
        /* best-effort — the turn will still finish on its own */
      }
    }
  },

  injectGateway: async (text) => {
    const t = text.trim();
    const turnId = get().currentTurnId;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const api = (window as any).electronAPI?.customProvider;
    if (!t || !turnId || !api?.inject) return false;
    const session = get().activeSession();
    // Show the steering note in the thread (just above the in-progress reply).
    if (session) {
      const noteId = createLocalId('gw-user');
      set((state) => ({
        sessions: state.sessions.map((s) =>
          s.id === session.id
            ? {
                ...s,
                messages: [
                  ...s.messages.slice(0, -1),
                  {
                    id: noteId,
                    sessionId: session.id,
                    agentId: session.agentId,
                    role: 'user' as const,
                    content: t,
                    state: 'done' as const,
                    model: session.model,
                    createdAt: new Date().toISOString(),
                  },
                  ...s.messages.slice(-1),
                ],
              }
            : s,
        ),
      }));
    }
    try {
      const r = await api.inject(turnId, t);
      return !!r?.ok;
    } catch {
      return false;
    }
  },

  setComposerDraft: (value) => set({ composerDraft: value }),
  setComposerImages: (value) =>
    set((state) => ({
      composerImages: typeof value === 'function' ? value(state.composerImages) : value,
    })),

  sendGatewayMessage: async (text, images) => {
    const content = text.trim();
    // Accept base64 image data URLs only; an image-only message (no text) is allowed.
    const imgs = Array.isArray(images)
      ? images.filter((u) => typeof u === 'string' && u.startsWith('data:image/'))
      : [];
    if ((!content && imgs.length === 0) || get().isSending) return false;

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
      images: imgs.length > 0 ? imgs : undefined,
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
      currentTurnId: assistantMsgId,
      errorMessage: null,
      sessions: state.sessions.map((s) =>
        s.id === session.id
          ? { ...s, messages: [...s.messages, userMessage, assistantMessage] }
          : s,
      ),
    }));

    // Try to call agent's chat API
    try {
      // Izzi-native personas and any agent whose selected model belongs to Izzi
      // run through the MAIN-process Izzi API bridge. This makes SmartRouter plus
      // direct Grok/Sol selection work consistently while the credential stays
      // out of the renderer.
      if (shouldUseIzziApiRoute(agent.runtime, session.provider)) {
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
            // Let izzi persona agents invoke installed utility commands (e.g. Social Auto Poster).
            enableTools: true,
            // Stream the process (tool steps) + capture the session into my-graph.
            turnId: assistantMsgId,
            agentId: session.agentId,
            agentName: agent.displayName,
            images: imgs,
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

      // Direct model connection (codex-lb / 9router / any OpenAI-compatible):
      // if the user configured + enabled a connection in the "Kết nối Model" tab,
      // route non-izzi agents through it (main process → the endpoint) instead of
      // the local Docker container. This is the "connect the app to codex-lb" path.
      const customApi = (window as any).electronAPI?.customProvider;
      if (agent.runtime !== 'izzi' && customApi?.chat && customApi?.getConfig) {
        let connEnabled = false;
        try {
          const c = await customApi.getConfig();
          connEnabled = !!(c?.enabled && c?.hasKey);
        } catch {
          /* no bridge / not configured — fall through to the container path */
        }
        if (connEnabled) {
          const history = session.messages
            .filter((m) => m.state === 'done' && m.content)
            .slice(-8)
            .map((m) => ({ role: m.role, content: m.content }));
          const r = await customApi.chat({ message: content, history, turnId: assistantMsgId, images: imgs });
          if (r?.reply) {
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
                              content: m.content && m.content.length > 0 ? m.content : (r.reply as string),
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
          const err = String(r?.error ?? 'không rõ');
          if (err === 'aborted') {
            // Stopped by the user — keep whatever streamed so far, mark it done.
            set((state) => ({
              isSending: false,
              currentTurnId: null,
              sessions: state.sessions.map((s) =>
                s.id === session.id
                  ? {
                      ...s,
                      messages: s.messages.map((m) =>
                        m.id === assistantMsgId
                          ? {
                              ...m,
                              content:
                                (m.content && m.content.trim().length > 0 ? m.content + '\n\n' : '') + '⏹️ Đã dừng.',
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
          const connMsg =
            err === 'not-configured' || err === 'disabled'
              ? '⚠️ Chưa cấu hình kết nối model. Mở tab "Kết nối Model" để nối codex-lb / 9router rồi thử lại.'
              : /econnrefused|econnreset|\bconnect\b|fetch|time|unreachable|network|endpoint/i.test(err)
                ? `⚠️ Không kết nối được endpoint model.\n\n**Lỗi:** ${err}\n\n` +
                  'Kiểm tra codex-lb / 9router đang chạy đúng cổng, hoặc chỉnh lại trong tab "Kết nối Model".'
                : `⚠️ Model chưa trả lời được.\n\n**Lỗi:** ${err}`;
          set((state) => ({
            isSending: false,
            sessions: state.sessions.map((s) =>
              s.id === session.id
                ? {
                    ...s,
                    messages: s.messages.map((m) =>
                      m.id === assistantMsgId ? { ...m, content: connMsg, state: 'done' as const } : m,
                    ),
                  }
                : s,
            ),
          }));
          return true;
        }
      }

      // Docker agents with an OpenAI-compatible endpoint (e.g. Hermes) route
      // through the main process via IPC — the API key stays in main and is
      // never exposed to the renderer.
      const dockerAgentApi = (window as any).electronAPI?.dockerAgent;
      const isOpenAiCompatible =
        agent.setupMethod === 'docker' && agent.chatEndpoint === '/v1/chat/completions';

      if (isOpenAiCompatible && dockerAgentApi?.chat) {
        // Patch just this turn's assistant message (used for startup status notes).
        const patchAssistant = (patch: Partial<GatewayChatMessage>) =>
          set((state) => ({
            sessions: state.sessions.map((s) =>
              s.id === session.id
                ? {
                    ...s,
                    messages: s.messages.map((m) =>
                      m.id === assistantMsgId ? { ...m, ...patch } : m,
                    ),
                  }
                : s,
            ),
          }));

        // A stopped container is the usual "can't chat / ECONNREFUSED" cause — try
        // to (re)start it before sending so the user doesn't hit a dead connection.
        const dockerMeta = {
          id: agent.id,
          defaultPort: agent.defaultPort,
          dockerImage: agent.dockerImage,
          dockerComposeUrl: agent.dockerComposeUrl,
        };
        try {
          const st = await dockerAgentApi.status?.(dockerMeta);
          if (st && st.running === false) {
            patchAssistant({
              content: `🚀 Đang khởi động ${agent.displayName}… (lần đầu có thể mất ~30–60s)`,
            });
            const started = await dockerAgentApi.start?.(dockerMeta);
            if (!started?.ok) {
              const why = started?.error ? `\n\n**Chi tiết:** ${started.error}` : '';
              patchAssistant({
                content:
                  `⚠️ Chưa khởi động được ${agent.displayName}.${why}\n\n` +
                  'Kiểm tra Docker đang chạy, hoặc mở Agent Hub để cài/chạy lại agent rồi thử lại.',
                state: 'done',
              });
              set({ isSending: false });
              return true;
            }
            get().updateAgentStatus(agent.id, 'running');
            // Wait for /health before sending (the container needs a beat to listen).
            if (dockerAgentApi.healthCheck) {
              for (let i = 0; i < 20; i++) {
                try {
                  const h = await dockerAgentApi.healthCheck({
                    defaultPort: agent.defaultPort,
                    healthEndpoint: agent.healthEndpoint,
                    timeoutMs: 4000,
                  });
                  if (h?.ok) break;
                } catch {
                  /* keep polling */
                }
                await new Promise((res) => setTimeout(res, 2000));
              }
            }
            patchAssistant({ content: '' }); // clear the note so the reply stream fills the bubble
          }
        } catch {
          // status/start bridge unavailable (e.g. Docker CLI missing) — fall through;
          // the chat call below surfaces the concrete error.
        }

        const r = await dockerAgentApi.chat(
          {
            id: agent.id,
            defaultPort: agent.defaultPort,
            agentName: agent.displayName,
            reasoningEffort: session.reasoningEffort,
            // Stream the live process (Hermes emits tool progress as content) + capture to my-graph.
            turnId: assistantMsgId,
            images: imgs,
          },
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
                        ? {
                            ...m,
                            // Keep the text already streamed in; fall back to the full reply.
                            content: m.content && m.content.length > 0 ? m.content : (r.reply as string),
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

        // Honest error from the agent/provider (no fallback simulation).
        const rawErr = String(r.error ?? 'không rõ');
        const isConnErr = /econnrefused|econnreset|\bconnect\b|fetch failed|socket hang up|network|timed? ?out/i.test(rawErr);
        // Empty reply = the container ran but has no model behind it (upstream not
        // configured). The real fix is wiring a model in the "Kết nối Model" tab.
        const isEmptyReply = /rỗng|empty|chưa cấu hình model|provider/i.test(rawErr);
        const errReply = isConnErr
          ? `⚠️ ${agent.displayName} chưa kết nối được (agent chưa chạy hoặc đang khởi động).\n\n**Lỗi:** ${rawErr}\n\n` +
            'Thử gửi lại sau vài giây (agent có thể đang khởi động), hoặc mở Agent Hub → chạy lại agent. ' +
            'Đảm bảo Docker đang chạy.'
          : isEmptyReply
            ? `⚠️ ${agent.displayName} trả về phản hồi rỗng (chưa có model phía sau).\n\n**Lỗi:** ${rawErr}\n\n` +
              'Cách khắc phục nhanh: mở tab **"Kết nối Model"** ở thanh bên → nối **codex-lb** (hoặc 9router) → **Lưu & Bật**, ' +
              'rồi chat lại. Khi đã bật, mọi agent sẽ chat qua model đó.'
            : `⚠️ ${agent.displayName} chưa trả lời được.\n\n**Lỗi:** ${rawErr}\n\n` +
              'Thử mở tab "Kết nối Model" để nối codex-lb / 9router, hoặc cấu hình model provider rồi thử lại.';

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
      model: agent.id === 'hermes' ? 'gpt-5.5' : 'izzi-smart',
      provider: agent.id === 'hermes' ? 'custom' : 'izzi',
      reasoningEffort: agent.id === 'hermes' ? 'xhigh' : undefined,
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

  refreshAvailableModels: async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const api = (window as any).electronAPI?.customProvider;
    if (!api?.listModels) {
      set({ availableModels: [], availableModelsState: 'error' });
      return;
    }
    set({ availableModelsState: 'loading' });
    try {
      const [r, c] = await Promise.all([
        api.listModels(),
        api.getConfig ? api.getConfig() : Promise.resolve(null),
      ]);
      const label = deriveEndpointLabel(c?.config?.baseUrl);
      if (r?.ok && Array.isArray(r.models)) {
        set({ availableModels: r.models as string[], availableModelsLabel: label, availableModelsState: 'ok' });
      } else {
        set({ availableModels: [], availableModelsLabel: label, availableModelsState: 'error' });
      }
    } catch {
      set({ availableModels: [], availableModelsState: 'error' });
    }
  },

  setActiveModel: async (model, provider) => {
    const session = get().activeSession();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const api = (window as any).electronAPI?.customProvider;
    const action = connectionActionForProvider(provider);
    try {
      if (action === 'enable-custom' && api?.getConfig && api?.saveConfig) {
        // Point the single custom connection at this model + enable it, so generic
        // agents call exactly it (config.selectedModel is what the endpoint receives).
        const c = await api.getConfig();
        const baseUrl = c?.config?.baseUrl || 'http://127.0.0.1:2455/v1';
        const authType = c?.config?.authType || 'bearer';
        await api.saveConfig({ baseUrl, authType, selectedModel: model });
        await api.setEnabled?.(true);
      } else if (action === 'disable-custom' && api?.setEnabled) {
        // An Izzi-hosted model was picked (SmartRouter, Grok, or Sol): turn the
        // custom connection off. sendGatewayMessage then uses the authenticated
        // main-process Izzi bridge for both native and generic agents.
        await api.setEnabled(false);
      }
    } catch {
      /* best-effort: still reflect the pick on the session below */
    }
    if (session) {
      set((state) => ({
        sessions: state.sessions.map((s) =>
          s.id === session.id ? { ...s, model, provider } : s,
        ),
      }));
    }
  },

  setReasoningEffort: async (effort) => {
    const session = get().activeSession();
    if (!session) return false;
    const agent = get().agents.find((a) => a.id === session.agentId);
    if (!agent || agent.setupMethod !== 'docker') return false;
    if (session.reasoningEffort === effort) return true; // no-op

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const dockerApi = (window as any).electronAPI?.dockerAgent;
    if (!dockerApi?.setReasoningEffort) {
      set({ errorMessage: 'Không đổi được mức reasoning (thiếu cầu nối app).' });
      return false;
    }

    set({ reconfiguringSessionId: session.id, errorMessage: null });
    try {
      const r = await dockerApi.setReasoningEffort(
        { id: agent.id, defaultPort: agent.defaultPort },
        effort,
      );
      if (!r?.ok) {
        set({ reconfiguringSessionId: null, errorMessage: r?.error ?? 'Không đổi được mức reasoning.' });
        return false;
      }

      // The container was restarted — wait for /health before re-enabling chat.
      if (dockerApi.healthCheck) {
        for (let i = 0; i < 20; i++) {
          try {
            const h = await dockerApi.healthCheck({
              defaultPort: agent.defaultPort,
              healthEndpoint: agent.healthEndpoint,
              timeoutMs: 4000,
            });
            if (h?.ok) break;
          } catch {
            /* keep polling */
          }
          await new Promise((res) => setTimeout(res, 3000));
        }
      }

      set((state) => ({
        reconfiguringSessionId: null,
        sessions: state.sessions.map((s) =>
          s.id === session.id ? { ...s, reasoningEffort: effort } : s,
        ),
      }));
      return true;
    } catch {
      set({ reconfiguringSessionId: null, errorMessage: 'Không đổi được mức reasoning.' });
      return false;
    }
  },

  activeSession: () => {
    const { sessions, activeSessionId } = get();
    return sessions.find((s) => s.id === activeSessionId) ?? null;
  },

  getAgentById: (agentId) => {
    return get().agents.find((a) => a.id === agentId);
  },
}));

// Subscribe once to the live agent "process" stream (main → renderer) and route
// each event to the matching assistant message. Guarded for the browser-dev case
// where the Electron bridge is absent.
if (typeof window !== 'undefined') {
  const streamApi = (
    window as unknown as {
      electronAPI?: { agentStream?: { onEvent?: (cb: (evt: AgentTurnEvent) => void) => void } };
    }
  ).electronAPI?.agentStream;
  streamApi?.onEvent?.((evt) => {
    useAgentGatewayStore.getState().applyStreamEvent(evt);
  });

  // Restore chat history once on load (survives app restart)...
  void useAgentGatewayStore.getState().hydrateFromDisk();

  // ...and persist sessions (debounced) whenever they change, so history is durable.
  let persistTimer: ReturnType<typeof setTimeout> | undefined;
  useAgentGatewayStore.subscribe((state, prev) => {
    if (state.sessions === prev.sessions) return;
    if (persistTimer) clearTimeout(persistTimer);
    persistTimer = setTimeout(() => {
      const api = gatewayPersistApi();
      if (!api?.save) return;
      for (const s of capForPersist(useAgentGatewayStore.getState().sessions)) void api.save(s);
    }, 700);
  });
}
