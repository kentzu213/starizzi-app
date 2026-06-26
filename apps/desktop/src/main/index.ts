import { app, BrowserWindow, ipcMain, shell, dialog, nativeImage } from 'electron';
import * as path from 'path';
import { execFile } from 'child_process';
import { AuthManager } from './auth/auth-manager';
import { DatabaseManager } from './db/database';
import { SyncEngine } from './sync/sync-engine';
import { GraphClient } from './graph/graph-client';
import { registerGraphIpc } from './graph/graph-ipc';
import { ExtensionManager } from './extensions/manager';
import { ExtensionLoader } from './extensions/extension-loader';
import { PERMISSION_DEFINITIONS } from './extensions/permissions';
import { installFromMarketplace } from './extensions/marketplace-download';
import { ExtensionUpdateChecker } from './extensions/update-checker';
import { AgentService } from './agent/agent-service';
import { IntegrationsService } from './integrations/integrations-service';
import { OnboardingService } from './onboarding/onboarding-service';
import type { AgentTaskStatus, IntegrationProvider } from './agent/types';
import { UpdaterService } from './updater/updater-service';
import { SetupWizardService } from './setup/setup-wizard-service';
import { registerAgentIpcHandlers, shutdownAgents } from './agents';
import { DockerAgentService, type DockerAgentPayload } from './agents/docker-agent-service';

let mainWindow: BrowserWindow | null = null;
let authManager: AuthManager;
let dbManager: DatabaseManager;
let syncEngine: SyncEngine;
let extensionManager: ExtensionManager;
let extensionLoader: ExtensionLoader;
let updateChecker: ExtensionUpdateChecker;
let agentService: AgentService;
let integrationsService: IntegrationsService;
let onboardingService: OnboardingService;
let updaterService: UpdaterService;
let setupWizardService: SetupWizardService;
const dockerAgentService = new DockerAgentService();

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

  if (isDev) {
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

  ipcMain.handle('dockerAgent:chat', async (_event, payload: DockerAgentPayload, message: string) => {
    return dockerAgentService.chat(payload, message);
  });

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

async function initServices() {
  dbManager = new DatabaseManager();
  dbManager.initialize();

  authManager = new AuthManager(dbManager);
  agentService = new AgentService({ db: dbManager, auth: authManager });
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
  if (dbManager) {
    dbManager.close();
  }
});
