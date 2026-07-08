/**
 * OpenClaw Extension Loader
 *
 * Manages the lifecycle of all extension host processes.
 * Acts as the bridge between the main Electron process and extension sandboxes.
 *
 * Responsibilities:
 * - Start/stop extension hosts
 * - Route storage, UI, and network requests
 * - Track running extensions
 * - Handle extension crashes and restarts
 */

import { app } from 'electron';
import * as path from 'path';
import * as fs from 'fs';
import { ExtensionHost, type ExtensionHostOptions } from './extension-host';
import { OcxInstaller } from './ocx-installer';
import type { OcxManifest } from './ocx-manifest';
import { resolveGrantedPermissions } from './permissions';
import { DatabaseManager } from '../db/database';

export interface LoadedExtension {
  id: string;
  name: string;
  manifest: OcxManifest;
  host: ExtensionHost | null;
  state: 'installed' | 'running' | 'stopped' | 'crashed' | 'disabled';
  grantedPermissions: string[];
  installPath: string;
}

export class ExtensionLoader {
  private extensions = new Map<string, LoadedExtension>();
  private db: DatabaseManager;
  private installer: OcxInstaller;
  private extensionsDir: string;

  // Callbacks for UI/storage delegation
  onUIRequest?: (data: any) => void;

  constructor(db: DatabaseManager) {
    this.db = db;
    this.installer = new OcxInstaller();
    this.extensionsDir = path.join(app.getPath('userData'), 'extensions');
  }

  /**
   * Scan extensions directory and load all installed extensions.
   */
  async initialize(): Promise<void> {
    console.log('[ExtLoader] Initializing...');

    const installedNames = this.installer.listInstalled();
    let loaded = 0;

    for (const name of installedNames) {
      const manifest = this.installer.readManifest(name);
      if (!manifest) continue;

      const extensionId = `ext-${name}`;
      const installPath = path.join(this.extensionsDir, name);

      // Check DB for granted permissions and enabled state
      const dbExt = this.db.getInstalledExtensions().find((e: any) => e.name === name);
      const isEnabled = dbExt ? dbExt.is_enabled === 1 : true;
      // Resolve granted permissions: use the stored grant if present, else fall
      // back to the manifest's declared permissions (the install-flow default) so
      // a disk-loaded extension isn't left with `[]` — which denied every
      // ctx.storage / ctx.net / ctx.ui call (broke commands + registerPanel).
      const storedPermissions = this.getStoredPermissions(extensionId);
      const grantedPermissions = resolveGrantedPermissions(storedPermissions, manifest.permissions);
      if (storedPermissions.length === 0 && grantedPermissions.length > 0) {
        this.storePermissions(extensionId, grantedPermissions); // persist the fallback
      }

      this.extensions.set(extensionId, {
        id: extensionId,
        name,
        manifest,
        host: null,
        state: isEnabled ? 'installed' : 'disabled',
        grantedPermissions,
        installPath,
      });

      loaded++;
    }

    console.log(`[ExtLoader] Found ${loaded} installed extensions`);

    // Auto-start extensions that have 'onStartup' activation event
    for (const [id, ext] of this.extensions) {
      if (ext.state === 'disabled') continue;
      if (ext.manifest.activationEvents?.includes('onStartup')) {
        try {
          await this.startExtension(id);
        } catch (err: any) {
          console.error(`[ExtLoader] Failed to auto-start ${ext.name}:`, err.message);
        }
      }
    }
  }

  /**
   * Start an extension's host process.
   */
  async startExtension(extensionId: string): Promise<void> {
    const ext = this.extensions.get(extensionId);
    if (!ext) throw new Error(`Extension "${extensionId}" not found`);
    if (ext.state === 'running') return;  // Already running
    if (ext.state === 'disabled') throw new Error('Extension is disabled');

    const host = new ExtensionHost({
      extensionId: ext.id,
      extensionPath: ext.installPath,
      manifest: ext.manifest,
      grantedPermissions: ext.grantedPermissions,
    });

    // Wire up event handlers
    host.on('storageRequest', (data: any) => {
      this.handleStorageRequest(data);
    });

    host.on('uiRequest', (data: any) => {
      if (this.onUIRequest) {
        this.onUIRequest(data);
      } else {
        data.respond(null, 'UI handler not available');
      }
    });

    host.on('crashed', () => {
      ext.state = 'crashed';
      ext.host = null;
      console.error(`[ExtLoader] Extension "${ext.name}" crashed`);
    });

    host.on('log', (msg: any) => {
      // Could forward to renderer for dev tools
    });

    ext.host = host;
    try {
      await host.start();
      ext.state = 'running';
    } catch (err) {
      ext.state = 'crashed';
      ext.host = null;
      throw err;
    }
  }

  /**
   * Stop an extension's host process.
   */
  async stopExtension(extensionId: string): Promise<void> {
    const ext = this.extensions.get(extensionId);
    if (!ext?.host) return;

    await ext.host.stop();
    ext.host = null;
    ext.state = 'installed';
  }

  /**
   * Enable an extension (allows starting).
   */
  enableExtension(extensionId: string): void {
    const ext = this.extensions.get(extensionId);
    if (!ext) throw new Error('Extension not found');
    ext.state = 'installed';
    this.db.setSetting(`ext_enabled_${extensionId}`, 'true');
  }

  /**
   * Disable an extension (stops if running).
   */
  async disableExtension(extensionId: string): Promise<void> {
    const ext = this.extensions.get(extensionId);
    if (!ext) throw new Error('Extension not found');

    if (ext.host) {
      await this.stopExtension(extensionId);
    }
    ext.state = 'disabled';
    this.db.setSetting(`ext_enabled_${extensionId}`, 'false');
  }

  /**
   * Execute a command on a running extension.
   */
  async executeCommand(extensionId: string, commandId: string, ...args: any[]): Promise<any> {
    const ext = this.extensions.get(extensionId);
    if (!ext?.host) throw new Error('Extension is not running');
    return ext.host.executeCommand(commandId, ...args);
  }

  /**
   * Install a new extension from directory.
   */
  async installExtension(sourceDir: string, permissions?: string[]): Promise<LoadedExtension> {
    const result = await this.installer.installFromDirectory(sourceDir);
    if (!result.success || !result.manifest || !result.installPath) {
      throw new Error(result.error || 'Installation failed');
    }

    const ext: LoadedExtension = {
      id: result.extensionId!,
      name: result.manifest.name,
      manifest: result.manifest,
      host: null,
      state: 'installed',
      grantedPermissions: permissions || result.manifest.permissions || [],
      installPath: result.installPath,
    };

    this.extensions.set(ext.id, ext);

    // Store permissions in DB
    this.storePermissions(ext.id, ext.grantedPermissions);

    // Register in DB
    this.db.addExtension({
      id: ext.id,
      name: ext.name,
      displayName: ext.manifest.displayName,
      version: ext.manifest.version,
      description: ext.manifest.description,
      author: ext.manifest.author?.name,
      installPath: ext.installPath,
    });

    return ext;
  }

  /**
   * Install from .ocx file.
   */
  async installFromOcx(filePath: string, permissions?: string[]): Promise<LoadedExtension> {
    const result = await this.installer.installFromFile(filePath);
    if (!result.success || !result.manifest || !result.installPath) {
      throw new Error(result.error || 'Installation failed');
    }

    const ext: LoadedExtension = {
      id: result.extensionId!,
      name: result.manifest.name,
      manifest: result.manifest,
      host: null,
      state: 'installed',
      grantedPermissions: permissions || result.manifest.permissions || [],
      installPath: result.installPath,
    };

    this.extensions.set(ext.id, ext);
    this.storePermissions(ext.id, ext.grantedPermissions);

    this.db.addExtension({
      id: ext.id,
      name: ext.name,
      displayName: ext.manifest.displayName,
      version: ext.manifest.version,
      description: ext.manifest.description,
      author: ext.manifest.author?.name,
      installPath: ext.installPath,
    });

    return ext;
  }

  /**
   * Uninstall an extension.
   */
  async uninstallExtension(extensionId: string): Promise<void> {
    const ext = this.extensions.get(extensionId);
    if (!ext) throw new Error('Extension not found');

    // Stop if running
    if (ext.host) {
      await this.stopExtension(extensionId);
    }

    // Remove from disk
    await this.installer.uninstall(ext.name);

    // Remove from DB
    this.db.removeExtension(extensionId);
    this.db.deleteSetting(`ext_permissions_${extensionId}`);
    this.db.deleteSetting(`ext_enabled_${extensionId}`);

    // Remove from memory
    this.extensions.delete(extensionId);
  }

  /**
   * Update granted permissions for an extension.
   */
  updatePermissions(extensionId: string, permissions: string[]): void {
    const ext = this.extensions.get(extensionId);
    if (!ext) throw new Error('Extension not found');
    ext.grantedPermissions = permissions;
    this.storePermissions(extensionId, permissions);
  }

  /**
   * Get all loaded extensions.
   */
  getAllExtensions(): LoadedExtension[] {
    return Array.from(this.extensions.values());
  }

  /**
   * Get a single extension by ID.
   */
  getExtension(extensionId: string): LoadedExtension | undefined {
    return this.extensions.get(extensionId);
  }

  /**
   * Read a stored value for an extension using the SAME keyspace the extension's
   * `ctx.storage.get(key)` reads (`extdata_<id>_<key>`). Lets the settings UI
   * pre-fill values the extension will actually see.
   */
  getStoredExtensionValue(extensionId: string, key: string): unknown {
    const raw = this.db.getSetting(`extdata_${extensionId}_${key}`);
    try {
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  }

  /**
   * Write a stored value for an extension, readable by the extension via
   * `ctx.storage.get(key)`. Used by the settings UI to persist config.
   */
  setStoredExtensionValue(extensionId: string, key: string, value: unknown): void {
    this.db.setSetting(`extdata_${extensionId}_${key}`, JSON.stringify(value));
  }

  /**
   * Synchronously SIGKILL every running extension host. Called on app quit so the
   * forked runner processes (which run as the Electron binary) cannot linger as
   * orphaned "Izzi OpenClaw.exe" processes and block the NSIS updater. Runs before
   * Electron proceeds to quit (unlike the async shutdownAll). Never throws.
   */
  killAll(): void {
    for (const ext of this.extensions.values()) {
      if (ext.host) {
        try {
          ext.host.forceKill();
        } catch {
          // best-effort — keep killing the rest
        }
        ext.host = null;
        ext.state = 'stopped';
      }
    }
  }

  /**
   * Shutdown all running extensions.
   */
  async shutdownAll(): Promise<void> {
    const running = Array.from(this.extensions.values()).filter(e => e.host);
    await Promise.allSettled(running.map(e => this.stopExtension(e.id)));
    console.log('[ExtLoader] All extensions stopped');
  }

  // ── Private helpers ──

  private handleStorageRequest(data: any): void {
    const { extensionId, requestId, action, key, value, respond } = data;
    const storagePrefix = `extdata_${extensionId}_`;

    try {
      switch (action) {
        case 'get': {
          const raw = this.db.getSetting(`${storagePrefix}${key}`);
          respond(raw ? JSON.parse(raw) : null);
          break;
        }
        case 'set': {
          this.db.setSetting(`${storagePrefix}${key}`, JSON.stringify(value));
          respond(true);
          break;
        }
        case 'delete': {
          this.db.deleteSetting(`${storagePrefix}${key}`);
          respond(true);
          break;
        }
        case 'keys': {
          // For simplicity, return empty array (full implementation would query by prefix)
          respond([]);
          break;
        }
        default:
          respond(null, `Unknown storage action: ${action}`);
      }
    } catch (err: any) {
      respond(null, err.message);
    }
  }

  private storePermissions(extensionId: string, permissions: string[]): void {
    this.db.setSetting(`ext_permissions_${extensionId}`, JSON.stringify(permissions));
  }

  private getStoredPermissions(extensionId: string): string[] {
    const raw = this.db.getSetting(`ext_permissions_${extensionId}`);
    try {
      return raw ? JSON.parse(raw) : [];
    } catch {
      return [];
    }
  }
}
