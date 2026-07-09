import { create } from 'zustand';
import type {
  AgentMemory,
  AgentRuntimeState,
  AgentStreamEvent,
  AgentTask,
  AgentTaskStatus,
  ChatMessage,
  ChatSession,
  DiagnosticEvent,
  IntegrationConnection,
  IntegrationProvider,
  OnboardingState,
} from '../../main/agent/types';
import type { DesktopUpdaterState } from '../../main/updater/types';
import type { MemoryItemDTO } from '../../shared/graph-types';

function createLocalId(prefix: string): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `${prefix}-${crypto.randomUUID()}`;
  }
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function createFallbackSession(): ChatSession {
  const now = new Date().toISOString();
  return {
    id: createLocalId('session'),
    title: 'Browser preview',
    provider: 'izziapi-managed',
    createdAt: now,
    updatedAt: now,
  };
}

function createIdleState(sessionId?: string): AgentRuntimeState {
  return {
    sessionId,
    state: 'idle',
    updatedAt: new Date().toISOString(),
  };
}

function createUpdaterState(): DesktopUpdaterState {
  return {
    state: 'idle',
  };
}

function upsertById<T extends { id: string }>(currentItems: T[], nextItem: T): T[] {
  const existingIndex = currentItems.findIndex((item) => item.id === nextItem.id);
  if (existingIndex === -1) {
    return [nextItem, ...currentItems];
  }

  const nextItems = [...currentItems];
  nextItems[existingIndex] = nextItem;
  return nextItems;
}

function sortTasks(tasks: AgentTask[]): AgentTask[] {
  return [...tasks].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
}

function sortMemories(memories: AgentMemory[]): AgentMemory[] {
  return [...memories].sort((left, right) => {
    if (left.pinned !== right.pinned) {
      return left.pinned ? -1 : 1;
    }
    return right.updatedAt.localeCompare(left.updatedAt);
  });
}

interface AgentWorkspaceState {
  isBootstrapping: boolean;
  isReady: boolean;
  isSending: boolean;
  errorMessage: string | null;
  session: ChatSession | null;
  messages: ChatMessage[];
  tasks: AgentTask[];
  memories: AgentMemory[];
  /** izzi shared-brain memory (read-only mirror of /aibase/memory). */
  izziMemories: MemoryItemDTO[];
  izziMemoryState: 'idle' | 'loading' | 'ready' | 'signed-out' | 'error';
  runtimeState: AgentRuntimeState;
  diagnostics: DiagnosticEvent[];
  updaterState: DesktopUpdaterState;
  onboardingState: OnboardingState | null;
  isOnboardingOpen: boolean;
  integrations: IntegrationConnection[];
  integrationsLoading: boolean;
  streamAttached: boolean;
  streamUnsubscribe?: () => void;
  updaterAttached: boolean;
  updaterUnsubscribe?: () => void;
  bootstrap: () => Promise<void>;
  ensureStream: () => void;
  ensureUpdaterStream: () => void;
  sendMessage: (text: string) => Promise<boolean>;
  newSession: () => Promise<void>;
  refreshStatus: (sessionId?: string) => Promise<void>;
  refreshTasks: (sessionId?: string) => Promise<void>;
  refreshMemories: (sessionId?: string) => Promise<void>;
  /** Load the izzi shared-brain memory (Phase 1: read-only). */
  refreshIzziMemories: () => Promise<void>;
  refreshDiagnostics: (limit?: number) => Promise<void>;
  refreshUpdaterState: () => Promise<void>;
  checkForUpdates: () => Promise<void>;
  downloadUpdate: () => Promise<void>;
  restartToUpdate: () => Promise<void>;
  updateTaskStatus: (taskId: string, status: AgentTaskStatus) => Promise<void>;
  pinMemory: (memoryId: string, pinned: boolean) => Promise<void>;
  deleteMemory: (memoryId: string) => Promise<void>;
  ensureOnboardingState: () => Promise<OnboardingState | null>;
  ensureOnboardingAutoOpen: () => Promise<void>;
  openOnboarding: () => void;
  closeOnboarding: () => void;
  dismissOnboarding: () => Promise<void>;
  completeOnboarding: () => Promise<void>;
  refreshIntegrations: () => Promise<void>;
  beginConnect: (provider: IntegrationProvider) => Promise<void>;
  disconnectIntegration: (provider: IntegrationProvider) => Promise<void>;
  reset: () => void;
}

export const useAgentWorkspaceStore = create<AgentWorkspaceState>((set, get) => ({
  isBootstrapping: true,
  isReady: false,
  isSending: false,
  errorMessage: null,
  session: null,
  messages: [],
  tasks: [],
  memories: [],
  izziMemories: [],
  izziMemoryState: 'idle',
  runtimeState: createIdleState(),
  diagnostics: [],
  updaterState: createUpdaterState(),
  onboardingState: null,
  isOnboardingOpen: false,
  integrations: [],
  integrationsLoading: false,
  streamAttached: false,
  streamUnsubscribe: undefined,
  updaterAttached: false,
  updaterUnsubscribe: undefined,

  bootstrap: async () => {
    if (!window.electronAPI?.agent) {
      const fallbackSession = createFallbackSession();
      set({
        isBootstrapping: false,
        isReady: true,
        session: fallbackSession,
        messages: [],
        tasks: [],
        memories: [],
        diagnostics: [],
        runtimeState: createIdleState(fallbackSession.id),
      });
      return;
    }

    set({ isBootstrapping: true, errorMessage: null });

    try {
      const [payload, tasks, memories, diagnostics, updaterState] = await Promise.all([
        window.electronAPI.agent.bootstrap(),
        window.electronAPI.agent.listTasks(),
        window.electronAPI.agent.listMemories(),
        window.electronAPI.agent.getDiagnostics(50),
        window.electronAPI.updater?.getState?.() ?? Promise.resolve(createUpdaterState()),
      ]);

      let activeSession = payload.session;
      if (!activeSession) {
        activeSession = await window.electronAPI.agent.newSession();
      }

      set({
        isBootstrapping: false,
        isReady: true,
        session: activeSession,
        messages: payload.session ? payload.messages : [],
        tasks: sortTasks(tasks),
        memories: sortMemories(memories),
        diagnostics,
        updaterState,
        runtimeState: payload.session ? payload.state : createIdleState(activeSession.id),
        isSending: payload.state.state === 'connecting' || payload.state.state === 'running',
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to bootstrap workspace';
      set({
        isBootstrapping: false,
        isReady: false,
        isSending: false,
        errorMessage: message,
        runtimeState: {
          state: 'error',
          lastError: message,
          updatedAt: new Date().toISOString(),
        },
      });
    }
  },

  ensureStream: () => {
    if (get().streamAttached || !window.electronAPI?.agent) {
      return;
    }

    const unsubscribe = window.electronAPI.agent.onStream((event: AgentStreamEvent) => {
      const { session } = get();
      if (!session || event.sessionId !== session.id) {
        if (event.type === 'task_upsert' && event.task) {
          set((state) => ({ tasks: sortTasks(upsertById(state.tasks, event.task!)) }));
        }
        if (event.type === 'memory_upsert' && event.memory) {
          set((state) => ({ memories: sortMemories(upsertById(state.memories, event.memory!)) }));
        }
        return;
      }

      if (event.type === 'status') {
        set({
          runtimeState: {
            sessionId: event.sessionId,
            state: event.state ?? 'idle',
            lastError: event.error,
            updatedAt: new Date().toISOString(),
          },
          isSending: event.state === 'connecting' || event.state === 'running',
        });
        return;
      }

      if (event.type === 'assistant_delta') {
        set((state) => ({
          messages: state.messages.map((message) =>
            message.id === event.messageId
              ? {
                  ...message,
                  content: `${message.content}${event.delta ?? ''}`,
                  state: 'streaming',
                }
              : message,
          ),
          isSending: true,
        }));
        return;
      }

      if (event.type === 'assistant_done') {
        set((state) => ({
          messages: state.messages.map((message) =>
            message.id === event.messageId
              ? {
                  ...message,
                  state: 'done',
                }
              : message,
          ),
          isSending: false,
        }));
        return;
      }

      if (event.type === 'task_upsert' && event.task) {
        set((state) => ({ tasks: sortTasks(upsertById(state.tasks, event.task!)) }));
        return;
      }

      if (event.type === 'memory_upsert' && event.memory) {
        set((state) => ({ memories: sortMemories(upsertById(state.memories, event.memory!)) }));
        return;
      }

      if (event.type === 'error') {
        set((state) => ({
          messages: state.messages.map((message) =>
            message.id === event.messageId
              ? {
                  ...message,
                  state: 'error',
                }
              : message,
          ),
          isSending: false,
          errorMessage: event.error || 'Agent stream failed',
          runtimeState: {
            sessionId: event.sessionId,
            state: 'error',
            lastError: event.error || 'Agent stream failed',
            updatedAt: new Date().toISOString(),
          },
        }));
      }
    });

    set({
      streamAttached: true,
      streamUnsubscribe: unsubscribe,
    });
  },

  ensureUpdaterStream: () => {
    if (get().updaterAttached || !window.electronAPI?.updater) {
      return;
    }

    const unsubscribe = window.electronAPI.updater.onState((updaterState: DesktopUpdaterState) => {
      set({ updaterState });
    });

    set({
      updaterAttached: true,
      updaterUnsubscribe: unsubscribe,
    });
  },

  sendMessage: async (text: string) => {
    const content = text.trim();
    if (!content || get().isSending) {
      return false;
    }

    const activeSession = get().session ?? createFallbackSession();

    if (!window.electronAPI?.agent) {
      const requestId = createLocalId('req');
      const createdAt = new Date().toISOString();
      const assistantMessageId = createLocalId('assistant');

      set((state) => ({
        session: activeSession,
        messages: [
          ...state.messages,
          {
            id: createLocalId('user'),
            sessionId: activeSession.id,
            role: 'user',
            content,
            state: 'done',
            createdAt,
            requestId,
          },
          {
            id: assistantMessageId,
            sessionId: activeSession.id,
            role: 'assistant',
            content: '',
            state: 'streaming',
            createdAt,
            requestId,
          },
        ],
        isSending: true,
        runtimeState: {
          sessionId: activeSession.id,
          state: 'running',
          updatedAt: createdAt,
        },
      }));

      window.setTimeout(() => {
        set((state) => ({
          messages: state.messages.map((message) =>
            message.id === assistantMessageId
              ? {
                  ...message,
                  content:
                    'Agent runtime chi hoat dong day du trong Electron app. Day la browser preview de test giao dien chat.',
                  state: 'done',
                }
              : message,
          ),
          isSending: false,
          runtimeState: createIdleState(activeSession.id),
        }));
      }, 700);
      return true;
    }

    set({ errorMessage: null });

    try {
      const session = get().session ?? (await window.electronAPI.agent.newSession());
      const result = await window.electronAPI.agent.sendMessage(session.id, content);
      const createdAt = new Date().toISOString();

      set((state) => ({
        session,
        messages: [
          ...state.messages,
          {
            id: result.userMessageId,
            sessionId: session.id,
            role: 'user',
            content,
            state: 'done',
            createdAt,
            requestId: result.requestId,
          },
          {
            id: result.assistantMessageId,
            sessionId: session.id,
            role: 'assistant',
            content: '',
            state: 'streaming',
            createdAt,
            requestId: result.requestId,
          },
        ],
        isSending: true,
        runtimeState: {
          sessionId: session.id,
          state: 'connecting',
          updatedAt: createdAt,
        },
      }));
      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to send message';
      set((state) => ({
        errorMessage: message,
        isSending: false,
        runtimeState: {
          sessionId: state.session?.id,
          state: 'error',
          lastError: message,
          updatedAt: new Date().toISOString(),
        },
      }));
      return false;
    }
  },

  newSession: async () => {
    if (!window.electronAPI?.agent) {
      const fallbackSession = createFallbackSession();
      set({
        session: fallbackSession,
        messages: [],
        errorMessage: null,
        runtimeState: createIdleState(fallbackSession.id),
      });
      return;
    }

    const nextSession = await window.electronAPI.agent.newSession();
    set({
      session: nextSession,
      messages: [],
      errorMessage: null,
      runtimeState: createIdleState(nextSession.id),
    });
  },

  refreshStatus: async (sessionId?: string) => {
    if (!window.electronAPI?.agent) return;
    const status = await window.electronAPI.agent.getStatus(sessionId);
    set({ runtimeState: status });
  },

  refreshTasks: async (sessionId?: string) => {
    if (!window.electronAPI?.agent) return;
    const tasks = await window.electronAPI.agent.listTasks(sessionId);
    set({ tasks: sortTasks(tasks) });
  },

  refreshMemories: async (sessionId?: string) => {
    if (!window.electronAPI?.agent) return;
    const memories = await window.electronAPI.agent.listMemories(sessionId);
    set({ memories: sortMemories(memories) });
  },
  refreshIzziMemories: async () => {
    const api = window.electronAPI;
    // Feature-detect: no bridge → treat as signed-out (can't reach the izzi brain).
    if (!api?.memory?.list || !api?.auth?.isAuthenticated) {
      set({ izziMemories: [], izziMemoryState: 'signed-out' });
      return;
    }
    set({ izziMemoryState: 'loading' });
    try {
      // Distinguish signed-out vs empty vs error from AUTH, not from an empty
      // array (listMemory fail-closes to [] on no-auth/error) — Socrates gate.
      const authed = await api.auth.isAuthenticated();
      if (!authed) {
        set({ izziMemories: [], izziMemoryState: 'signed-out' });
        return;
      }
      const items = await api.memory.list('', 100);
      set({ izziMemories: Array.isArray(items) ? items : [], izziMemoryState: 'ready' });
    } catch {
      set({ izziMemoryState: 'error' });
    }
  },

  refreshDiagnostics: async (limit = 50) => {
    if (!window.electronAPI?.agent) return;
    const diagnostics = await window.electronAPI.agent.getDiagnostics(limit);
    set({ diagnostics });
  },

  refreshUpdaterState: async () => {
    if (!window.electronAPI?.updater) return;
    const updaterState = await window.electronAPI.updater.getState();
    set({ updaterState });
  },

  checkForUpdates: async () => {
    if (!window.electronAPI?.updater) return;
    const updaterState = await window.electronAPI.updater.check();
    set({ updaterState });
  },

  downloadUpdate: async () => {
    if (!window.electronAPI?.updater) return;
    const updaterState = await window.electronAPI.updater.download();
    set({ updaterState });
  },

  restartToUpdate: async () => {
    if (!window.electronAPI?.updater) return;
    await window.electronAPI.updater.quitAndInstall();
  },

  updateTaskStatus: async (taskId: string, status: AgentTaskStatus) => {
    if (!window.electronAPI?.agent) return;
    const task = await window.electronAPI.agent.updateTaskStatus(taskId, status);
    if (task) {
      set((state) => ({ tasks: sortTasks(upsertById(state.tasks, task)) }));
    }
  },

  pinMemory: async (memoryId: string, pinned: boolean) => {
    if (!window.electronAPI?.agent) return;
    const memory = await window.electronAPI.agent.pinMemory(memoryId, pinned);
    if (memory) {
      set((state) => ({ memories: sortMemories(upsertById(state.memories, memory)) }));
    }
  },

  deleteMemory: async (memoryId: string) => {
    if (!window.electronAPI?.agent) return;
    await window.electronAPI.agent.deleteMemory(memoryId);
    set((state) => ({ memories: state.memories.filter((memory) => memory.id !== memoryId) }));
  },

  ensureOnboardingState: async () => {
    if (!window.electronAPI?.onboarding) {
      return null;
    }
    const onboardingState = await window.electronAPI.onboarding.getState();
    set({ onboardingState });
    return onboardingState;
  },

  ensureOnboardingAutoOpen: async () => {
    if (!window.electronAPI?.onboarding) return;
    const onboardingState = await window.electronAPI.onboarding.getState();

    if (onboardingState.shouldAutoOpen) {
      const seenState = await window.electronAPI.onboarding.markSeen();
      set({
        onboardingState: seenState,
        isOnboardingOpen: true,
      });
      return;
    }

    set({ onboardingState });
  },

  openOnboarding: () => {
    set({ isOnboardingOpen: true });
  },

  closeOnboarding: () => {
    set({ isOnboardingOpen: false });
  },

  dismissOnboarding: async () => {
    if (!window.electronAPI?.onboarding) return;
    const onboardingState = await window.electronAPI.onboarding.dismiss();
    set({
      onboardingState,
      isOnboardingOpen: false,
    });
  },

  completeOnboarding: async () => {
    if (!window.electronAPI?.onboarding) return;
    const onboardingState = await window.electronAPI.onboarding.complete();
    set({
      onboardingState,
      isOnboardingOpen: false,
    });
  },

  refreshIntegrations: async () => {
    if (!window.electronAPI?.integrations) return;
    set({ integrationsLoading: true });
    try {
      const integrations = await window.electronAPI.integrations.list();
      set({ integrations, integrationsLoading: false });
    } catch {
      set({ integrationsLoading: false });
    }
  },

  beginConnect: async (provider: IntegrationProvider) => {
    if (!window.electronAPI?.integrations) return;
    set({ integrationsLoading: true });
    try {
      await window.electronAPI.integrations.beginConnect(provider);
    } finally {
      set({ integrationsLoading: false });
    }
  },

  disconnectIntegration: async (provider: IntegrationProvider) => {
    if (!window.electronAPI?.integrations) return;
    set({ integrationsLoading: true });
    try {
      const integrations = await window.electronAPI.integrations.disconnect(provider);
      set({ integrations, integrationsLoading: false });
    } catch {
      set({ integrationsLoading: false });
    }
  },

  reset: () => {
    get().streamUnsubscribe?.();
    get().updaterUnsubscribe?.();
    set({
      isBootstrapping: true,
      isReady: false,
      isSending: false,
      errorMessage: null,
      session: null,
      messages: [],
      tasks: [],
      memories: [],
      runtimeState: createIdleState(),
      diagnostics: [],
      updaterState: createUpdaterState(),
      onboardingState: null,
      isOnboardingOpen: false,
      integrations: [],
      integrationsLoading: false,
      streamAttached: false,
      streamUnsubscribe: undefined,
      updaterAttached: false,
      updaterUnsubscribe: undefined,
    });
  },
}));
