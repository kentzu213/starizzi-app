// MUST be first: loads .env into process.env before any module reads its
// env-derived constants (auth/sync/graph base URLs, Izzi key). Side-effecting.
import { IZZI_WEB_BASE } from './config/public-config';
import { app, BrowserWindow, ipcMain, shell, dialog, nativeImage } from 'electron';
import * as path from 'path';
import * as fs from 'fs';
import { execFile } from 'child_process';

/**
 * First-party utilities shipped WITH the app — installable offline from
 * `resources/bundled-extensions/`, no Marketplace download server needed.
 * Keyed by the marketplace/extension id.
 */
const BUNDLED_OCX: Record<string, string> = {
  'ext-social-auto-poster': 'social-auto-poster-0.2.0.ocx',
};
import { AuthManager } from './auth/auth-manager';
import { DatabaseManager } from './db/database';
import { SyncEngine } from './sync/sync-engine';
import { GraphClient } from './graph/graph-client';
import { registerGraphIpc, registerGraphAgentIpc } from './graph/graph-ipc';
import { GraphAgent } from './graph/graph-agent';
import { AffiliateClient } from './affiliate/affiliate-client';
import { registerAffiliateIpc } from './affiliate/affiliate-ipc';
import { ExtensionManager } from './extensions/manager';
import { ExtensionLoader } from './extensions/extension-loader';
import { PERMISSION_DEFINITIONS } from './extensions/permissions';
import { installFromMarketplace } from './extensions/marketplace-download';
import { ExtensionUpdateChecker } from './extensions/update-checker';
import { AgentService } from './agent/agent-service';
import { ProviderSettingsStore } from './agent/provider-settings-store';
import { SecretStore } from './agent/secret-store';
import { CustomOpenAIProvider } from './agent/custom-openai-provider';
import { runHostAgentTurn } from './agent/host-agent';
import { AgentPermissionStore, isPermissionMode, type PermissionMode } from './agent/agent-permissions';
import { AutopostAuth } from './autopost/autopost-auth';
import { AutopostClient } from './autopost/autopost-client';
import { AUTOPOST_TOOLS, classifyAutopostRisk, executeAutopostTool, isAutopostTool } from './autopost/autopost-tools';
import type { LoadedExtension } from './extensions/extension-loader';
import { IntegrationsService } from './integrations/integrations-service';
import { OnboardingService } from './onboarding/onboarding-service';
import type { AgentTask, AgentTaskStatus, IntegrationProvider } from './agent/types';
import { UpdaterService } from './updater/updater-service';
import { SetupWizardService } from './setup/setup-wizard-service';
import { registerAgentIpcHandlers, shutdownAgents } from './agents';
import { DockerAgentService, type DockerAgentPayload } from './agents/docker-agent-service';
import { IzziAgent, registerIzziAgentIpc } from './agents/izzi-agent';
import { IzziLlmProxy } from './agents/izzi-llm-proxy';
import { AgentSessionCapturer } from './agents/agent-session-graph';
import { SessionRecorder } from './agents/agent-session-recorder';
import { createStreamCollector } from '../shared/agent-turn-events';

let mainWindow: BrowserWindow | null = null;
let authManager: AuthManager;
let dbManager: DatabaseManager;
let syncEngine: SyncEngine;
let extensionManager: ExtensionManager;
let extensionLoader: ExtensionLoader;
let updateChecker: ExtensionUpdateChecker;
let agentService: AgentService;
let autopostAuth: AutopostAuth;
let integrationsService: IntegrationsService;
let onboardingService: OnboardingService;
let updaterService: UpdaterService;
let setupWizardService: SetupWizardService;
// Localhost OpenAI-compatible proxy that routes Docker agents (Hermes) through the
// user's Izzi smart router. The Izzi credential stays in main (never in a container).
let izziLlmProxy: IzziLlmProxy;
let dockerAgentService: DockerAgentService;

/**
 * Resolve the Izzi credential for the LLM proxy, never logged / never sent to the
 * renderer. Priority: OPENAI_API_KEY env (dev/self-host) → a durable izzi- key
 * minted for this desktop (POST /api/keys — reliably accepted by /v1 via the
 * server-side api_keys lookup) → the signed-in user's profile key → the Supabase
 * JWT (last resort; /v1 does not accept it). So a logged-in user needs no manual
 * key entry, and the credential izzi actually accepts is used first.
 */
async function resolveIzziCredential(auth: AuthManager): Promise<string | null> {
  const envKey = process.env.OPENAI_API_KEY;
  if (typeof envKey === 'string' && envKey.trim().length > 0) return envKey.trim();
  const mintedKey = await auth.ensureDesktopApiKey();
  if (mintedKey) return mintedKey;
  const userKey = typeof auth.getApiKey === 'function' ? auth.getApiKey() : null;
  if (typeof userKey === 'string' && userKey.trim().length > 0) return userKey.trim();
  const jwt = await auth.getAccessToken();
  return typeof jwt === 'string' && jwt.trim().length > 0 ? jwt.trim() : null;
}

const isDev = !app.isPackaged;
const OPENCLAW_DOCS_URL = 'https://docs.openclaw.ai';
const IZZIAPI_PRICING_URL = 'https://izziapi.com/pricing';

function getBuildAssetPath(fileName: string): string {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, 'build', fileName);
  }
  return path.join(app.getAppPath(), 'build', fileName);
}

/** Get the platform-appropriate app icon as nativeImage */
function getAppIcon(): Electron.NativeImage | undefined {
  try {
    let iconFileName: string;
    if (process.platform === 'win32') {
      iconFileName = 'icon.ico';
    } else if (process.platform === 'darwin') {
      iconFileName = 'icon.icns';
    } else {
      iconFileName = 'icon.png';
    }
    const iconPath = getBuildAssetPath(iconFileName);
    const icon = nativeImage.createFromPath(iconPath);
    if (icon.isEmpty()) {
      // Fallback to png if platform-specific format missing
      const fallbackPath = getBuildAssetPath('icon.png');
      const fallback = nativeImage.createFromPath(fallbackPath);
      return fallback.isEmpty() ? undefined : fallback;
    }
    return icon;
  } catch (err) {
    console.error('[Icon] Failed to load app icon:', err);
    return undefined;
  }
}

// Register custom protocol for OAuth callback
if (process.defaultApp) {
  if (process.argv.length >= 2) {
    app.setAsDefaultProtocolClient('openclaw', process.execPath, [path.resolve(process.argv[1])]);
  }
} else {
  app.setAsDefaultProtocolClient('openclaw');
}

function createWindow() {
  const appIcon = getAppIcon();

  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 960,
    minHeight: 640,
    frame: false,
    titleBarStyle: 'hidden',
    backgroundColor: '#08090c',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      webviewTag: true,
    },
    ...(appIcon ? { icon: appIcon } : {}),
  });

  // QA affordance: `OPENCLAW_FORCE_PROD_RENDERER=1` loads the built renderer via
  // file:// even in an unpackaged dev checkout, so we can verify the real
  // production path (no localhost demo-mode) without cutting a full installer.
  // Defaults off — normal dev + packaged behavior is unchanged.
  const forceProdRenderer = process.env.OPENCLAW_FORCE_PROD_RENDERER === '1';
  if (isDev && !forceProdRenderer) {
    mainWindow.loadURL('http://localhost:5173');
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  } else {
    mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'));
  }

  // Register Agent Bundle IPC handlers (Agent Marketplace)
  registerAgentIpcHandlers(mainWindow);

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

function findOpenClawCli(): Promise<string | null> {
  return new Promise((resolve) => {
    execFile('where', ['openclaw'], (error, stdout) => {
      if (error || !stdout) {
        resolve(null);
        return;
      }

      const first = stdout
        .split(/\r?\n/)
        .map((line) => line.trim())
        .find(Boolean);

      resolve(first || null);
    });
  });
}

function setupIPC() {
  // ── Window controls ──
  ipcMain.handle('window:minimize', () => mainWindow?.minimize());
  ipcMain.handle('window:maximize', () => {
    if (mainWindow?.isMaximized()) {
      mainWindow.unmaximize();
    } else {
      mainWindow?.maximize();
    }
  });
  ipcMain.handle('window:close', () => mainWindow?.close());
  ipcMain.handle('window:isMaximized', () => mainWindow?.isMaximized());

  // ── Auth (Supabase) ──
  ipcMain.handle('auth:login', async (_event, credentials: { email: string; password: string }) => {
    return authManager.login(credentials.email, credentials.password);
  });
  ipcMain.handle('auth:loginWithGoogle', async () => {
    return authManager.loginWithGoogle();
  });
  ipcMain.handle('auth:signup', async (_event, data: { email: string; password: string; name: string }) => {
    return authManager.signup(data.email, data.password, data.name);
  });
  ipcMain.handle('auth:logout', async () => {
    return authManager.logout();
  });
  ipcMain.handle('auth:getUser', async () => {
    return authManager.getCurrentUser();
  });
  ipcMain.handle('auth:isAuthenticated', async () => {
    return authManager.isAuthenticated();
  });
  ipcMain.handle('auth:getApiKey', async () => {
    return authManager.getApiKey();
  });
  ipcMain.handle('auth:refreshProfile', async () => {
    return authManager.refreshProfile();
  });

  // ── Sync ──
  ipcMain.handle('sync:start', async () => {
    return syncEngine.startSync();
  });
  ipcMain.handle('sync:status', async () => {
    return syncEngine.getStatus();
  });

  // ── Graph & Memory (shared backend /api/aibase/*; token stays in main) ──
  const graphClient = new GraphClient(authManager, dbManager);
  registerGraphIpc(graphClient);

  // Agent-side write loop: record each finished agent turn into the unified
  // surfaces — my-graph (knowledge) + Replay tasks (daily work board).
  const sessionRecorder = new SessionRecorder(new AgentSessionCapturer(graphClient), dbManager);

  // Gateway chat history persistence (survives restart). Stored as `user_data`
  // rows (type 'gateway_session'); no secrets are ever included (the Izzi key
  // lives only in main and never reaches the renderer/session objects).
  ipcMain.handle('gatewaySessions:list', async () => dbManager.getUserData('gateway_session'));
  ipcMain.handle('gatewaySessions:save', async (_e, session: { id?: unknown }) => {
    if (session && typeof session.id === 'string' && session.id.length > 0) {
      dbManager.cacheUserData(session.id, 'gateway_session', session as object);
    }
    return { ok: true };
  });
  ipcMain.handle('gatewaySessions:delete', async (_e, id: string) => {
    if (typeof id === 'string' && id.length > 0) dbManager.deleteUserData(id);
    return { ok: true };
  });

  // Open the user's personal graph on the web (same second-brain data) in the browser.
  ipcMain.handle('graph:openMyGraphWeb', async () => {
    const url = `${IZZI_WEB_BASE}/aibase/my-graph`;
    await shell.openExternal(url);
    return { ok: true, url };
  });

  // ── Graph Agent (Izzi LLM for the Branching Graph Workspace; key stays in main) ──
  const graphAgent = new GraphAgent(authManager);
  registerGraphAgentIpc(graphAgent);

  // ── Affiliate (shared backend /api/affiliate/*; token stays in main) ──
  const affiliateClient = new AffiliateClient(authManager);
  registerAffiliateIpc(affiliateClient);

  // ── Izzi-native persona agents (Socrates, Orchestrator) — Agent Hub; key in main ──
  // Lazy tool-host adapter: resolves extensionLoader at call-time (it's initialized later
  // during app bootstrap). Lets these agents invoke installed extension commands (opt-in).
  const izziAgent = new IzziAgent(authManager, {
    getAllExtensions: () => (extensionLoader ? extensionLoader.getAllExtensions() : []),
    executeCommand: (extensionId, commandId, ...args) =>
      extensionLoader.executeCommand(extensionId, commandId, ...args),
  });
  registerIzziAgentIpc(izziAgent, sessionRecorder);

  // ── Extensions (basic) ──
  ipcMain.handle('extensions:list', async () => {
    return extensionManager.getInstalled();
  });
  ipcMain.handle('extensions:install', async (_event, extensionId: string) => {
    return extensionManager.install(extensionId);
  });
  ipcMain.handle('extensions:uninstall', async (_event, extensionId: string) => {
    return extensionManager.uninstall(extensionId);
  });
  ipcMain.handle('extensions:marketplace', async (_event, query?: string) => {
    return extensionManager.searchMarketplace(query);
  });

  // ── Extension Runtime (Sprint 2B) ──
  ipcMain.handle('extensions:runtime:list', async () => {
    return extensionLoader.getAllExtensions().map(ext => ({
      id: ext.id,
      name: ext.name,
      displayName: ext.manifest.displayName,
      version: ext.manifest.version,
      description: ext.manifest.description,
      state: ext.state,
      permissions: ext.manifest.permissions || [],
      grantedPermissions: ext.grantedPermissions,
      author: ext.manifest.author?.name,
      categories: ext.manifest.categories,
      pricing: ext.manifest.pricing,
    }));
  });

  ipcMain.handle('extensions:runtime:start', async (_event, extensionId: string) => {
    try {
      await extensionLoader.startExtension(extensionId);
      return { success: true };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('extensions:runtime:stop', async (_event, extensionId: string) => {
    try {
      await extensionLoader.stopExtension(extensionId);
      return { success: true };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('extensions:runtime:enable', async (_event, extensionId: string) => {
    try {
      extensionLoader.enableExtension(extensionId);
      return { success: true };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('extensions:runtime:disable', async (_event, extensionId: string) => {
    try {
      await extensionLoader.disableExtension(extensionId);
      return { success: true };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('extensions:runtime:permissions', async (_event, extensionId: string) => {
    const ext = extensionLoader.getExtension(extensionId);
    if (!ext) return { success: false, error: 'Extension not found' };
    return {
      success: true,
      requested: ext.manifest.permissions || [],
      granted: ext.grantedPermissions,
      definitions: PERMISSION_DEFINITIONS,
    };
  });

  ipcMain.handle('extensions:runtime:grantPermissions', async (_event, extensionId: string, permissions: string[]) => {
    try {
      extensionLoader.updatePermissions(extensionId, permissions);
      return { success: true };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('extensions:runtime:executeCommand', async (_event, extensionId: string, commandId: string, ...args: any[]) => {
    try {
      const result = await extensionLoader.executeCommand(extensionId, commandId, ...args);
      return { success: true, result };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  });

  // Config surface for the extension settings form (contributes.settings + current values).
  ipcMain.handle('extensions:runtime:getConfig', async (_event, extensionId: string) => {
    const ext = extensionLoader.getExtension(extensionId);
    if (!ext) return { success: false, error: 'Extension not found' };
    const settings = ext.manifest.contributes?.settings ?? [];
    const commands = ext.manifest.contributes?.commands ?? [];
    const values: Record<string, unknown> = {};
    for (const s of settings) {
      const stored = extensionLoader.getStoredExtensionValue(extensionId, `setting.${s.id}`);
      values[s.id] = stored ?? s.default ?? '';
    }
    return { success: true, settings, commands, values, pricing: ext.manifest.pricing };
  });

  ipcMain.handle('extensions:runtime:setSetting', async (_event, extensionId: string, settingId: string, value: unknown) => {
    try {
      extensionLoader.setStoredExtensionValue(extensionId, `setting.${settingId}`, value);
      return { success: true };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('extensions:runtime:installOcx', async () => {
    // Open file dialog to select .ocx file
    const result = await dialog.showOpenDialog(mainWindow!, {
      title: 'Cài đặt tiện ích (.ocx)',
      filters: [{ name: 'OpenClaw Extension', extensions: ['ocx'] }],
      properties: ['openFile'],
    });
    if (result.canceled || result.filePaths.length === 0) {
      return { success: false, error: 'Cancelled' };
    }
    try {
      const ext = await extensionLoader.installFromOcx(result.filePaths[0]);
      return { success: true, extension: { id: ext.id, name: ext.name, displayName: ext.manifest.displayName } };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  });

  // Install from marketplace (download + install .ocx)
  ipcMain.handle('extensions:runtime:installFromMarketplace', async (_event, extensionId: string) => {
    try {
      // First-party bundled utilities install offline from a shipped .ocx — no download server.
      const bundledFile = BUNDLED_OCX[extensionId];
      if (bundledFile) {
        const bundledPath = path.join(process.resourcesPath, 'bundled-extensions', bundledFile);
        if (fs.existsSync(bundledPath)) {
          const ext = await extensionLoader.installFromOcx(bundledPath);
          return { success: true, extension: { id: ext.id, name: ext.name, displayName: ext.manifest.displayName }, bundled: true };
        }
      }
      const token = await authManager.getAccessToken?.();
      const authToken = token || undefined;
      const { success, extensionPath, error } = await installFromMarketplace(extensionId, authToken);
      if (!success || !extensionPath) {
        return { success: false, error: error || 'Download failed' };
      }
      // Install the downloaded .ocx
      const ext = await extensionLoader.installFromOcx(extensionPath);
      return { success: true, extension: { id: ext.id, name: ext.name, displayName: ext.manifest.displayName } };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  });

  // ── Shell ──
  ipcMain.handle('shell:openExternal', async (_event, url: string) => {
    return shell.openExternal(url);
  });

  // ── Extension Updates ──
  ipcMain.handle('extensions:updates:check', async () => {
    if (!updateChecker) return { updates: [] };
    const updates = await updateChecker.checkAll();
    return { updates };
  });

  ipcMain.handle('extensions:updates:pending', async () => {
    if (!updateChecker) return { updates: [], count: 0 };
    const updates = updateChecker.getPendingUpdates();
    return { updates, count: updates.length };
  });

  ipcMain.handle('system:openclawQuickInstall', async () => {
    const cliPath = await findOpenClawCli();

    if (cliPath) {
      await shell.openPath(cliPath);
      dbManager.appendDiagnosticEvent({ type: 'system.openclaw', status: 'success', detail: `Opened local CLI: ${cliPath}` });
      return { success: true, mode: 'local-cli', target: cliPath };
    }

    await shell.openExternal(OPENCLAW_DOCS_URL);
    dbManager.appendDiagnosticEvent({ type: 'system.openclaw', status: 'info', detail: `Opened docs: ${OPENCLAW_DOCS_URL}` });
    return { success: true, mode: 'docs', target: OPENCLAW_DOCS_URL };
  });

  ipcMain.handle('system:buyApi', async () => {
    await shell.openExternal(IZZIAPI_PRICING_URL);
    dbManager.appendDiagnosticEvent({ type: 'system.buy_api', status: 'success', detail: `Opened pricing: ${IZZIAPI_PRICING_URL}` });
    return { success: true, target: IZZIAPI_PRICING_URL };
  });

  // ── Setup Wizard ──
  ipcMain.handle('setup:checkSystem', async () => {
    return setupWizardService.checkSystem();
  });

  ipcMain.handle('setup:verifyApiKey', async (_event, apiKey: string) => {
    return setupWizardService.verifyIzziApiKey(apiKey);
  });

  ipcMain.handle('setup:executeSetup', async (_event, config: any) => {
    setupWizardService.onProgress((progress) => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('setup:progress', progress);
      }
    });

    const systemInfo = await setupWizardService.checkSystem();
    const success = await setupWizardService.executeSetup(config, systemInfo);
    return { success };
  });

  // ── Setup Management (reinstall / uninstall / version) ──
  ipcMain.handle('setup:reinstall', async () => {
    return setupWizardService.reinstallOpenClaw();
  });

  ipcMain.handle('setup:uninstall', async (_event, cleanupConfig: boolean) => {
    return setupWizardService.uninstallOpenClaw(cleanupConfig);
  });

  ipcMain.handle('setup:versionCheck', async () => {
    return setupWizardService.checkOpenClawVersion();
  });

  ipcMain.handle('setup:scanConfig', async () => {
    return setupWizardService.scanExistingConfig();
  });

  // ── Docker Agent (Top Agents — real Docker install/run) ──
  ipcMain.handle('dockerAgent:isAvailable', async () => {
    return dockerAgentService.isDockerAvailable();
  });

  ipcMain.handle('dockerAgent:install', async (_event, payload: DockerAgentPayload) => {
    return dockerAgentService.install(payload, (line) => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('dockerAgent:progress', { agentId: payload.id, line });
      }
    });
  });

  ipcMain.handle('dockerAgent:start', async (_event, payload: DockerAgentPayload) => {
    return dockerAgentService.start(payload);
  });

  ipcMain.handle('dockerAgent:stop', async (_event, payload: DockerAgentPayload) => {
    return dockerAgentService.stop(payload);
  });

  ipcMain.handle('dockerAgent:status', async (_event, payload: DockerAgentPayload) => {
    return dockerAgentService.status(payload);
  });

  ipcMain.handle(
    'dockerAgent:chat',
    async (
      event,
      payload: DockerAgentPayload & { agentName?: string; reasoningEffort?: string; turnId?: string },
      message: string,
    ) => {
      const turnId = typeof payload?.turnId === 'string' ? payload.turnId : '';
      const startedAt = new Date().toISOString();
      // Stream the live process to the renderer; collect it for graph capture.
      const collector = createStreamCollector((evt) => event.sender.send('agentStream:event', evt));
      const result = await dockerAgentService.chat(
        payload,
        message,
        turnId ? { onEvent: collector.onEvent, turnId } : undefined,
      );

      if (payload?.id && result.ok && typeof result.reply === 'string' && result.reply.length > 0) {
        sessionRecorder.record({
          agentId: payload.id,
          agentName: payload.agentName || payload.id,
          model: 'hermes',
          reasoningEffort: payload.reasoningEffort,
          request: message,
          reply: result.reply,
          steps: collector.steps(),
          startedAt,
          finishedAt: new Date().toISOString(),
          turnId,
        });
      }
      return result;
    },
  );

  ipcMain.handle('dockerAgent:setReasoningEffort', async (_event, payload: DockerAgentPayload, effort: string) => {
    return dockerAgentService.setReasoningEffort(payload, effort);
  });

  ipcMain.handle(
    'dockerAgent:healthCheck',
    async (_event, payload: { defaultPort: number; healthEndpoint?: string; timeoutMs?: number }) => {
      return dockerAgentService.healthCheck(payload, payload?.timeoutMs);
    },
  );

  ipcMain.handle('diagnostics:getEvents', async () => {
    return dbManager.getDiagnosticEvents();
  });

  ipcMain.handle('agent:bootstrap', async () => {
    return agentService.bootstrap();
  });

  ipcMain.handle('agent:newSession', async () => {
    return agentService.newSession();
  });

  ipcMain.handle('agent:sendMessage', async (_event, sessionId: string, text: string) => {
    return agentService.sendMessage(sessionId, text);
  });

  ipcMain.handle('agent:getStatus', async (_event, sessionId?: string) => {
    return agentService.getStatus(sessionId);
  });

  ipcMain.handle('agent:listTasks', async (_event, sessionId?: string) => {
    return agentService.listTasks(sessionId);
  });

  ipcMain.handle('agent:updateTaskStatus', async (_event, taskId: string, status: AgentTaskStatus) => {
    return agentService.updateTaskStatus(taskId, status);
  });

  ipcMain.handle('agent:listMemories', async (_event, sessionId?: string) => {
    return agentService.listMemories(sessionId);
  });

  ipcMain.handle('agent:pinMemory', async (_event, memoryId: string, pinned: boolean) => {
    return agentService.pinMemory(memoryId, pinned);
  });

  ipcMain.handle('agent:deleteMemory', async (_event, memoryId: string) => {
    return agentService.deleteMemory(memoryId);
  });

  ipcMain.handle('agent:getDiagnostics', async (_event, limit?: number) => {
    return agentService.getDiagnostics(limit);
  });

  // ── Custom LLM Provider ──
  ipcMain.handle('customProvider:getConfig', async () => {
    return agentService.getProviderConfig();
  });

  ipcMain.handle(
    'customProvider:saveConfig',
    async (
      _event,
      input: { baseUrl: string; authType: 'bearer' | 'x-api-key'; selectedModel: any; apiKey?: string },
    ) => {
      return agentService.saveProviderConfig(input);
    },
  );

  ipcMain.handle('customProvider:setEnabled', async (_event, enabled: boolean) => {
    return agentService.setCustomEnabled(enabled);
  });

  ipcMain.handle('customProvider:deleteKey', async () => {
    return agentService.deleteProviderKey();
  });

  ipcMain.handle('customProvider:testConnection', async (_event, input?: { apiKey?: string }) => {
    return agentService.testProviderConnection(input);
  });

  // One-click local connection ("Kết nối nhanh codex-lb"): read the codex-lb key
  // from the environment (CODEX_LB_API_KEY) in the MAIN process and wire the app
  // to the local codex-lb router (127.0.0.1:2455, gpt-5.5) + enable it. Explicit
  // user action from the "Kết nối Model" tab; the key stays in main, never returned.
  ipcMain.handle(
    'customProvider:autoConnectLocal',
    async (): Promise<{ ok: boolean; enabled?: boolean; reason?: string }> => {
      const envKey = (process.env.CODEX_LB_API_KEY || process.env.CODEX_LB_KEY || '').trim();
      if (!envKey) return { ok: false, reason: 'no-env-key' };
      try {
        const settings = new ProviderSettingsStore(dbManager);
        const secrets = new SecretStore(dbManager);
        settings.saveConfig({
          baseUrl: 'http://127.0.0.1:2455/v1',
          authType: 'bearer',
          selectedModel: 'gpt-5.5',
        });
        secrets.setKey(envKey);
        settings.setEnabled(true);
        dbManager.appendDiagnosticEvent({
          type: 'model_connection.autoconnect',
          status: 'info',
          detail: 'Manually connected local codex-lb from CODEX_LB_API_KEY env (Kết nối nhanh).',
        });
        return { ok: true, enabled: true };
      } catch {
        return { ok: false, reason: 'save-failed' };
      }
    },
  );

  // Agent permission mode (Codex-style): 'chat' (no tools) | 'agent' (tools, ask
  // before risky) | 'agent-full' (tools, no ask). Controls the customProvider path.
  ipcMain.handle('agentPermission:getMode', async (): Promise<PermissionMode> => {
    return new AgentPermissionStore(dbManager).getMode();
  });
  ipcMain.handle(
    'agentPermission:setMode',
    async (_event, mode: string): Promise<{ ok: boolean; mode: PermissionMode }> => {
      const store = new AgentPermissionStore(dbManager);
      if (isPermissionMode(mode)) store.setMode(mode);
      return { ok: isPermissionMode(mode), mode: store.getMode() };
    },
  );

  // Agent working directory — default cwd for run_command + base for relative paths.
  ipcMain.handle('agentPermission:getWorkingDir', async (): Promise<{ dir: string }> => {
    return { dir: new AgentPermissionStore(dbManager).getWorkingDir() };
  });
  ipcMain.handle('agentPermission:pickWorkingDir', async (event): Promise<{ dir: string }> => {
    const win = BrowserWindow.fromWebContents(event.sender) ?? mainWindow;
    const store = new AgentPermissionStore(dbManager);
    if (!win || win.isDestroyed()) return { dir: store.getWorkingDir() };
    const r = await dialog.showOpenDialog(win, {
      properties: ['openDirectory'],
      title: 'Chọn thư mục làm việc cho agent',
    });
    if (r.canceled || !r.filePaths[0]) return { dir: store.getWorkingDir() };
    store.setWorkingDir(r.filePaths[0]);
    return { dir: r.filePaths[0] };
  });
  ipcMain.handle('agentPermission:clearWorkingDir', async (): Promise<{ dir: string }> => {
    new AgentPermissionStore(dbManager).setWorkingDir('');
    return { dir: '' };
  });

  // Auto-Post connection (autopost-unification): enable flag + status. When enabled,
  // the agent gains Auto-Post tools; the JWT is minted from the izzi/Supabase session.
  ipcMain.handle(
    'autopost:getStatus',
    async (): Promise<{ enabled: boolean; connected: boolean; backendUrl: string; workspaceId: string | null; accounts: number | null }> => {
      const enabled = dbManager.getSetting('autopost_enabled') === '1' || isSocialAutoPosterActive();
      let connected = false;
      let accounts: number | null = null;
      if (enabled) {
        const jwt = await autopostAuth.getJwt();
        connected = !!jwt;
        if (connected) {
          // Keep the extension's injected credentials fresh whenever status is checked.
          await syncAutopostExtensionCredentials();
          try {
            const r = await new AutopostClient(autopostAuth).listAccounts();
            if (r.ok && Array.isArray(r.data)) accounts = (r.data as unknown[]).length;
          } catch {
            /* status is best-effort */
          }
        }
      }
      return {
        enabled,
        connected,
        backendUrl: autopostAuth.baseUrl,
        workspaceId: autopostAuth.getWorkspaceId(),
        accounts,
      };
    },
  );
  ipcMain.handle('autopost:setEnabled', async (_event, enabled: boolean): Promise<{ ok: boolean; enabled: boolean }> => {
    dbManager.setSetting('autopost_enabled', enabled ? '1' : '0');
    if (enabled) await syncAutopostExtensionCredentials();
    else autopostAuth.clear();
    return { ok: true, enabled: !!enabled };
  });
  // Read surfaces for the in-app Auto-Post page (native, over the same REST bridge
  // + izzi JWT). The JWT stays in main; the renderer only ever sees plain data.
  ipcMain.handle(
    'autopost:listAccounts',
    async (): Promise<{ ok: boolean; accounts?: unknown[]; error?: string }> => {
      const r = await new AutopostClient(autopostAuth).listAccounts();
      if (!r.ok) return { ok: false, error: r.error };
      return { ok: true, accounts: Array.isArray(r.data) ? (r.data as unknown[]) : [] };
    },
  );
  ipcMain.handle(
    'autopost:listPosts',
    async (_event, status?: string): Promise<{ ok: boolean; posts?: unknown[]; error?: string }> => {
      const r = await new AutopostClient(autopostAuth).listPosts(typeof status === 'string' && status ? status : undefined);
      if (!r.ok) return { ok: false, error: r.error };
      // Normalize array | { items } | { data } → a plain array for the renderer.
      const d = r.data as unknown;
      const posts = Array.isArray(d)
        ? d
        : Array.isArray((d as { items?: unknown[] })?.items)
          ? (d as { items: unknown[] }).items
          : Array.isArray((d as { data?: unknown[] })?.data)
            ? (d as { data: unknown[] }).data
            : [];
      return { ok: true, posts };
    },
  );
  ipcMain.handle(
    'autopost:createDraft',
    async (_event, input: { content: string; title?: string }): Promise<{ ok: boolean; error?: string }> => {
      const content = typeof input?.content === 'string' ? input.content.trim() : '';
      if (!content) return { ok: false, error: 'empty' };
      const r = await new AutopostClient(autopostAuth).createDraft({
        content,
        title: typeof input?.title === 'string' && input.title.trim() ? input.title.trim() : undefined,
      });
      return r.ok ? { ok: true } : { ok: false, error: r.error };
    },
  );
  // Open the full Auto-Post web dashboard (campaigns/approvals/analytics) externally.
  ipcMain.handle('autopost:openWeb', async (): Promise<{ ok: boolean; url: string }> => {
    const url = (process.env.AUTOPOST_WEB_URL || 'http://127.0.0.1:3005').trim();
    try {
      await shell.openExternal(url);
      return { ok: true, url };
    } catch {
      return { ok: false, url };
    }
  });

  // Chat directly against the user-configured OpenAI-compatible endpoint
  // (codex-lb / 9router / any OpenAI-compatible). Streams content deltas to the
  // renderer via 'agentStream:event' (correlated by turnId) and returns the full
  // reply. The API key stays in main (SecretStore) and is redacted from errors.
  // In-flight host-agent turns (codex-lb path) keyed by turnId — powers the Stop
  // button (abort) + mid-turn steering (inject). runHostAgentTurn never throws, so
  // entries are cleaned up right after it resolves.
  const activeAgentTurns = new Map<string, { controller: AbortController; queue: string[] }>();

  ipcMain.handle(
    'customProvider:chat',
    async (
      event,
      payload: {
        message: string;
        history?: { role: string; content: string }[];
        turnId?: string;
        images?: string[];
      },
    ): Promise<{ reply?: string; error?: string }> => {
      const message = typeof payload?.message === 'string' ? payload.message.trim() : '';
      const turnId = typeof payload?.turnId === 'string' ? payload.turnId : '';
      const images = Array.isArray(payload?.images)
        ? payload.images.filter((u): u is string => typeof u === 'string' && u.startsWith('data:image/'))
        : [];
      if (!message && images.length === 0) return { error: 'empty' };

      const settings = new ProviderSettingsStore(dbManager);
      const secrets = new SecretStore(dbManager);
      if (!settings.isCustomEnabled()) return { error: 'disabled' };
      const cfg = settings.getConfig();
      const key = secrets.getKey();
      if (!cfg || !key) return { error: 'not-configured' };

      const history = Array.isArray(payload?.history)
        ? payload.history
            .filter(
              (m): m is { role: 'system' | 'user' | 'assistant'; content: string } =>
                !!m &&
                typeof m.content === 'string' &&
                (m.role === 'system' || m.role === 'user' || m.role === 'assistant'),
            )
            .slice(-8)
        : [];

      // Agent modes give the model host tools (run/read/write/list) with approval
      // gating — a real agent that acts on the machine. 'chat' keeps the plain
      // streaming text path below (reads images, answers, no host access).
      const permStore = new AgentPermissionStore(dbManager);
      const permMode = permStore.getMode();
      if (permMode === 'agent' || permMode === 'agent-full') {
        const win = BrowserWindow.fromWebContents(event.sender) ?? mainWindow;
        // Auto-Post tools: enabled by the manual flag OR by installing the Social
        // Auto Poster marketplace product. Gives the agent list/draft/schedule via
        // REST (JWT from the izzi session). Drafting is safe; scheduling is risk-gated.
        const autopostOn = dbManager.getSetting('autopost_enabled') === '1' || isSocialAutoPosterActive();
        const autopostClient = autopostOn ? new AutopostClient(autopostAuth) : null;
        const controller = new AbortController();
        const control = { controller, queue: [] as string[] };
        if (turnId) activeAgentTurns.set(turnId, control);
        const result = await runHostAgentTurn({
          config: cfg,
          apiKey: key,
          message,
          history,
          images,
          mode: permMode,
          workingDir: permStore.getWorkingDir(),
          turnId,
          signal: controller.signal,
          pollInjection: () => control.queue.shift(),
          redact: (t) => secrets.redact(t),
          extraTools: autopostClient ? AUTOPOST_TOOLS : undefined,
          executeExtra: autopostClient
            ? async (name, args) => (isAutopostTool(name) ? executeAutopostTool(autopostClient, name, args) : undefined)
            : undefined,
          classifyExtraRisk: autopostClient
            ? (name) => (isAutopostTool(name) ? classifyAutopostRisk(name) : undefined)
            : undefined,
          // The agent's live plan → real tasks on the Replay board (Todo/In-Progress/
          // Done). Written to the shared agent_tasks table + pushed live via the
          // 'agent:stream' task_upsert channel the board already listens on.
          onPlan: (steps) => {
            const now = new Date().toISOString();
            steps.forEach((s, i) => {
              const status: AgentTaskStatus =
                s.status === 'completed'
                  ? 'done'
                  : s.status === 'in_progress'
                    ? 'in_progress'
                    : s.status === 'blocked'
                      ? 'blocked'
                      : 'todo';
              const task: AgentTask = {
                id: `plan--${turnId || 'turn'}--${i}`,
                title: s.step.slice(0, 80),
                status,
                createdAt: now,
                updatedAt: now,
              };
              try {
                const saved = dbManager.upsertAgentTask(task);
                event.sender.send('agent:stream', { requestId: '', sessionId: '', type: 'task_upsert', task: saved });
              } catch {
                /* best-effort: a board write must never break the turn */
              }
            });
          },
          emit: (evt) => event.sender.send('agentStream:event', evt),
          requestApproval: async (req) => {
            if (!win || win.isDestroyed()) return 'deny';
            const r = await dialog.showMessageBox(win, {
              type: 'warning',
              buttons: ['Từ chối', 'Cho phép', 'Cho phép hết (lượt này)'],
              defaultId: 0,
              cancelId: 0,
              noLink: true,
              title: 'Agent yêu cầu quyền',
              message: 'Agent muốn thực hiện hành động trên máy của bạn:',
              detail: req.summary,
            });
            return r.response === 2 ? 'all' : r.response === 1 ? 'once' : 'deny';
          },
        });
        if (turnId) activeAgentTurns.delete(turnId);
        return result.error ? { error: result.error } : { reply: result.reply };
      }

      const provider = new CustomOpenAIProvider(cfg, key, (t) => secrets.redact(t));
      let reply = '';
      try {
        for await (const chunk of provider.streamChat({ sessionId: '', message, history, images })) {
          if (chunk.type === 'assistant_delta' && chunk.delta) {
            reply += chunk.delta;
            if (turnId) event.sender.send('agentStream:event', { turnId, kind: 'delta', text: chunk.delta });
          }
        }
      } catch (err) {
        return { error: secrets.redact(err instanceof Error ? err.message : String(err)) };
      }
      return { reply };
    },
  );

  // Stop an in-flight agent turn (Stop button). Aborts the streaming fetch; the
  // turn returns error 'aborted' and the partial answer already streamed stays.
  ipcMain.handle('customProvider:abort', (_event, turnId: string): { ok: boolean } => {
    const c = typeof turnId === 'string' ? activeAgentTurns.get(turnId) : undefined;
    if (!c) return { ok: false };
    c.controller.abort();
    return { ok: true };
  });

  // Inject a user "steering" message into a running turn; the agent folds it in
  // before its next model round so it can course-correct without a new turn.
  ipcMain.handle('customProvider:inject', (_event, turnId: string, text: string): { ok: boolean } => {
    const c = typeof turnId === 'string' ? activeAgentTurns.get(turnId) : undefined;
    const t = typeof text === 'string' ? text.trim() : '';
    if (!c || !t) return { ok: false };
    c.queue.push(t);
    return { ok: true };
  });

  ipcMain.handle('integrations:list', async () => {
    return integrationsService.list();
  });

  ipcMain.handle('integrations:beginConnect', async (_event, provider: IntegrationProvider) => {
    return integrationsService.beginConnect(provider);
  });

  ipcMain.handle('integrations:disconnect', async (_event, provider: IntegrationProvider) => {
    return integrationsService.disconnect(provider);
  });

  ipcMain.handle('onboarding:getState', async () => {
    return onboardingService.getState();
  });

  ipcMain.handle('onboarding:markSeen', async () => {
    return onboardingService.markSeen();
  });

  ipcMain.handle('onboarding:dismiss', async () => {
    return onboardingService.dismiss();
  });

  ipcMain.handle('onboarding:complete', async () => {
    return onboardingService.complete();
  });

  ipcMain.handle('updater:getState', async () => {
    return updaterService.getState();
  });

  ipcMain.handle('updater:check', async () => {
    await updaterService.check();
    return updaterService.getState();
  });

  ipcMain.handle('updater:download', async () => {
    await updaterService.download();
    return updaterService.getState();
  });

  ipcMain.handle('updater:quitAndInstall', async () => {
    updaterService.quitAndInstall();
    return { success: true };
  });
}

/**
 * Zero-config local model connection. If the machine exposes a codex-lb key in
 * the environment (CODEX_LB_API_KEY — the same var the Codex CLI uses) AND no
 * model connection is currently enabled, wire the app's custom provider to the
 * local codex-lb router (127.0.0.1:2455, gpt-5.5) and enable it, so the gateway's
 * non-izzi agents chat through it out of the box — no manual setup.
 *
 * Fires whenever nothing is enabled (not just first run) so it also repairs a
 * half-configured state — e.g. a connection that was saved by "Kiểm tra kết nối"
 * but never enabled, which otherwise leaves chat falling through to the empty
 * Hermes reply. An already-enabled connection is respected and left untouched;
 * the key value is only referenced by name (never logged).
 */
function autoConnectCodexLb(db: DatabaseManager): void {
  try {
    const envKey = (process.env.CODEX_LB_API_KEY || process.env.CODEX_LB_KEY || '').trim();
    if (!envKey) return;

    const settings = new ProviderSettingsStore(db);
    const secrets = new SecretStore(db);
    // Respect an active connection the user has enabled — don't clobber it.
    // But if nothing is enabled, chat can't reach any model, so wire local codex-lb.
    if (settings.isCustomEnabled()) return;

    settings.saveConfig({
      baseUrl: 'http://127.0.0.1:2455/v1',
      authType: 'bearer',
      selectedModel: 'gpt-5.5',
    });
    secrets.setKey(envKey);
    settings.setEnabled(true);
    db.appendDiagnosticEvent({
      type: 'model_connection.autoconnect',
      status: 'info',
      detail: 'Enabled local codex-lb connection from CODEX_LB_API_KEY env (no connection was active).',
    });
    console.log('[OpenClaw] Auto-connected local codex-lb (CODEX_LB_API_KEY present, no active connection)');
  } catch {
    // Best-effort: a failure here must never block startup.
  }
}

/** The loaded Social Auto Poster extension, if installed. */
function socialAutoPosterExt(): LoadedExtension | undefined {
  try {
    return extensionLoader?.getAllExtensions().find((e) => e.name === 'social-auto-poster');
  } catch {
    return undefined;
  }
}

/** True when the Social Auto Poster marketplace product is installed AND active. */
function isSocialAutoPosterActive(): boolean {
  return socialAutoPosterExt()?.state === 'running';
}

/**
 * Push the Auto-Post backend URL + a fresh JWT (+ workspace) into the Social Auto
 * Poster extension's storage so its commands hit Auto-Post with the izzi identity —
 * no separate login. Best-effort; the JWT is re-minted from the live session.
 */
async function syncAutopostExtensionCredentials(): Promise<void> {
  const ext = socialAutoPosterExt();
  if (!ext) return;
  const jwt = await autopostAuth.getJwt();
  if (!jwt) return;
  try {
    extensionLoader.setStoredExtensionValue(ext.id, 'setting.backendUrl', autopostAuth.baseUrl);
    extensionLoader.setStoredExtensionValue(ext.id, 'setting.apiKey', jwt);
    const ws = autopostAuth.getWorkspaceId();
    if (ws) extensionLoader.setStoredExtensionValue(ext.id, 'setting.workspaceId', ws);
  } catch {
    /* best-effort */
  }
}

async function initServices() {
  dbManager = new DatabaseManager();
  dbManager.initialize();

  // Zero-config: wire the app to a local codex-lb router when its key is in the
  // environment, so chat works without opening the "Kết nối Model" tab first.
  autoConnectCodexLb(dbManager);

  authManager = new AuthManager(dbManager);

  // Localhost LLM proxy for Docker agents (Hermes) — routes their upstream LLM
  // through the user's Izzi smart router; the credential stays in main. Started
  // eagerly (best-effort) so a container left running from a previous session
  // keeps reaching it on the persisted 127.0.0.1 port.
  izziLlmProxy = new IzziLlmProxy({
    resolveCredential: () => resolveIzziCredential(authManager),
    statePath: path.join(app.getPath('userData'), 'izzi-llm-proxy.json'),
  });
  dockerAgentService = new DockerAgentService(izziLlmProxy);
  try {
    await izziLlmProxy.ensureStarted();
  } catch (err: any) {
    console.warn('[IzziLlmProxy] Failed to start:', err?.message ?? 'unknown');
  }

  agentService = new AgentService({ db: dbManager, auth: authManager });
  autopostAuth = new AutopostAuth(authManager);
  integrationsService = new IntegrationsService(authManager, dbManager);
  onboardingService = new OnboardingService(dbManager);
  updaterService = new UpdaterService();
  setupWizardService = new SetupWizardService();
  syncEngine = new SyncEngine(authManager, dbManager);
  extensionManager = new ExtensionManager(dbManager);

  // Initialize Extension Runtime (Sprint 2B)
  extensionLoader = new ExtensionLoader(dbManager);
  extensionLoader.onUIRequest = (data) => {
    // Forward UI requests to renderer
    if (mainWindow) {
      mainWindow.webContents.send('extension:uiRequest', {
        extensionId: data.extensionId,
        action: data.action,
        args: data.args,
      });
      // For notifications, auto-respond
      if (data.action === 'showNotification') {
        data.respond(true);
      }
    } else {
      data.respond(null, 'No window available');
    }
  };

  try {
    await extensionLoader.initialize();
  } catch (err: any) {
    console.error('[OpenClaw] Extension loader init failed:', err.message);
  }

  // Start auto-update checker for installed extensions
  updateChecker = new ExtensionUpdateChecker(extensionLoader);
  updateChecker.start();

  agentService.on('stream', (event) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('agent:stream', event);
    }
  });

  updaterService.on('state-changed', (state) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('updater:state', state);
    }
  });

  console.log('[OpenClaw] Services initialized');
}

// Handle OAuth callback from custom protocol
function handleOAuthCallback(url: string) {
  if (url.startsWith('openclaw://auth/callback')) {
    authManager.handleOAuthCallback(url).then((result) => {
      if (result.success && mainWindow) {
        mainWindow.webContents.send('auth:oauthSuccess', result.user);
      }
    });
  }
}

// Single instance lock
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  app.quit();
} else {
  app.on('second-instance', (_event, commandLine) => {
    // Handle protocol URL on Windows
    const url = commandLine.find(arg => arg.startsWith('openclaw://'));
    if (url) handleOAuthCallback(url);

    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });
}

app.whenReady().then(async () => {
  await initServices();
  setupIPC();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });

  // Auto-refresh user profile when window regains focus
  // (syncs balance/plan after user tops up on izziapi.com)
  app.on('browser-window-focus', async () => {
    try {
      if (authManager && await authManager.isAuthenticated()) {
        const refreshed = await authManager.refreshProfile();
        if (refreshed && mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('auth:profileRefreshed', refreshed);
        }
      }
    } catch {
      // Silent fail — profile refresh is best-effort
    }
  });

  // Handle protocol URL on macOS
  app.on('open-url', (_event, url) => {
    handleOAuthCallback(url);
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

// Graceful shutdown — stop all extension hosts
app.on('before-quit', async () => {
  // FIRST + synchronous: SIGKILL extension host children now. They run as the
  // Electron binary (fork + ELECTRON_RUN_AS_NODE); before-quit is NOT awaited by
  // Electron, so the async shutdownAll below can't finish before the process
  // exits — without this, those children orphan and linger as "Izzi OpenClaw.exe",
  // which blocks the NSIS updater ("Izzi OpenClaw cannot be closed").
  if (extensionLoader) {
    try {
      extensionLoader.killAll();
    } catch {
      /* best-effort */
    }
  }
  if (updateChecker) {
    updateChecker.stop();
  }
  if (syncEngine) {
    syncEngine.destroy();
  }
  if (extensionLoader) {
    await extensionLoader.shutdownAll();
  }
  // Shutdown all running agent runtimes
  await shutdownAgents();
  if (izziLlmProxy) {
    await izziLlmProxy.stop();
  }
  if (dbManager) {
    dbManager.close();
  }
});
