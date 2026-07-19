import { execFile, exec } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import * as https from 'https';

// Credits: Setup wizard logic adapted and rewritten from
// tuanminhhole/openclaw-setup (wizard flow) and kentzu213/izzi-openclaw (API integration).
// Original sources: https://github.com/tuanminhhole/openclaw-setup
//                   https://github.com/kentzu213/izzi-openclaw

// ── Types ──

export type OSType = 'windows' | 'macos' | 'linux';
export type ChannelType = 'telegram' | 'telegram-multi' | 'zalo-bot' | 'zalo-personal' | 'combo';
export type AIProvider = 'izzi' | '9router' | 'gemini' | 'claude' | 'gpt4o' | 'openrouter' | 'ollama' | 'custom';

export interface SystemCheckResult {
  os: OSType;
  osVersion: string;
  nodeInstalled: boolean;
  nodeVersion: string | null;
  dockerInstalled: boolean;
  dockerRunning: boolean;
  openclawInstalled: boolean;
  openclawPath: string | null;
  openclawVersion: string | null;
  recommended: 'docker' | 'native';
}

export interface WizardConfig {
  channel: ChannelType;
  provider: AIProvider;
  telegramTokens: string[];      // 1-5 tokens
  zaloAppId?: string;
  zaloAppSecret?: string;
  zaloRefreshToken?: string;
  apiKey: string;                 // Izzi API key or provider key
  baseUrl?: string;               // API base URL
  selectedModels: string[];       // e.g. ['izzi-smart', 'grok-4.5-high', ...]
  installMode: 'docker' | 'native';
  autoStart: boolean;
  enableSkills: boolean;
  enablePlugins: boolean;
  agentId?: string;               // Chosen agent runtime: 'openclaw' | 'hermes' | 'autogpt' | ...
}

export interface SetupProgress {
  step: string;
  percent: number;
  message: string;
  isError: boolean;
}

// ── Izzi API Models ──

const IZZI_MODELS = [
  { id: 'izzi-smart', name: 'Izzi Smart Router', description: 'Auto-select the best healthy model' },
  { id: 'grok-4.5-high', name: 'Grok 4.5 High', description: 'Explicit Grok route via SmartRouter/9Router' },
  { id: 'gpt-5.6-sol', name: 'GPT-5.6 Sol', description: 'Explicit Sol route via SmartRouter/Codex-LB' },
  { id: 'gpt-5.5', name: 'GPT-5.5', description: 'Latest GPT model' },
  { id: 'gpt-5.4', name: 'GPT-5.4', description: 'Latest GPT model' },
  { id: 'gpt-5.2', name: 'GPT-5.2', description: 'Fast & reliable' },
  { id: 'gpt-5.1-codex', name: 'GPT-5.1 Codex', description: 'Optimized for code' },
  { id: 'claude-4-sonnet', name: 'Claude 4 Sonnet', description: 'Balanced intelligence' },
  { id: 'claude-4-haiku', name: 'Claude 4 Haiku', description: 'Fast responses' },
  { id: 'gemini-2.5-pro', name: 'Gemini 2.5 Pro', description: 'Google flagship' },
  { id: 'gemini-2.5-flash', name: 'Gemini 2.5 Flash', description: 'Ultra fast' },
];

const IZZI_API_BASE = 'https://api.izziapi.com';

// ── Service ──

export class SetupWizardService {
  private progressCallback: ((progress: SetupProgress) => void) | null = null;

  onProgress(callback: (progress: SetupProgress) => void) {
    this.progressCallback = callback;
  }

  private emit(step: string, percent: number, message: string, isError = false) {
    this.progressCallback?.({ step, percent, message, isError });
  }

  // ── Step 1: System Check ──

  async checkSystem(): Promise<SystemCheckResult> {
    const osType = this.detectOS();
    const osVersion = `${os.type()} ${os.release()}`;
    const nodeCheck = await this.checkNode();
    const dockerCheck = await this.checkDocker();
    const openclawCheck = await this.checkOpenClaw();

    // Always recommend Docker per user requirement — provides isolation and consistency
    const recommended: 'docker' | 'native' = 'docker';

    return {
      os: osType,
      osVersion,
      nodeInstalled: nodeCheck.installed,
      nodeVersion: nodeCheck.version,
      dockerInstalled: dockerCheck.installed,
      dockerRunning: dockerCheck.running,
      openclawInstalled: openclawCheck.installed,
      openclawPath: openclawCheck.path,
      openclawVersion: openclawCheck.version,
      recommended,
    };
  }

  private detectOS(): OSType {
    switch (process.platform) {
      case 'win32': return 'windows';
      case 'darwin': return 'macos';
      default: return 'linux';
    }
  }

  private async checkNode(): Promise<{ installed: boolean; version: string | null }> {
    return new Promise((resolve) => {
      execFile('node', ['--version'], (error, stdout) => {
        if (error || !stdout.trim()) {
          resolve({ installed: false, version: null });
          return;
        }
        resolve({ installed: true, version: stdout.trim() });
      });
    });
  }

  private async checkDocker(): Promise<{ installed: boolean; running: boolean }> {
    return new Promise((resolve) => {
      execFile('docker', ['info'], (error) => {
        if (error) {
          // Check if docker exists but isn't running
          execFile('docker', ['--version'], (err2) => {
            resolve({ installed: !err2, running: false });
          });
          return;
        }
        resolve({ installed: true, running: true });
      });
    });
  }

  private async checkOpenClaw(): Promise<{ installed: boolean; path: string | null; version: string | null }> {
    const findCmd = process.platform === 'win32' ? 'where' : 'which';
    return new Promise((resolve) => {
      execFile(findCmd, ['openclaw'], (error, stdout) => {
        if (error || !stdout.trim()) {
          // Check common install paths
          const commonPaths = this.getCommonOpenClawPaths();
          for (const p of commonPaths) {
            if (fs.existsSync(p)) {
              resolve({ installed: true, path: p, version: null });
              return;
            }
          }
          resolve({ installed: false, path: null, version: null });
          return;
        }
        const clawPath = stdout.split(/\r?\n/).map(l => l.trim()).find(Boolean) || null;
        resolve({ installed: true, path: clawPath, version: null });
      });
    });
  }

  private getCommonOpenClawPaths(): string[] {
    const home = os.homedir();
    if (process.platform === 'win32') {
      return [
        path.join(home, '.openclaw', 'openclaw.exe'),
        path.join('C:', 'Program Files', 'OpenClaw', 'openclaw.exe'),
        path.join(home, 'AppData', 'Local', 'Programs', 'openclaw', 'openclaw.exe'),
      ];
    }
    return [
      path.join(home, '.openclaw', 'openclaw'),
      '/usr/local/bin/openclaw',
      '/usr/bin/openclaw',
    ];
  }

  // ── Step 3: Verify Izzi API Key ──

  async verifyIzziApiKey(apiKey: string): Promise<{ valid: boolean; models: string[]; error?: string }> {
    return new Promise((resolve) => {
      const url = new URL('/v1/models', IZZI_API_BASE);
      const options = {
        hostname: url.hostname,
        path: url.pathname,
        method: 'GET',
        headers: {
          'x-api-key': apiKey,
          'Content-Type': 'application/json',
          'X-Source-Platform': 'starizzi',
        },
      };

      const req = https.request(options, (res) => {
        let body = '';
        res.on('data', (chunk) => { body += chunk; });
        res.on('end', () => {
          if (res.statusCode === 200) {
            try {
              const data = JSON.parse(body);
              const models = data?.data?.map((m: any) => m.id) || [];
              resolve({ valid: true, models });
            } catch {
              resolve({ valid: true, models: IZZI_MODELS.map(m => m.id) });
            }
          } else if (res.statusCode === 401 || res.statusCode === 403) {
            resolve({ valid: false, models: [], error: 'API key không hợp lệ hoặc đã hết hạn' });
          } else {
            resolve({ valid: false, models: [], error: `Server trả về mã ${res.statusCode}` });
          }
        });
      });

      req.on('error', (err) => {
        resolve({ valid: false, models: [], error: `Không thể kết nối: ${err.message}` });
      });

      req.setTimeout(10000, () => {
        req.destroy();
        resolve({ valid: false, models: [], error: 'Timeout — không thể kết nối tới Izzi API' });
      });

      req.end();
    });
  }

  // ── Step 5: Execute Full Setup ──

  async executeSetup(config: WizardConfig, systemInfo: SystemCheckResult): Promise<boolean> {
    try {
      this.emit('prepare', 5, '🔍 Kiểm tra hệ thống...');

      // 1. Verify API key for Izzi provider
      if (config.provider === 'izzi') {
        this.emit('verify', 10, '🔑 Xác thực Izzi API key...');
        const verification = await this.verifyIzziApiKey(config.apiKey);
        if (!verification.valid) {
          this.emit('verify', 10, `❌ ${verification.error}`, true);
          return false;
        }
        this.emit('verify', 20, '✅ API key hợp lệ!');
      }

      this.emit('config', 25, '📁 Tìm thư mục cấu hình OpenClaw...');
      const configDir = this.findOrCreateConfigDir();
      if (!configDir) {
        this.emit('config', 25, '❌ Không thể tạo thư mục cấu hình.', true);
        return false;
      }
      this.emit('config', 30, `📁 Config: ${configDir}`);

      // 2b. Auto-install OpenClaw if not found
      if (!systemInfo.openclawInstalled) {
        this.emit('install-oc', 32, '📦 OpenClaw chưa cài — đang tự động cài đặt...');
        const installResult = await this.installOpenClaw(systemInfo.os, config.installMode);
        if (!installResult.success) {
          this.emit('install-oc', 35, `⚠️ Cài tự động không thành công: ${installResult.error}. Tiếp tục cấu hình...`);
          // Non-fatal: continue with config, user can install manually later
        } else {
          this.emit('install-oc', 40, `✅ OpenClaw đã cài tại: ${installResult.path || 'system PATH'}`);
        }
      }

      // 3. Write openclaw.json config
      this.emit('config', 35, '⚙️ Ghi cấu hình openclaw.json...');
      await this.writeOpenClawConfig(configDir, config);
      this.emit('config', 45, '✅ Cấu hình đã ghi thành công!');

      // 4. Write agent config (bot tokens, channel settings)
      this.emit('agent', 50, '🤖 Cấu hình bot agent...');
      await this.writeAgentConfig(configDir, config);
      this.emit('agent', 60, '✅ Agent đã cấu hình!');

      // 5. Register AI models
      if (config.provider === 'izzi') {
        this.emit('models', 65, '🧠 Đăng ký models Izzi API...');
        await this.registerIzziModels(configDir, config);
        this.emit('models', 75, '✅ Models đã đăng ký!');
      }

      // 6. Generate startup scripts
      this.emit('scripts', 80, '📝 Tạo startup scripts...');
      await this.generateStartupScripts(configDir, config, systemInfo);
      this.emit('scripts', 85, '✅ Scripts đã tạo!');

      // 7. Setup auto-start (optional)
      if (config.autoStart && systemInfo.os === 'windows') {
        this.emit('autostart', 88, '⏰ Cài đặt tự khởi động...');
        await this.setupAutoStart(configDir);
        this.emit('autostart', 92, '✅ Auto-start đã cài!');
      }

      // 8. Try to start OpenClaw gateway
      this.emit('start', 95, '🚀 Khởi động OpenClaw gateway...');
      const started = await this.tryStartGateway(configDir);
      if (started) {
        this.emit('done', 100, '🎉 Setup hoàn tất! OpenClaw đang chạy.');
      } else {
        this.emit('done', 100, '✅ Setup hoàn tất! Khởi động thủ công bằng startup script.');
      }

      return true;
    } catch (err: any) {
      this.emit('error', 0, `❌ Lỗi: ${err.message}`, true);
      return false;
    }
  }

  // ── Helper: Find OpenClaw config dir ──

  private findOrCreateConfigDir(): string | null {
    const home = os.homedir();
    const candidates = [
      path.join(home, '.openclaw'),
      path.join(home, 'openclaw'),
      // Docker volumes
      path.join(home, 'docker', 'openclaw'),
    ];

    for (const dir of candidates) {
      if (fs.existsSync(dir)) return dir;
    }

    // Create default
    const defaultDir = path.join(home, '.openclaw');
    try {
      fs.mkdirSync(defaultDir, { recursive: true });
      return defaultDir;
    } catch {
      return null;
    }
  }

  // ── Helper: Write openclaw.json ──

  private async writeOpenClawConfig(configDir: string, config: WizardConfig): Promise<void> {
    const configPath = path.join(configDir, 'openclaw.json');
    let existingConfig: any = {};

    // Read existing config if present
    try {
      const existing = fs.readFileSync(configPath, 'utf-8');
      existingConfig = JSON.parse(existing);
    } catch {
      // File doesn't exist yet
    }

    // Merge with new settings
    const baseUrl = config.provider === 'izzi'
      ? IZZI_API_BASE
      : config.baseUrl || existingConfig.baseUrl || '';

    const newConfig = {
      ...existingConfig,
      baseUrl: baseUrl.replace(/\/v1\/?$/, ''), // Fix /v1 double-prefix issue
      apiKey: config.apiKey,
      agentRuntime: config.agentId || existingConfig.agentRuntime || 'openclaw',
      models: config.selectedModels.length > 0
        ? config.selectedModels
        : (config.provider === 'izzi' ? IZZI_MODELS.map(m => m.id) : existingConfig.models || []),
      defaultModel: config.provider === 'izzi' ? 'izzi-smart' : (config.selectedModels[0] || existingConfig.defaultModel),
      skills: config.enableSkills,
      plugins: config.enablePlugins,
    };

    fs.writeFileSync(configPath, JSON.stringify(newConfig, null, 2), 'utf-8');
  }

  // ── Helper: Write agent config ──

  private async writeAgentConfig(configDir: string, config: WizardConfig): Promise<void> {
    const agentDir = path.join(configDir, 'agents');
    fs.mkdirSync(agentDir, { recursive: true });

    // Telegram bot configs
    if (['telegram', 'telegram-multi', 'combo'].includes(config.channel)) {
      for (let i = 0; i < config.telegramTokens.length; i++) {
        const botConfig = {
          type: 'telegram',
          token: config.telegramTokens[i],
          modelId: config.selectedModels[0] || 'izzi-smart',
          name: `telegram-bot-${i + 1}`,
          enabled: true,
        };
        const botPath = path.join(agentDir, `telegram-bot-${i + 1}.json`);
        fs.writeFileSync(botPath, JSON.stringify(botConfig, null, 2), 'utf-8');
      }
    }

    // Zalo bot config
    if (['zalo-bot', 'zalo-personal', 'combo'].includes(config.channel)) {
      const zaloConfig = {
        type: config.channel === 'zalo-personal' ? 'zalo-personal' : 'zalo-bot',
        appId: config.zaloAppId || '',
        appSecret: config.zaloAppSecret || '',
        refreshToken: config.zaloRefreshToken || '',
        modelId: config.selectedModels[0] || 'izzi-smart',
        name: 'zalo-bot-1',
        enabled: true,
      };
      const zaloPath = path.join(agentDir, 'zalo-bot-1.json');
      fs.writeFileSync(zaloPath, JSON.stringify(zaloConfig, null, 2), 'utf-8');
    }
  }

  // ── Helper: Register Izzi models ──

  private async registerIzziModels(configDir: string, config: WizardConfig): Promise<void> {
    const modelsDir = path.join(configDir, 'models');
    fs.mkdirSync(modelsDir, { recursive: true });

    const models = config.selectedModels.length > 0
      ? config.selectedModels
      : IZZI_MODELS.map(m => m.id);

    for (const modelId of models) {
      const modelInfo = IZZI_MODELS.find(m => m.id === modelId);
      const modelConfig = {
        id: modelId,
        name: modelInfo?.name || modelId,
        provider: 'izzi',
        baseUrl: IZZI_API_BASE,
        apiKey: config.apiKey,
        enabled: true,
      };
      const modelPath = path.join(modelsDir, `${modelId.replace(/\//g, '-')}.json`);
      fs.writeFileSync(modelPath, JSON.stringify(modelConfig, null, 2), 'utf-8');
    }
  }

  // ── Helper: Generate startup scripts ──

  private async generateStartupScripts(configDir: string, config: WizardConfig, systemInfo: SystemCheckResult): Promise<void> {
    const scriptsDir = path.join(configDir, 'scripts');
    fs.mkdirSync(scriptsDir, { recursive: true });

    if (systemInfo.os === 'windows') {
      // Windows .bat startup
      const batContent = [
        '@echo off',
        'echo ========================================',
        'echo   Izzi OpenClaw - Startup',
        'echo ========================================',
        `echo Channel: ${config.channel}`,
        `echo Provider: ${config.provider}`,
        'echo.',
        '',
        config.installMode === 'docker'
          ? 'docker-compose up -d'
          : 'openclaw gateway start',
        '',
        'echo.',
        'echo OpenClaw is running!',
        'pause',
      ].join('\r\n');
      fs.writeFileSync(path.join(scriptsDir, 'startup.bat'), batContent, 'utf-8');

      // PowerShell startup
      const ps1Content = [
        '# Izzi OpenClaw Startup Script',
        '$ErrorActionPreference = "Continue"',
        '',
        'Write-Host "========================================" -ForegroundColor Cyan',
        'Write-Host "  Izzi OpenClaw - Starting up..." -ForegroundColor Green',
        'Write-Host "========================================" -ForegroundColor Cyan',
        '',
        config.installMode === 'docker'
          ? 'docker-compose up -d'
          : 'openclaw gateway start',
        '',
        'Write-Host "`nOpenClaw is running!" -ForegroundColor Green',
      ].join('\r\n');
      fs.writeFileSync(path.join(scriptsDir, 'startup.ps1'), ps1Content, 'utf-8');
    } else {
      // Unix shell script
      const shContent = [
        '#!/bin/bash',
        '# Izzi OpenClaw Startup Script',
        '',
        'echo "========================================"',
        'echo "  Izzi OpenClaw - Starting up..."',
        'echo "========================================"',
        '',
        config.installMode === 'docker'
          ? 'docker-compose up -d'
          : 'openclaw gateway start',
        '',
        'echo ""',
        'echo "OpenClaw is running!"',
      ].join('\n');
      const shPath = path.join(scriptsDir, 'startup.sh');
      fs.writeFileSync(shPath, shContent, 'utf-8');
      fs.chmodSync(shPath, '755');
    }
  }

  // ── Helper: Auto-start (Windows Task Scheduler) ──

  private async setupAutoStart(configDir: string): Promise<void> {
    return new Promise((resolve) => {
      const scriptPath = path.join(configDir, 'scripts', 'startup.bat');
      const taskName = 'IzziOpenClaw';

      // Check if task already exists, delete and recreate
      const cmd = `schtasks /Create /SC ONLOGON /TN "${taskName}" /TR "${scriptPath}" /F /RL HIGHEST`;

      exec(cmd, (error) => {
        if (error) {
          console.warn('[SetupWizard] Auto-start setup failed:', error.message);
        }
        resolve();
      });
    });
  }

  // ── Helper: Try start gateway ──

  private async tryStartGateway(configDir: string): Promise<boolean> {
    return new Promise((resolve) => {
      exec('openclaw gateway start', { cwd: configDir }, (error) => {
        resolve(!error);
      });
    });
  }

  // ── Helper: Auto-install OpenClaw ──

  /**
   * Auto-install OpenClaw based on OS and chosen install mode.
   * Strategy:
   *   Docker mode  → pull openclaw docker image
   *   Native mode  → npm install -g openclaw (or git clone fallback)
   *
   * Default recommendation rationale:
   *   Windows/macOS → Docker (isolation, no PATH conflicts, easy cleanup)
   *   Linux/VPS     → Native PM2 (lighter, faster startup, VPS-friendly)
   */
  private async installOpenClaw(
    osType: OSType,
    installMode: 'docker' | 'native',
  ): Promise<{ success: boolean; path?: string; error?: string }> {
    if (installMode === 'docker') {
      return this.installOpenClawDocker();
    }
    return this.installOpenClawNative(osType);
  }

  private async installOpenClawDocker(): Promise<{ success: boolean; path?: string; error?: string }> {
    return new Promise((resolve) => {
      this.emit('install-oc', 34, '🐳 Pulling OpenClaw Docker image...');
      exec('docker pull openclaw/openclaw:latest', { timeout: 120000 }, (error, stdout) => {
        if (error) {
          resolve({ success: false, error: `Docker pull failed: ${error.message}` });
          return;
        }
        // Create docker-compose.yml in config dir
        const home = os.homedir();
        const configDir = path.join(home, '.openclaw');
        fs.mkdirSync(configDir, { recursive: true });

        const composeContent = [
          'version: "3.8"',
          'services:',
          '  openclaw:',
          '    image: openclaw/openclaw:latest',
          '    container_name: izzi-openclaw',
          '    restart: unless-stopped',
          '    ports:',
          '      - "3456:3456"',
          '    volumes:',
          `      - ${configDir}:/app/config`,
          '    environment:',
          '      - NODE_ENV=production',
        ].join('\n');
        fs.writeFileSync(path.join(configDir, 'docker-compose.yml'), composeContent, 'utf-8');
        resolve({ success: true, path: 'docker:openclaw/openclaw:latest' });
      });
    });
  }

  private async installOpenClawNative(osType: OSType): Promise<{ success: boolean; path?: string; error?: string }> {
    // Try npm global install first
    const npmResult = await this.tryNpmInstall();
    if (npmResult.success) return npmResult;

    // Fallback: git clone to ~/.openclaw
    return this.tryGitCloneInstall(osType);
  }

  private async tryNpmInstall(): Promise<{ success: boolean; path?: string; error?: string }> {
    return new Promise((resolve) => {
      this.emit('install-oc', 34, '📦 Installing via npm (npm install -g openclaw)...');
      exec('npm install -g openclaw', { timeout: 90000 }, (error) => {
        if (error) {
          resolve({ success: false, error: `npm install failed: ${error.message}` });
          return;
        }
        resolve({ success: true, path: 'npm:global' });
      });
    });
  }

  private async tryGitCloneInstall(osType: OSType): Promise<{ success: boolean; path?: string; error?: string }> {
    return new Promise((resolve) => {
      const installDir = path.join(os.homedir(), '.openclaw', 'core');
      const repoUrl = 'https://github.com/open-claw/openclaw.git';

      this.emit('install-oc', 36, '📥 Fallback: git clone openclaw...');

      // Check if git is available
      execFile('git', ['--version'], (gitErr) => {
        if (gitErr) {
          resolve({ success: false, error: 'Cần cài Git hoặc npm để cài OpenClaw tự động' });
          return;
        }

        const cloneCmd = fs.existsSync(installDir)
          ? `cd "${installDir}" && git pull`
          : `git clone --depth 1 "${repoUrl}" "${installDir}"`;

        exec(cloneCmd, { timeout: 120000 }, (error) => {
          if (error) {
            resolve({ success: false, error: `Git clone failed: ${error.message}` });
            return;
          }

          // Run npm install in cloned directory
          exec('npm install --production', { cwd: installDir, timeout: 120000 }, (npmErr) => {
            if (npmErr) {
              resolve({ success: false, error: `npm install in clone failed: ${npmErr.message}` });
              return;
            }
            resolve({ success: true, path: installDir });
          });
        });
      });
    });
  }

  // ── Management: Reinstall OpenClaw ──

  async reinstallOpenClaw(): Promise<{ success: boolean; version?: string; error?: string }> {
    return new Promise((resolve) => {
      exec('npm install -g openclaw@latest', { timeout: 120000 }, (error, stdout) => {
        if (error) {
          resolve({ success: false, error: `Reinstall failed: ${error.message}` });
          return;
        }
        // Try to get the installed version
        execFile('openclaw', ['--version'], (verErr, verOut) => {
          const version = verErr ? null : verOut.trim();
          resolve({ success: true, version: version || 'latest' });
        });
      });
    });
  }

  // ── Management: Uninstall OpenClaw ──

  async uninstallOpenClaw(cleanupConfig: boolean = false): Promise<{ success: boolean; error?: string }> {
    return new Promise((resolve) => {
      exec('npm uninstall -g openclaw', { timeout: 60000 }, (error) => {
        if (error) {
          resolve({ success: false, error: `Uninstall failed: ${error.message}` });
          return;
        }

        if (cleanupConfig) {
          // Clean up config directory
          const configDir = path.join(os.homedir(), '.openclaw');
          try {
            if (fs.existsSync(configDir)) {
              fs.rmSync(configDir, { recursive: true, force: true });
            }
          } catch (cleanErr: any) {
            // Non-fatal: uninstall succeeded but cleanup failed
            console.warn('[SetupWizard] Config cleanup warning:', cleanErr.message);
          }
        }

        resolve({ success: true });
      });
    });
  }

  // ── Management: Check OpenClaw Version ──

  async checkOpenClawVersion(): Promise<{
    installed: boolean;
    currentVersion: string | null;
    latestVersion: string | null;
    updateAvailable: boolean;
  }> {
    const currentVersion = await this.getInstalledVersion();
    const latestVersion = await this.getLatestNpmVersion();

    const updateAvailable = !!(currentVersion && latestVersion
      && currentVersion !== latestVersion
      && currentVersion !== `v${latestVersion}`);

    return {
      installed: !!currentVersion,
      currentVersion,
      latestVersion,
      updateAvailable,
    };
  }

  private async getInstalledVersion(): Promise<string | null> {
    return new Promise((resolve) => {
      execFile('openclaw', ['--version'], { timeout: 10000 }, (error, stdout) => {
        if (error || !stdout.trim()) {
          resolve(null);
          return;
        }
        resolve(stdout.trim());
      });
    });
  }

  private async getLatestNpmVersion(): Promise<string | null> {
    return new Promise((resolve) => {
      exec('npm view openclaw version', { timeout: 15000 }, (error, stdout) => {
        if (error || !stdout.trim()) {
          resolve(null);
          return;
        }
        resolve(stdout.trim());
      });
    });
  }

  // ── Restore: Scan Existing Config ──

  async scanExistingConfig(): Promise<{
    found: boolean;
    configDir: string | null;
    files: { name: string; description: string; size: number }[];
  }> {
    const home = os.homedir();
    const candidates = [
      path.join(home, '.openclaw'),
      path.join(home, 'openclaw'),
      path.join(home, 'docker', 'openclaw'),
    ];

    for (const dir of candidates) {
      if (!fs.existsSync(dir)) continue;

      const files: { name: string; description: string; size: number }[] = [];

      // Check for key config files
      const configChecks = [
        { file: 'openclaw.json', desc: 'Cấu hình chính' },
        { file: '.env', desc: 'Biến môi trường' },
        { file: 'docker-compose.yml', desc: 'Docker Compose' },
      ];

      for (const check of configChecks) {
        const filePath = path.join(dir, check.file);
        if (fs.existsSync(filePath)) {
          const stat = fs.statSync(filePath);
          files.push({ name: check.file, description: check.desc, size: stat.size });
        }
      }

      // Check agents directory
      const agentDir = path.join(dir, 'agents');
      if (fs.existsSync(agentDir)) {
        const agentFiles = fs.readdirSync(agentDir).filter(f => f.endsWith('.json'));
        if (agentFiles.length > 0) {
          files.push({ name: `agents/ (${agentFiles.length} bots)`, description: 'Agent configs', size: 0 });
        }
      }

      // Check memory directory
      const memoryDir = path.join(dir, 'memory');
      if (fs.existsSync(memoryDir)) {
        let totalSize = 0;
        try {
          const memFiles = fs.readdirSync(memoryDir);
          for (const f of memFiles) {
            const fPath = path.join(memoryDir, f);
            try { totalSize += fs.statSync(fPath).size; } catch { /* skip */ }
          }
        } catch { /* skip */ }
        files.push({ name: 'memory/', description: `Dữ liệu bộ nhớ`, size: totalSize });
      }

      if (files.length > 0) {
        return { found: true, configDir: dir, files };
      }
    }

    return { found: false, configDir: null, files: [] };
  }

  // ── Static Helpers ──

  static getAvailableModels(): typeof IZZI_MODELS {
    return IZZI_MODELS;
  }

  static getProviderInfo(): { id: AIProvider; name: string; description: string; recommended: boolean; free: boolean }[] {
    return [
      { id: 'izzi', name: 'Izzi API', description: 'All-in-one Smart Router — GPT, Claude, Gemini tất cả trong 1 key', recommended: true, free: false },
      { id: '9router', name: '9Router', description: 'Miễn phí qua OAuth login', recommended: false, free: true },
      { id: 'gemini', name: 'Google Gemini', description: 'Free tier có sẵn — Gemini 2.5', recommended: false, free: true },
      { id: 'ollama', name: 'Ollama / Gemma 4', description: 'Chạy local, offline — không cần API key', recommended: false, free: true },
      { id: 'claude', name: 'Anthropic Claude', description: 'Claude 4 Sonnet/Haiku — cần API key Anthropic', recommended: false, free: false },
      { id: 'gpt4o', name: 'OpenAI GPT-4o', description: 'GPT-4o trực tiếp — cần API key OpenAI', recommended: false, free: false },
      { id: 'openrouter', name: 'OpenRouter', description: 'Trung gian nhiều model — cần API key', recommended: false, free: false },
      { id: 'custom', name: 'Custom', description: 'Tự nhập base URL và API key', recommended: false, free: false },
    ];
  }

  static getChannelInfo(): { id: ChannelType; name: string; icon: string; description: string; warning?: string }[] {
    return [
      { id: 'telegram', name: 'Telegram', icon: '📱', description: '1 bot Telegram — đơn giản, phổ biến nhất' },
      { id: 'telegram-multi', name: 'Telegram Multi-Bot', icon: '🤖', description: '2-5 bots hoạt động song song' },
      { id: 'zalo-bot', name: 'Zalo OA Bot', icon: '💬', description: 'Zalo Official Account (Bot API chính thức)' },
      { id: 'zalo-personal', name: 'Zalo Personal', icon: '⚡', description: 'Zalo cá nhân (không chính thức)', warning: '⚠️ Có thể bị Zalo hạn chế' },
      { id: 'combo', name: 'Telegram + Zalo', icon: '🔗', description: 'Chạy cả 2 nền tảng cùng lúc' },
    ];
  }
}
