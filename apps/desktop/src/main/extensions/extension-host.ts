/**
 * OpenClaw Extension Host Process
 *
 * Runs extensions in isolated child_process (fork) for security.
 * Each extension gets its own process with limited API surface.
 *
 * Architecture:
 *   main process → ExtensionHost → child_process (fork)
 *                                    ↕ IPC messages
 *                                  extension code (sandboxed)
 *
 * Security model:
 * - Extensions run in separate Node.js process
 * - No direct access to Electron APIs, BrowserWindow, or main process
 * - All capabilities are permission-gated through message passing
 * - Process killed on timeout or excessive resource usage
 */

import { fork, ChildProcess } from 'child_process';
import * as path from 'path';
import { EventEmitter } from 'events';
import { hasPermission } from './permissions';
import type { HostToExtMessage, ExtToHostMessage } from './extension-api';
import type { OcxManifest } from './ocx-manifest';

const ACTIVATION_TIMEOUT_MS = 10_000;  // 10s to activate
const COMMAND_TIMEOUT_MS = 30_000;     // 30s per command
const MAX_MEMORY_MB = 256;             // Kill if exceeds
const MAX_CRASH_RESTARTS = 3;          // Auto-restart up to 3 times
const RESTART_BACKOFF_MS = 1000;       // Base backoff: 1s, 2s, 4s

export interface ExtensionHostOptions {
  extensionId: string;
  extensionPath: string;
  manifest: OcxManifest;
  grantedPermissions: string[];
}

type ExtensionHostState = 'idle' | 'starting' | 'running' | 'stopping' | 'stopped' | 'crashed' | 'disabled';

export class ExtensionHost extends EventEmitter {
  private process: ChildProcess | null = null;
  private state: ExtensionHostState = 'idle';
  private pendingRequests = new Map<string, {
    resolve: (data: any) => void;
    reject: (err: Error) => void;
    timer: ReturnType<typeof setTimeout>;
  }>();
  private requestCounter = 0;
  private crashCount = 0;

  readonly extensionId: string;
  readonly extensionPath: string;
  readonly manifest: OcxManifest;
  readonly grantedPermissions: string[];

  constructor(options: ExtensionHostOptions) {
    super();
    this.extensionId = options.extensionId;
    this.extensionPath = options.extensionPath;
    this.manifest = options.manifest;
    this.grantedPermissions = options.grantedPermissions;
  }

  getState(): ExtensionHostState {
    return this.state;
  }

  /**
   * Start the extension host process and activate the extension.
   */
  async start(): Promise<void> {
    if (this.state !== 'idle' && this.state !== 'stopped' && this.state !== 'crashed') {
      throw new Error(`Cannot start: host is in state "${this.state}"`);
    }

    this.state = 'starting';
    console.log(`[ExtHost:${this.extensionId}] Starting...`);

    try {
      // Fork the extension runner script. A forked child runs as plain Node
      // (ELECTRON_RUN_AS_NODE) and CANNOT execute a script from inside app.asar,
      // so the runner is asarUnpack'd — point the fork at the real unpacked copy
      // when packaged (no-op in dev, where there is no asar in the path).
      const runnerPath = path
        .join(__dirname, 'extension-runner.js')
        .replace(/app\.asar([\\/])/, 'app.asar.unpacked$1');
      this.process = fork(runnerPath, [], {
        cwd: this.extensionPath,
        stdio: ['pipe', 'pipe', 'pipe', 'ipc'],
        env: {
          NODE_ENV: process.env.NODE_ENV || 'production',
          // Names MUST match what extension-runner reads (OPENCLAW_EXT_ID/PATH).
          OPENCLAW_EXT_ID: this.extensionId,
          OPENCLAW_EXT_PATH: this.extensionPath,
          // Explicitly do NOT pass sensitive env vars
        },
        execArgv: [
          `--max-old-space-size=${MAX_MEMORY_MB}`,
        ],
      });

      // Capture stdout/stderr for logging
      this.process.stdout?.on('data', (data: Buffer) => {
        console.log(`[Ext:${this.extensionId}:stdout]`, data.toString().trim());
      });
      this.process.stderr?.on('data', (data: Buffer) => {
        console.error(`[Ext:${this.extensionId}:stderr]`, data.toString().trim());
      });

      // Handle messages from extension
      this.process.on('message', (msg: ExtToHostMessage) => {
        this.handleMessage(msg);
      });

      // Handle process exit
      this.process.on('exit', (code, signal) => {
        console.log(`[ExtHost:${this.extensionId}] Process exited: code=${code}, signal=${signal}`);
        if (this.state !== 'stopping') {
          this.state = 'crashed';
          this.emit('crashed', { code, signal });
          this.rejectAllPending('Extension process terminated');
          this.process = null;

          // Auto-restart with backoff
          this.crashCount++;
          if (this.crashCount <= MAX_CRASH_RESTARTS) {
            const delay = RESTART_BACKOFF_MS * Math.pow(2, this.crashCount - 1);
            console.log(`[ExtHost:${this.extensionId}] Auto-restart ${this.crashCount}/${MAX_CRASH_RESTARTS} in ${delay}ms...`);
            setTimeout(() => {
              this.start().catch((err) => {
                console.error(`[ExtHost:${this.extensionId}] Restart failed:`, err.message);
              });
            }, delay);
          } else {
            console.error(`[ExtHost:${this.extensionId}] Max restarts (${MAX_CRASH_RESTARTS}) exceeded — disabling extension`);
            this.state = 'disabled';
            this.emit('disabled', { reason: 'max_restarts_exceeded', crashCount: this.crashCount });
          }
        } else {
          this.state = 'stopped';
          this.rejectAllPending('Extension process terminated');
          this.process = null;
        }
      });

      this.process.on('error', (err) => {
        console.error(`[ExtHost:${this.extensionId}] Process error:`, err.message);
        this.state = 'crashed';
        this.emit('error', err);
      });

      // Wait for 'ready' message, then send activate
      await this.waitForReady();

      // Send activate command
      await this.activate();

      this.state = 'running';
      this.emit('started');
      console.log(`[ExtHost:${this.extensionId}] Running ✅`);
    } catch (err) {
      this.state = 'crashed';
      this.kill();
      throw err;
    }
  }

  /**
   * Stop the extension gracefully.
   */
  async stop(): Promise<void> {
    if (this.state !== 'running') return;

    this.state = 'stopping';
    console.log(`[ExtHost:${this.extensionId}] Stopping...`);

    try {
      this.sendToExtension({ type: 'deactivate' });
      // Give extension 5s to cleanup
      await new Promise<void>((resolve) => {
        const timer = setTimeout(() => {
          console.warn(`[ExtHost:${this.extensionId}] Deactivation timeout, force killing`);
          resolve();
        }, 5000);

        const handler = (msg: ExtToHostMessage) => {
          if (msg.type === 'deactivated') {
            clearTimeout(timer);
            resolve();
          }
        };
        this.once('_deactivated', handler as any);
      });
    } catch {
      // Ignore errors during deactivation
    }

    this.kill();
    this.state = 'stopped';
    this.emit('stopped');
  }

  /**
   * Execute a command registered by the extension.
   */
  async executeCommand(commandId: string, ...args: any[]): Promise<any> {
    if (this.state !== 'running') {
      throw new Error('Extension is not running');
    }

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error(`Command "${commandId}" timed out after ${COMMAND_TIMEOUT_MS}ms`));
      }, COMMAND_TIMEOUT_MS);

      // Listen for command result
      const handler = (msg: ExtToHostMessage) => {
        if (msg.type === 'commandResult' && msg.commandId === commandId) {
          clearTimeout(timer);
          this.removeListener('_message', handler as any);
          if (msg.error) {
            reject(new Error(msg.error));
          } else {
            resolve(msg.result);
          }
        }
      };
      this.on('_message', handler as any);

      this.sendToExtension({ type: 'executeCommand', commandId, args });
    });
  }

  // ── Private methods ──

  private sendToExtension(msg: HostToExtMessage): void {
    if (this.process?.connected) {
      this.process.send(msg);
    }
  }

  private waitForReady(): Promise<void> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error('Extension runner did not become ready within timeout'));
      }, ACTIVATION_TIMEOUT_MS);

      const handler = (msg: ExtToHostMessage) => {
        if (msg.type === 'ready') {
          clearTimeout(timer);
          resolve();
        }
      };
      // Temporarily listen on raw process messages
      this.process?.once('message', handler as any);
    });
  }

  private activate(): Promise<void> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error(`Extension "${this.extensionId}" failed to activate within ${ACTIVATION_TIMEOUT_MS}ms`));
      }, ACTIVATION_TIMEOUT_MS);

      const handler = (msg: ExtToHostMessage) => {
        if (msg.type === 'activated') {
          clearTimeout(timer);
          if (msg.success) {
            resolve();
          } else {
            reject(new Error(msg.error || 'Activation failed'));
          }
        }
      };
      this.once('_activated', handler as any);

      this.sendToExtension({
        type: 'activate',
        extensionId: this.extensionId,
        extensionPath: this.extensionPath,
      });
    });
  }

  private handleMessage(msg: ExtToHostMessage): void {
    switch (msg.type) {
      case 'activated':
        this.emit('_activated', msg);
        break;

      case 'deactivated':
        this.emit('_deactivated', msg);
        break;

      case 'commandResult':
        this.emit('_message', msg);
        break;

      case 'log':
        console.log(`[Ext:${this.extensionId}:${msg.level}]`, msg.message, ...msg.args);
        this.emit('log', msg);
        break;

      case 'storageRequest':
        this.handleStorageRequest(msg);
        break;

      case 'netRequest':
        this.handleNetRequest(msg);
        break;

      case 'uiRequest':
        this.handleUIRequest(msg);
        break;

      case 'error':
        console.error(`[Ext:${this.extensionId}:ERROR]`, msg.message);
        this.emit('extensionError', msg);
        break;
    }
  }

  private handleStorageRequest(msg: ExtToHostMessage & { type: 'storageRequest' }): void {
    if (!hasPermission(this.grantedPermissions, 'storage.local')) {
      this.sendToExtension({
        type: 'storageResponse',
        requestId: msg.requestId,
        data: null,
        error: 'Permission denied: storage.local',
      });
      return;
    }

    // Delegate to main process storage handler
    this.emit('storageRequest', {
      extensionId: this.extensionId,
      requestId: msg.requestId,
      action: msg.action,
      key: msg.key,
      value: msg.value,
      respond: (data: any, error?: string) => {
        this.sendToExtension({
          type: 'storageResponse',
          requestId: msg.requestId,
          data,
          error,
        });
      },
    });
  }

  private async handleNetRequest(msg: ExtToHostMessage & { type: 'netRequest' }): Promise<void> {
    if (!hasPermission(this.grantedPermissions, 'net.http')) {
      this.sendToExtension({
        type: 'netResponse',
        requestId: msg.requestId,
        data: null,
        error: 'Permission denied: net.http',
      });
      return;
    }

    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), msg.options?.timeout || 30_000);

      const response = await fetch(msg.url, {
        method: msg.options?.method || 'GET',
        headers: msg.options?.headers,
        body: msg.options?.body,
        signal: controller.signal,
      });

      clearTimeout(timeout);

      const body = await response.text();
      const headers: Record<string, string> = {};
      response.headers.forEach((v, k) => { headers[k] = v; });

      this.sendToExtension({
        type: 'netResponse',
        requestId: msg.requestId,
        data: { status: response.status, headers, body },
      });
    } catch (err: any) {
      this.sendToExtension({
        type: 'netResponse',
        requestId: msg.requestId,
        data: null,
        error: err.message,
      });
    }
  }

  private handleUIRequest(msg: ExtToHostMessage & { type: 'uiRequest' }): void {
    const action = msg.action;
    const requiredPerm = action === 'showNotification' ? 'ui.notification'
      : action === 'showConfirm' ? 'ui.dialog'
        : action === 'registerPanel' || action === 'updatePanel' ? 'ui.panel'
          : null;

    if (requiredPerm && !hasPermission(this.grantedPermissions, requiredPerm)) {
      this.sendToExtension({
        type: 'uiResponse',
        requestId: msg.requestId,
        data: null,
        error: `Permission denied: ${requiredPerm}`,
      });
      return;
    }

    // Delegate to main process UI handler
    this.emit('uiRequest', {
      extensionId: this.extensionId,
      requestId: msg.requestId,
      action: msg.action,
      args: msg.args,
      respond: (data: any, error?: string) => {
        this.sendToExtension({
          type: 'uiResponse',
          requestId: msg.requestId,
          data,
          error,
        });
      },
    });
  }

  /**
   * Immediately terminate the host child with SIGKILL (no graceful deactivate).
   * Used on app quit: the forked runner runs as the Electron binary
   * (ELECTRON_RUN_AS_NODE), so if it's left orphaned it lingers as an extra
   * "Izzi OpenClaw.exe" process and blocks the NSIS updater ("app cannot be
   * closed"). Sets state to 'stopping' FIRST so the exit handler does not
   * auto-restart the extension. Synchronous + best-effort — never throws.
   */
  forceKill(): void {
    this.state = 'stopping';
    try {
      this.process?.kill('SIGKILL');
    } catch {
      // already dead
    }
    this.process = null;
    this.rejectAllPending('Extension host killed (app quitting)');
  }

  private kill(): void {
    if (this.process) {
      try {
        this.process.kill('SIGTERM');
        // Force kill after 2s
        setTimeout(() => {
          try { this.process?.kill('SIGKILL'); } catch { /* already dead */ }
        }, 2000);
      } catch {
        // Process already exited
      }
    }
    this.rejectAllPending('Extension host killed');
  }

  private rejectAllPending(reason: string): void {
    for (const [, req] of this.pendingRequests) {
      clearTimeout(req.timer);
      req.reject(new Error(reason));
    }
    this.pendingRequests.clear();
  }
}
