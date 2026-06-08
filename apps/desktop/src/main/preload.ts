import { contextBridge, ipcRenderer } from 'electron';
import type {
  AgentBootstrapPayload,
  AgentMemory,
  AgentRuntimeState,
  AgentSendMessageResult,
  AgentStreamEvent,
  AgentTask,
  AgentTaskStatus,
  ChatSession,
  DiagnosticEvent,
  IntegrationConnection,
  IntegrationProvider,
  OnboardingState,
} from './agent/types';
import type { DesktopUpdaterState } from './updater/types';

const electronAPI = {
  window: {
    minimize: () => ipcRenderer.invoke('window:minimize'),
    maximize: () => ipcRenderer.invoke('window:maximize'),
    close: () => ipcRenderer.invoke('window:close'),
    isMaximized: () => ipcRenderer.invoke('window:isMaximized'),
  },

  auth: {
    login: (credentials: { email: string; password: string }) =>
      ipcRenderer.invoke('auth:login', credentials),
    loginWithGoogle: () => ipcRenderer.invoke('auth:loginWithGoogle'),
    signup: (data: { email: string; password: string; name: string }) =>
      ipcRenderer.invoke('auth:signup', data),
    logout: () => ipcRenderer.invoke('auth:logout'),
    getUser: () => ipcRenderer.invoke('auth:getUser'),
    isAuthenticated: () => ipcRenderer.invoke('auth:isAuthenticated'),
    getApiKey: () => ipcRenderer.invoke('auth:getApiKey'),
    refreshProfile: () => ipcRenderer.invoke('auth:refreshProfile'),
    onProfileRefreshed: (listener: (user: any) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, data: any) => listener(data);
      ipcRenderer.on('auth:profileRefreshed', handler);
      return () => { ipcRenderer.removeListener('auth:profileRefreshed', handler); };
    },
  },

  sync: {
    start: () => ipcRenderer.invoke('sync:start'),
    status: () => ipcRenderer.invoke('sync:status'),
  },

  extensions: {
    list: () => ipcRenderer.invoke('extensions:list'),
    install: (extensionId: string) => ipcRenderer.invoke('extensions:install', extensionId),
    uninstall: (extensionId: string) => ipcRenderer.invoke('extensions:uninstall', extensionId),
    marketplace: (query?: string) => ipcRenderer.invoke('extensions:marketplace', query),
  },

  extensionRuntime: {
    list: () => ipcRenderer.invoke('extensions:runtime:list'),
    start: (extensionId: string) => ipcRenderer.invoke('extensions:runtime:start', extensionId),
    stop: (extensionId: string) => ipcRenderer.invoke('extensions:runtime:stop', extensionId),
    enable: (extensionId: string) => ipcRenderer.invoke('extensions:runtime:enable', extensionId),
    disable: (extensionId: string) => ipcRenderer.invoke('extensions:runtime:disable', extensionId),
    permissions: (extensionId: string) => ipcRenderer.invoke('extensions:runtime:permissions', extensionId),
    grantPermissions: (extensionId: string, permissions: string[]) =>
      ipcRenderer.invoke('extensions:runtime:grantPermissions', extensionId, permissions),
    executeCommand: (extensionId: string, commandId: string, ...args: any[]) =>
      ipcRenderer.invoke('extensions:runtime:executeCommand', extensionId, commandId, ...args),
    installOcx: () => ipcRenderer.invoke('extensions:runtime:installOcx'),
    installFromMarketplace: (extensionId: string) =>
      ipcRenderer.invoke('extensions:runtime:installFromMarketplace', extensionId),
    onUIRequest: (callback: (data: any) => void) => {
      ipcRenderer.on('extension:uiRequest', (_event, data) => callback(data));
    },
  },

  extensionUpdates: {
    checkForUpdates: () => ipcRenderer.invoke('extensions:updates:check'),
    getPending: () => ipcRenderer.invoke('extensions:updates:pending'),
  },

  shell: {
    openExternal: (url: string) => ipcRenderer.invoke('shell:openExternal', url),
  },

  setup: {
    checkSystem: () => ipcRenderer.invoke('setup:checkSystem'),
    verifyApiKey: (apiKey: string) => ipcRenderer.invoke('setup:verifyApiKey', apiKey),
    executeSetup: (config: any) => ipcRenderer.invoke('setup:executeSetup', config),
    reinstall: () => ipcRenderer.invoke('setup:reinstall'),
    uninstall: (cleanupConfig: boolean) => ipcRenderer.invoke('setup:uninstall', cleanupConfig),
    versionCheck: () => ipcRenderer.invoke('setup:versionCheck'),
    scanConfig: () => ipcRenderer.invoke('setup:scanConfig'),
    onProgress: (callback: (progress: any) => void) => {
      ipcRenderer.on('setup:progress', (_event, data) => callback(data));
      return () => { ipcRenderer.removeAllListeners('setup:progress'); };
    },
  },

  system: {
    openclawQuickInstall: () => ipcRenderer.invoke('system:openclawQuickInstall'),
    buyApi: () => ipcRenderer.invoke('system:buyApi'),
  },

  dockerAgent: {
    isAvailable: (): Promise<boolean> => ipcRenderer.invoke('dockerAgent:isAvailable'),
    install: (payload: { id: string; dockerImage?: string; defaultPort: number; dockerComposeUrl?: string; provider?: string; apiKey?: string }): Promise<{ ok: boolean; error?: string }> =>
      ipcRenderer.invoke('dockerAgent:install', payload),
    start: (payload: { id: string; dockerImage?: string; defaultPort: number; dockerComposeUrl?: string; provider?: string; apiKey?: string }): Promise<{ ok: boolean; containerId?: string; error?: string }> =>
      ipcRenderer.invoke('dockerAgent:start', payload),
    stop: (payload: { id: string; dockerImage?: string; defaultPort: number; dockerComposeUrl?: string }): Promise<{ ok: boolean; error?: string }> =>
      ipcRenderer.invoke('dockerAgent:stop', payload),
    status: (payload: { id: string; dockerImage?: string; defaultPort: number; dockerComposeUrl?: string }): Promise<{ running: boolean; error?: string }> =>
      ipcRenderer.invoke('dockerAgent:status', payload),
    chat: (payload: { id: string; defaultPort: number }, message: string): Promise<{ ok: boolean; reply?: string; error?: string }> =>
      ipcRenderer.invoke('dockerAgent:chat', { id: payload.id, defaultPort: payload.defaultPort }, message),
    onProgress: (listener: (data: { agentId: string; line: string }) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, data: { agentId: string; line: string }) => listener(data);
      ipcRenderer.on('dockerAgent:progress', handler);
      return () => { ipcRenderer.removeListener('dockerAgent:progress', handler); };
    },
  },

  diagnostics: {
    getEvents: () => ipcRenderer.invoke('diagnostics:getEvents'),
  },

  agent: {
    bootstrap: (): Promise<AgentBootstrapPayload> => ipcRenderer.invoke('agent:bootstrap'),
    newSession: (): Promise<ChatSession> => ipcRenderer.invoke('agent:newSession'),
    sendMessage: (sessionId: string, text: string): Promise<AgentSendMessageResult> =>
      ipcRenderer.invoke('agent:sendMessage', sessionId, text),
    getStatus: (sessionId?: string): Promise<AgentRuntimeState> =>
      ipcRenderer.invoke('agent:getStatus', sessionId),
    listTasks: (sessionId?: string): Promise<AgentTask[]> =>
      ipcRenderer.invoke('agent:listTasks', sessionId),
    updateTaskStatus: (taskId: string, status: AgentTaskStatus): Promise<AgentTask | null> =>
      ipcRenderer.invoke('agent:updateTaskStatus', taskId, status),
    listMemories: (sessionId?: string): Promise<AgentMemory[]> =>
      ipcRenderer.invoke('agent:listMemories', sessionId),
    pinMemory: (memoryId: string, pinned: boolean): Promise<AgentMemory | null> =>
      ipcRenderer.invoke('agent:pinMemory', memoryId, pinned),
    deleteMemory: (memoryId: string): Promise<{ success: boolean }> =>
      ipcRenderer.invoke('agent:deleteMemory', memoryId),
    getDiagnostics: (limit?: number): Promise<DiagnosticEvent[]> =>
      ipcRenderer.invoke('agent:getDiagnostics', limit),
    onStream: (listener: (event: AgentStreamEvent) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, data: AgentStreamEvent) => listener(data);
      ipcRenderer.on('agent:stream', handler);
      return () => {
        ipcRenderer.removeListener('agent:stream', handler);
      };
    },
  },

  customProvider: {
    getConfig: () => ipcRenderer.invoke('customProvider:getConfig'),
    saveConfig: (input: {
      baseUrl: string;
      authType: 'bearer' | 'x-api-key';
      selectedModel: string;
      apiKey?: string;
    }) => ipcRenderer.invoke('customProvider:saveConfig', input),
    setEnabled: (enabled: boolean) => ipcRenderer.invoke('customProvider:setEnabled', enabled),
    deleteKey: () => ipcRenderer.invoke('customProvider:deleteKey'),
    testConnection: (input?: { apiKey?: string }) =>
      ipcRenderer.invoke('customProvider:testConnection', input),
  },

  integrations: {
    list: (): Promise<IntegrationConnection[]> => ipcRenderer.invoke('integrations:list'),
    beginConnect: (provider: IntegrationProvider): Promise<{ provider: IntegrationProvider; url: string }> =>
      ipcRenderer.invoke('integrations:beginConnect', provider),
    disconnect: (provider: IntegrationProvider): Promise<IntegrationConnection[]> =>
      ipcRenderer.invoke('integrations:disconnect', provider),
  },

  onboarding: {
    getState: (): Promise<OnboardingState> => ipcRenderer.invoke('onboarding:getState'),
    markSeen: (): Promise<OnboardingState> => ipcRenderer.invoke('onboarding:markSeen'),
    dismiss: (): Promise<OnboardingState> => ipcRenderer.invoke('onboarding:dismiss'),
    complete: (): Promise<OnboardingState> => ipcRenderer.invoke('onboarding:complete'),
  },

  updater: {
    getState: (): Promise<DesktopUpdaterState> => ipcRenderer.invoke('updater:getState'),
    check: (): Promise<DesktopUpdaterState> => ipcRenderer.invoke('updater:check'),
    download: (): Promise<DesktopUpdaterState> => ipcRenderer.invoke('updater:download'),
    quitAndInstall: (): Promise<{ success: boolean }> => ipcRenderer.invoke('updater:quitAndInstall'),
    onState: (listener: (state: DesktopUpdaterState) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, data: DesktopUpdaterState) => listener(data);
      ipcRenderer.on('updater:state', handler);
      return () => {
        ipcRenderer.removeListener('updater:state', handler);
      };
    },
  },

  budget: {
    getStatus: () => ipcRenderer.invoke('budget:getStatus'),
    getLimits: () => ipcRenderer.invoke('budget:getLimits'),
    setLimits: (limits: { daily?: number; weekly?: number; monthly?: number }) =>
      ipcRenderer.invoke('budget:setLimits', limits),
    getAlerts: (since?: number) => ipcRenderer.invoke('budget:getAlerts', since),
    getAdvice: () => ipcRenderer.invoke('budget:getAdvice'),
    purge: (keepDays?: number) => ipcRenderer.invoke('budget:purge', keepDays),
    onAlert: (callback: (alert: any) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, data: any) => callback(data);
      ipcRenderer.on('budget:alert', handler);
      return () => { ipcRenderer.removeListener('budget:alert', handler); };
    },
  },

  costGate: {
    evaluate: (request: {
      modelId: string;
      inputText: string;
      expectedOutputTokens?: number;
      isVietnamese?: boolean;
      taskType?: string;
    }) => ipcRenderer.invoke('costGate:evaluate', request),
    getConfig: () => ipcRenderer.invoke('costGate:getConfig'),
    setAutoDowngrade: (enabled: boolean) => ipcRenderer.invoke('costGate:setAutoDowngrade', enabled),
    setMaxCostPerRequest: (usd: number) => ipcRenderer.invoke('costGate:setMaxCostPerRequest', usd),
  },

  smartRouter: {
    route: (taskType: string, inputText: string, isVietnamese?: boolean) =>
      ipcRenderer.invoke('smartRouter:route', taskType, inputText, isVietnamese),
    getPreferences: () => ipcRenderer.invoke('smartRouter:getPreferences'),
    setPreferences: (prefs: any) => ipcRenderer.invoke('smartRouter:setPreferences', prefs),
  },

  agents: {
    list: (): Promise<any[]> => ipcRenderer.invoke('agents:list'),
    install: (params: { bundleId: string; secrets: Record<string, string>; config: Record<string, any> }): Promise<any> =>
      ipcRenderer.invoke('agents:install', params),
    uninstall: (agentId: string): Promise<{ success: boolean }> =>
      ipcRenderer.invoke('agents:uninstall', agentId),
    start: (agentId: string): Promise<{ success: boolean }> =>
      ipcRenderer.invoke('agents:start', agentId),
    stop: (agentId: string): Promise<{ success: boolean }> =>
      ipcRenderer.invoke('agents:stop', agentId),
    getStatus: (agentId: string): Promise<any> =>
      ipcRenderer.invoke('agents:getStatus', agentId),
    configure: (agentId: string, config: Record<string, any>): Promise<{ success: boolean }> =>
      ipcRenderer.invoke('agents:configure', agentId, config),
    sendMessage: (agentId: string, message: string): Promise<any> =>
      ipcRenderer.invoke('agents:sendMessage', agentId, message),
    onEvent: (listener: (event: any) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, data: any) => listener(data);
      ipcRenderer.on('agents:event', handler);
      return () => {
        ipcRenderer.removeListener('agents:event', handler);
      };
    },
  },

  platform: {
    isElectron: true,
    os: process.platform,
  },
};

contextBridge.exposeInMainWorld('electronAPI', electronAPI);

export type ElectronAPI = typeof electronAPI;
