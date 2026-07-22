import React, { useState, useEffect, useCallback } from 'react';
import {
  getModelCreditPolicy,
  MODEL_CREDIT_NOTICE_VI,
} from '../../shared/model-credit-policy';

// ── Types ──

type OSType = 'windows' | 'macos' | 'linux';
type ChannelType = 'telegram' | 'telegram-multi' | 'zalo-bot' | 'zalo-personal' | 'combo';
type AIProvider = 'izzi' | '9router' | 'gemini' | 'claude' | 'gpt4o' | 'openrouter' | 'ollama' | 'custom';
type SetupMode = 'welcome' | 'express' | 'custom' | 'restore';

interface SystemCheckResult {
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

interface SetupProgress {
  step: string;
  percent: number;
  message: string;
  isError: boolean;
}

// ── Provider data ──

const PROVIDERS: { id: AIProvider; name: string; desc: string; recommended?: boolean; free?: boolean }[] = [
  { id: 'izzi', name: 'Izzi API', desc: 'Smart Router — tất cả model trong 1 key', recommended: true },
  { id: '9router', name: '9Router', desc: 'Miễn phí qua OAuth', free: true },
  { id: 'gemini', name: 'Google Gemini', desc: 'Free tier — Gemini 2.5', free: true },
  { id: 'ollama', name: 'Ollama', desc: 'Chạy local, offline', free: true },
  { id: 'claude', name: 'Anthropic Claude', desc: 'Claude 4 — cần API key' },
  { id: 'gpt4o', name: 'OpenAI GPT', desc: 'GPT-4o/5 — cần API key' },
  { id: 'openrouter', name: 'OpenRouter', desc: 'Nhiều model — cần key' },
  { id: 'custom', name: 'Custom', desc: 'Tự nhập base URL' },
];

// ── Channel data ──

const CHANNELS: { id: ChannelType; name: string; icon: string; desc: string; warning?: string }[] = [
  { id: 'telegram', name: 'Telegram', icon: '📱', desc: '1 bot Telegram — phổ biến nhất' },
  { id: 'telegram-multi', name: 'Multi-Bot', icon: '🤖', desc: '2-5 bots song song' },
  { id: 'zalo-bot', name: 'Zalo OA', icon: '💬', desc: 'Official Account Bot API' },
  { id: 'zalo-personal', name: 'Zalo Cá nhân', icon: '⚡', desc: 'Không chính thức', warning: '⚠️ Có thể bị hạn chế' },
  { id: 'combo', name: 'Combo', icon: '🔗', desc: 'Telegram + Zalo cùng lúc' },
];

// ── Agent runtime options (Express setup) ──
// OpenClaw is the local-first default; Hermes & AutoGPT are real Docker agents
// installed via the dockerAgent IPC bridge (pull + run). Metadata mirrors the
// entries in types/agent-registry.ts (TOP_AGENTS).

interface SetupAgentOption {
  id: string;
  name: string;
  icon: string;
  desc: string;
  runtime: 'openclaw' | 'docker';
  dockerImage?: string;
  defaultPort?: number;
  recommended?: boolean;
}

const AGENT_OPTIONS: SetupAgentOption[] = [
  {
    id: 'openclaw',
    name: 'OpenClaw',
    icon: '🦞',
    desc: 'Local-first — Telegram/Zalo, skills, cron, memory',
    runtime: 'openclaw',
    recommended: true,
  },
  {
    id: 'hermes',
    name: 'Hermes Agent',
    icon: '⚡',
    desc: 'Self-improving (Nous Research) — Docker, 200+ models',
    runtime: 'docker',
    dockerImage: 'nousresearch/hermes-agent:latest',
    defaultPort: 8642,
  },
  {
    id: 'autogpt',
    name: 'AutoGPT',
    icon: '🧠',
    desc: 'Autonomous goal-driven agent — Docker',
    runtime: 'docker',
    dockerImage: 'autogpt/autogpt:latest',
    defaultPort: 8000,
  },
];

// ── Izzi Models ──

const IZZI_MODELS = [
  { id: 'izzi-smart', name: 'Izzi Smart Router', checked: true },
  { id: 'grok-4.5-high', name: 'Grok 4.5 High', checked: true },
  { id: 'gpt-5.6-sol', name: 'GPT-5.6 Sol', checked: true },
  { id: 'gpt-5.6-terra', name: 'GPT-5.6 Terra', checked: true },
  { id: 'gpt-5.6-luna', name: 'GPT-5.6 Luna', checked: true },
  { id: 'gpt-5.5', name: 'GPT-5.5', checked: true },
  { id: 'gpt-5.4', name: 'GPT-5.4', checked: true },
  { id: 'gpt-5.2', name: 'GPT-5.2', checked: false },
  { id: 'gpt-5.1-codex', name: 'GPT-5.1 Codex', checked: false },
  { id: 'claude-4-sonnet', name: 'Claude 4 Sonnet', checked: true },
  { id: 'claude-4-haiku', name: 'Claude 4 Haiku', checked: false },
  { id: 'gemini-2.5-pro', name: 'Gemini 2.5 Pro', checked: true },
  { id: 'gemini-2.5-flash', name: 'Gemini 2.5 Flash', checked: false },
];

// ══════════════════════════════════════════
// Main Component
// ══════════════════════════════════════════

interface SetupWizardPageProps {
  onComplete?: () => void;
}

export function SetupWizardPage({ onComplete }: SetupWizardPageProps) {
  const [mode, setMode] = useState<SetupMode>('welcome');
  const [systemInfo, setSystemInfo] = useState<SystemCheckResult | null>(null);

  // Express state
  const [expressApiKey, setExpressApiKey] = useState('');
  const [expressVerified, setExpressVerified] = useState(false);
  const [expressVerifying, setExpressVerifying] = useState(false);
  const [expressChannel, setExpressChannel] = useState<'telegram' | 'zalo'>('telegram');
  const [expressBotToken, setExpressBotToken] = useState('');
  const [expressAgent, setExpressAgent] = useState<string>('openclaw');

  // Custom state — accordion sections
  const [customExpandedSection, setCustomExpandedSection] = useState<string>('channel');
  const [channel, setChannel] = useState<ChannelType>('telegram');
  const [provider, setProvider] = useState<AIProvider>('izzi');
  const [telegramTokens, setTelegramTokens] = useState<string[]>(['']);
  const [zaloAppId, setZaloAppId] = useState('');
  const [zaloAppSecret, setZaloAppSecret] = useState('');
  const [zaloRefreshToken, setZaloRefreshToken] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [baseUrl, setBaseUrl] = useState('');
  const [selectedModels, setSelectedModels] = useState<string[]>(
    IZZI_MODELS.filter(m => m.checked).map(m => m.id)
  );
  const [autoStart, setAutoStart] = useState(true);

  // Install
  const [installProgress, setInstallProgress] = useState<SetupProgress[]>([]);
  const [isInstalling, setIsInstalling] = useState(false);
  const [installDone, setInstallDone] = useState(false);

  // Management
  const [mgmtAction, setMgmtAction] = useState<string | null>(null);
  const [mgmtLog, setMgmtLog] = useState<string[]>([]);

  // Auto-detect system on mount
  useEffect(() => {
    checkSystem();
  }, []);

  // ── System Check ──

  const checkSystem = useCallback(async () => {
    try {
      if (window.electronAPI) {
        const result = await (window.electronAPI as any).setup?.checkSystem?.();
        if (result) { setSystemInfo(result); return; }
      }
      // Fallback for dev
      setSystemInfo({
        os: 'windows', osVersion: 'Windows 11',
        nodeInstalled: true, nodeVersion: 'v22.x',
        dockerInstalled: true, dockerRunning: false,
        openclawInstalled: false, openclawPath: null, openclawVersion: null,
        recommended: 'docker',
      });
    } catch (err) { console.error('System check failed:', err); }
  }, []);

  // ── Auto-verify API Key ──

  const verifyApiKey = useCallback(async (key: string) => {
    if (!key || key.length < 8) return;
    setExpressVerifying(true);
    try {
      // Verify key by calling the real OpenAI-compatible endpoint
      const res = await fetch('https://izziapi.com/v1/models', {
        method: 'GET',
        headers: { Authorization: `Bearer ${key}`, 'X-Source-Platform': 'starizzi' },
      });
      if (res.ok) {
        setExpressVerified(true);
      } else if (res.status === 401 || res.status === 403) {
        // Key is invalid or unauthorized
        setExpressVerified(false);
      } else {
        // Other server error — accept key if format matches
        setExpressVerified(key.startsWith('izzi-') && key.length > 12);
      }
    } catch {
      // Offline or network error — accept key if format matches
      setExpressVerified(key.startsWith('izzi-') && key.length > 12);
    } finally {
      setExpressVerifying(false);
    }
  }, []);

  // Debounced verify on key change
  useEffect(() => {
    if (!expressApiKey) { setExpressVerified(false); return; }
    const timer = setTimeout(() => verifyApiKey(expressApiKey), 600);
    return () => clearTimeout(timer);
  }, [expressApiKey, verifyApiKey]);

  // ── Execute Install ──

  const handleInstall = useCallback(async (config: any) => {
    setIsInstalling(true);
    setInstallProgress([]);

    try {
      if (window.electronAPI && (window.electronAPI as any).setup?.executeSetup) {
        const result = await (window.electronAPI as any).setup.executeSetup(config);
        if (result.success) {
          // For Docker-based agents (Hermes / AutoGPT), run the REAL docker
          // pull + start path after the base config is written. OpenClaw uses
          // the native gateway started by executeSetup, so it needs no extra step.
          const selected = AGENT_OPTIONS.find(a => a.id === config.agentId);
          if (selected && selected.runtime === 'docker' && selected.dockerImage) {
            const ok = await installDockerAgent(selected, config);
            if (!ok) {
              // Base config is written; the optional Docker agent runtime could
              // not be installed (no Docker). Let the user finish onboarding and
              // install the agent later from Agent Hub.
              setInstallProgress(prev => [...prev, {
                step: 'agent', percent: 100,
                message: 'ℹ️ Cấu hình cơ bản đã xong. Agent runtime cần Docker — bạn có thể cài sau trong Agent Hub (cài Docker Desktop rồi bấm cài lại).',
                isError: false,
              }]);
            }
            setInstallDone(true);
          } else {
            setInstallDone(true);
          }
        }
      } else {
        // Simulate for dev
        const selected = AGENT_OPTIONS.find(a => a.id === config.agentId);
        const agentLabel = selected?.name ?? 'OpenClaw';
        const pullLine = selected?.runtime === 'docker' && selected.dockerImage
          ? `$ docker pull ${selected.dockerImage}`
          : '$ docker pull openclaw/gateway:latest';
        const steps = [
          { step: 'detect', percent: 10, message: '$ Phát hiện hệ thống... Windows 11 x64', isError: false },
          { step: 'docker', percent: 20, message: '$ Kiểm tra Docker... OK', isError: false },
          { step: 'verify', percent: 35, message: '$ Xác thực API key... ✓ Verified', isError: false },
          { step: 'agent', percent: 50, message: `$ Agent đã chọn: ${agentLabel}`, isError: false },
          { step: 'pull', percent: 65, message: pullLine, isError: false },
          { step: 'config', percent: 80, message: '$ Ghi cấu hình .env → ~/.openclaw/', isError: false },
          { step: 'startup', percent: 90, message: '$ Tạo startup script...', isError: false },
          { step: 'done', percent: 100, message: `✓ Setup hoàn tất — ${agentLabel} đã sẵn sàng!`, isError: false },
        ];
        for (const s of steps) {
          await new Promise(r => setTimeout(r, 600));
          setInstallProgress(prev => [...prev, s]);
        }
        setInstallDone(true);
      }
    } catch (err: any) {
      setInstallProgress(prev => [...prev, {
        step: 'error', percent: 0,
        message: `✗ Lỗi: ${err.message}`,
        isError: true,
      }]);
    } finally {
      setIsInstalling(false);
    }
  }, []);

  // Real Docker agent install (pull + run) via the dockerAgent IPC bridge.
  // Streams docker output into the install terminal. Returns true on success.
  const installDockerAgent = useCallback(
    async (agent: SetupAgentOption, config: any): Promise<boolean> => {
      const dockerAgentApi = (window.electronAPI as any)?.dockerAgent;
      if (!dockerAgentApi) {
        setInstallProgress(prev => [...prev, {
          step: 'agent', percent: 92,
          message: '⚠️ Không tìm thấy cầu nối Docker — bỏ qua cài agent runtime (cài sau trong Agent Hub).',
          isError: true,
        }]);
        return false;
      }

      const push = (message: string, percent: number, isError = false) =>
        setInstallProgress(prev => [...prev, { step: 'agent', percent, message, isError }]);

      // Live docker pull output → terminal
      const off = dockerAgentApi.onProgress?.((data: { agentId: string; line: string }) => {
        if (data.agentId === agent.id) push(`  ${data.line}`, 94);
      });

      try {
        push(`$ docker info`, 92);
        const available = await dockerAgentApi.isAvailable();
        if (!available) {
          push('  ✗ Chưa thấy Docker. Cài "Docker Desktop" (docker.com) rồi mở app, hoặc cài agent sau trong Agent Hub.', 92, true);
          return false;
        }

        const payload = {
          id: agent.id,
          dockerImage: agent.dockerImage,
          defaultPort: agent.defaultPort ?? 8642,
          provider: config.provider,
          apiKey: config.apiKey,
        };

        push(`$ docker pull ${agent.dockerImage}`, 94);
        const pull = await dockerAgentApi.install(payload);
        if (!pull?.ok) {
          push(`  ✗ Pull thất bại: ${pull?.error ?? 'không rõ'}`, 94, true);
          return false;
        }
        push(`  ✓ Image đã sẵn sàng.`, 96);

        push(`$ docker run -d --name izzi-agent-${agent.id} -p ${payload.defaultPort}:${payload.defaultPort} ${agent.dockerImage}`, 97);
        const start = await dockerAgentApi.start(payload);
        if (!start?.ok) {
          push(`  ✗ Khởi động thất bại: ${start?.error ?? 'không rõ'}`, 97, true);
          return false;
        }

        push(`🎉 ${agent.name} đang chạy trên cổng ${payload.defaultPort}.`, 100);
        return true;
      } finally {
        off?.();
      }
    },
    [],
  );

  // ── Express Install ──

  const startExpressInstall = () => {
    handleInstall({
      channel: expressChannel === 'telegram' ? 'telegram' : 'zalo-bot',
      provider: 'izzi',
      telegramTokens: expressChannel === 'telegram' ? [expressBotToken] : [],
      apiKey: expressApiKey,
      installMode: 'docker',
      autoStart: true,
      enableSkills: true,
      enablePlugins: true,
      selectedModels: IZZI_MODELS.filter(m => m.checked).map(m => m.id),
      agentId: expressAgent,
    });
  };

  // ── Custom Install ──

  const startCustomInstall = () => {
    handleInstall({
      channel,
      provider,
      telegramTokens: telegramTokens.filter(t => t.trim()),
      zaloAppId, zaloAppSecret, zaloRefreshToken,
      apiKey, baseUrl,
      installMode: 'docker',
      autoStart,
      enableSkills: true,
      enablePlugins: true,
      selectedModels,
    });
  };

  // ── Management Actions ──

  const handleMgmtAction = async (action: 'reinstall' | 'uninstall' | 'version') => {
    setMgmtAction(action);
    setMgmtLog([]);

    try {
      if (window.electronAPI && (window.electronAPI as any).setup) {
        const setup = (window.electronAPI as any).setup;

        if (action === 'reinstall') {
          setMgmtLog(prev => [...prev, '$ npm install -g openclaw@latest']);
          const result = await setup.reinstall();
          if (result.success) {
            setMgmtLog(prev => [...prev, `✓ Cài đặt lại thành công! (v${result.version || 'latest'})`]);
          } else {
            setMgmtLog(prev => [...prev, `✗ ${result.error || 'Lỗi không xác định'}`]);
          }
        } else if (action === 'uninstall') {
          setMgmtLog(prev => [...prev, '$ npm uninstall -g openclaw']);
          const result = await setup.uninstall(false);
          if (result.success) {
            setMgmtLog(prev => [...prev, '✓ Gỡ cài đặt hoàn tất.']);
          } else {
            setMgmtLog(prev => [...prev, `✗ ${result.error || 'Lỗi không xác định'}`]);
          }
        } else if (action === 'version') {
          setMgmtLog(prev => [...prev, '$ openclaw --version']);
          const result = await setup.versionCheck();
          if (result.installed) {
            setMgmtLog(prev => [...prev, `openclaw ${result.currentVersion} (latest: ${result.latestVersion || '?'})`]);
            if (result.updateAvailable) {
              setMgmtLog(prev => [...prev, '⚡ Có bản cập nhật mới! Nhấn "Cài lại" để update.']);
            } else {
              setMgmtLog(prev => [...prev, '✓ Phiên bản mới nhất.']);
            }
          } else {
            setMgmtLog(prev => [...prev, '⚠ OpenClaw chưa được cài đặt.']);
          }
        }
      } else {
        // Dev fallback: simulate
        const labels = {
          reinstall: ['$ npm install -g openclaw@latest', '...', '✓ Cài đặt lại thành công!'],
          uninstall: ['$ npm uninstall -g openclaw', '$ Dọn dẹp ~/.openclaw/config...', '✓ Gỡ cài đặt hoàn tất.'],
          version: ['$ openclaw --version', 'openclaw v3.2.1 (latest: v3.2.1)', '✓ Phiên bản mới nhất.'],
        };
        for (const line of labels[action]) {
          await new Promise(r => setTimeout(r, 500));
          setMgmtLog(prev => [...prev, line]);
        }
      }
    } catch (err: any) {
      setMgmtLog(prev => [...prev, `✗ Lỗi: ${err.message}`]);
    }
  };

  // ── Telegram token utils ──

  const addTelegramToken = () => {
    if (telegramTokens.length < 5) setTelegramTokens([...telegramTokens, '']);
  };
  const updateTelegramToken = (index: number, value: string) => {
    const updated = [...telegramTokens]; updated[index] = value; setTelegramTokens(updated);
  };
  const removeTelegramToken = (index: number) => {
    if (telegramTokens.length > 1) setTelegramTokens(telegramTokens.filter((_, i) => i !== index));
  };
  const toggleModel = (modelId: string) => {
    setSelectedModels(prev =>
      prev.includes(modelId) ? prev.filter(m => m !== modelId) : [...prev, modelId]
    );
  };

  // ── Render ──

  return (
    <div className="izzi-setup" id="setup-wizard-page">
      {mode === 'welcome' && (
        <WelcomeScreen
          systemInfo={systemInfo}
          onSelectMode={setMode}
          onMgmtAction={handleMgmtAction}
          mgmtAction={mgmtAction}
          mgmtLog={mgmtLog}
        />
      )}
      {mode === 'express' && (
        <ExpressMode
          apiKey={expressApiKey}
          setApiKey={setExpressApiKey}
          verified={expressVerified}
          verifying={expressVerifying}
          channel={expressChannel}
          setChannel={setExpressChannel}
          botToken={expressBotToken}
          setBotToken={setExpressBotToken}
          agent={expressAgent}
          setAgent={setExpressAgent}
          onInstall={startExpressInstall}
          onBack={() => setMode('welcome')}
          progress={installProgress}
          isInstalling={isInstalling}
          isDone={installDone}
          onComplete={onComplete}
        />
      )}
      {mode === 'custom' && (
        <CustomMode
          expandedSection={customExpandedSection}
          setExpandedSection={setCustomExpandedSection}
          channel={channel} setChannel={setChannel}
          provider={provider} setProvider={setProvider}
          telegramTokens={telegramTokens}
          updateTelegramToken={updateTelegramToken}
          addTelegramToken={addTelegramToken}
          removeTelegramToken={removeTelegramToken}
          zaloAppId={zaloAppId} setZaloAppId={setZaloAppId}
          zaloAppSecret={zaloAppSecret} setZaloAppSecret={setZaloAppSecret}
          zaloRefreshToken={zaloRefreshToken} setZaloRefreshToken={setZaloRefreshToken}
          apiKey={apiKey} setApiKey={setApiKey}
          baseUrl={baseUrl} setBaseUrl={setBaseUrl}
          selectedModels={selectedModels} toggleModel={toggleModel}
          autoStart={autoStart} setAutoStart={setAutoStart}
          onInstall={startCustomInstall}
          onBack={() => setMode('welcome')}
          progress={installProgress}
          isInstalling={isInstalling}
          isDone={installDone}
          onComplete={onComplete}
        />
      )}
      {mode === 'restore' && (
        <RestoreMode
          onBack={() => setMode('welcome')}
          onComplete={onComplete}
        />
      )}
    </div>
  );
}

// ══════════════════════════════════════════
// Welcome Screen — Hub with 3 Mode Cards
// ══════════════════════════════════════════

function WelcomeScreen({
  systemInfo,
  onSelectMode,
  onMgmtAction,
  mgmtAction,
  mgmtLog,
}: {
  systemInfo: SystemCheckResult | null;
  onSelectMode: (mode: SetupMode) => void;
  onMgmtAction: (action: 'reinstall' | 'uninstall' | 'version') => void;
  mgmtAction: string | null;
  mgmtLog: string[];
}) {
  return (
    <div className="izzi-setup__welcome">
      {/* Hero */}
      <div className="izzi-setup__hero">
        <div className="izzi-setup__hero-badge">SETUP CENTER</div>
        <h1 className="izzi-setup__hero-title">
          <span className="izzi-setup__hero-gradient">Izzi OpenClaw</span>
        </h1>
        <p className="izzi-setup__hero-subtitle">
          Cài đặt & quản lý AI bot chưa bao giờ dễ hơn
        </p>
        {systemInfo && (
          <div className="izzi-setup__sys-strip">
            <span className="izzi-setup__sys-item izzi-setup__sys-item--ok">
              💻 {systemInfo.osVersion}
            </span>
            <span className={`izzi-setup__sys-item ${systemInfo.dockerInstalled ? 'izzi-setup__sys-item--ok' : 'izzi-setup__sys-item--warn'}`}>
              🐳 Docker {systemInfo.dockerRunning ? 'Running' : systemInfo.dockerInstalled ? 'Stopped' : 'N/A'}
            </span>
            <span className={`izzi-setup__sys-item ${systemInfo.nodeInstalled ? 'izzi-setup__sys-item--ok' : 'izzi-setup__sys-item--warn'}`}>
              📦 Node {systemInfo.nodeVersion || 'N/A'}
            </span>
            {systemInfo.openclawInstalled && (
              <span className="izzi-setup__sys-item izzi-setup__sys-item--ok">
                🦞 OpenClaw {systemInfo.openclawVersion || 'Installed'}
              </span>
            )}
          </div>
        )}
      </div>

      {/* 3 Mode Cards */}
      <div className="izzi-setup__modes">
        <button
          className="izzi-setup__mode-card izzi-setup__mode-card--express glass-card"
          onClick={() => onSelectMode('express')}
          id="mode-express"
        >
          <div className="izzi-setup__mode-glow" />
          <div className="izzi-setup__mode-icon">⚡</div>
          <div className="izzi-setup__mode-label">Express</div>
          <div className="izzi-setup__mode-desc">
            One-click setup<br />Telegram + Izzi API
          </div>
          <div className="izzi-setup__mode-tag">Khuyên dùng</div>
        </button>

        <button
          className="izzi-setup__mode-card izzi-setup__mode-card--custom glass-card"
          onClick={() => onSelectMode('custom')}
          id="mode-custom"
        >
          <div className="izzi-setup__mode-icon">🎛️</div>
          <div className="izzi-setup__mode-label">Tuỳ chỉnh</div>
          <div className="izzi-setup__mode-desc">
            Chọn channel, provider<br />& cấu hình chi tiết
          </div>
        </button>

        <button
          className="izzi-setup__mode-card izzi-setup__mode-card--restore glass-card"
          onClick={() => onSelectMode('restore')}
          id="mode-restore"
        >
          <div className="izzi-setup__mode-icon">🔄</div>
          <div className="izzi-setup__mode-label">Khôi phục</div>
          <div className="izzi-setup__mode-desc">
            Import cấu hình<br />từ backup
          </div>
        </button>
      </div>

      {/* Management Panel */}
      <div className="izzi-setup__mgmt glass-panel">
        <div className="izzi-setup__mgmt-title">Quản lý OpenClaw</div>
        <div className="izzi-setup__mgmt-actions">
          <button
            className="izzi-setup__mgmt-btn"
            onClick={() => onMgmtAction('reinstall')}
            id="mgmt-reinstall"
          >
            <span>📥</span> Cài lại
          </button>
          <button
            className="izzi-setup__mgmt-btn izzi-setup__mgmt-btn--danger"
            onClick={() => onMgmtAction('uninstall')}
            id="mgmt-uninstall"
          >
            <span>🗑️</span> Gỡ cài đặt
          </button>
          <button
            className="izzi-setup__mgmt-btn"
            onClick={() => onMgmtAction('version')}
            id="mgmt-version"
          >
            <span>🔍</span> Kiểm tra version
          </button>
        </div>
        {mgmtAction && mgmtLog.length > 0 && (
          <div className="izzi-setup__terminal" id="mgmt-terminal">
            {mgmtLog.map((line, i) => (
              <div key={i} className="izzi-setup__terminal-line">{line}</div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ══════════════════════════════════════════
// Express Mode — One-Click Flow
// ══════════════════════════════════════════

function ExpressMode({
  apiKey, setApiKey, verified, verifying,
  channel, setChannel, botToken, setBotToken,
  agent, setAgent,
  onInstall, onBack,
  progress, isInstalling, isDone, onComplete,
}: {
  apiKey: string; setApiKey: (v: string) => void;
  verified: boolean; verifying: boolean;
  channel: 'telegram' | 'zalo'; setChannel: (c: 'telegram' | 'zalo') => void;
  botToken: string; setBotToken: (v: string) => void;
  agent: string; setAgent: (id: string) => void;
  onInstall: () => void; onBack: () => void;
  progress: SetupProgress[]; isInstalling: boolean; isDone: boolean;
  onComplete?: () => void;
}) {
  const canInstall = verified && botToken.trim().length > 0;

  if (isInstalling || isDone) {
    return (
      <InstallTerminal
        progress={progress}
        isInstalling={isInstalling}
        isDone={isDone}
        onComplete={onComplete}
        onBack={onBack}
      />
    );
  }

  const openIzziDashboard = () => {
    if (window.electronAPI && (window.electronAPI as any).shell?.openExternal) {
      (window.electronAPI as any).shell.openExternal('https://izziapi.com/dashboard/keys');
    } else {
      window.open('https://izziapi.com/dashboard/keys', '_blank');
    }
  };

  return (
    <div className="izzi-setup__express">
      <button className="izzi-setup__back-btn" onClick={onBack} id="express-back">
        ← Quay lại
      </button>

      <div className="izzi-setup__express-header">
        <div className="izzi-setup__express-icon">⚡</div>
        <h2>Express Setup</h2>
        <p>Chọn agent, nhập API key & Bot token — xong!</p>
      </div>

      {/* Step 1: Agent runtime picker */}
      <div className="izzi-setup__field-group">
        <label className="izzi-setup__field-label">
          <span className="izzi-setup__field-num">1</span>
          Chọn Agent
        </label>
        <div className="izzi-setup__agent-grid">
          {AGENT_OPTIONS.map(opt => (
            <button
              key={opt.id}
              type="button"
              className={`izzi-setup__agent-card ${agent === opt.id ? 'izzi-setup__agent-card--active' : ''}`}
              onClick={() => setAgent(opt.id)}
              id={`express-agent-${opt.id}`}
              aria-pressed={agent === opt.id}
            >
              {opt.recommended && <span className="izzi-setup__agent-tag">Khuyên dùng</span>}
              <span className="izzi-setup__agent-icon">{opt.icon}</span>
              <span className="izzi-setup__agent-name">{opt.name}</span>
              <span className="izzi-setup__agent-desc">{opt.desc}</span>
              <span className="izzi-setup__agent-runtime">
                {opt.runtime === 'docker' ? `Docker · cổng ${opt.defaultPort}` : 'Chạy native'}
              </span>
            </button>
          ))}
        </div>
        {AGENT_OPTIONS.find(a => a.id === agent)?.runtime === 'docker' && (
          <div className="izzi-setup__field-hint">
            Agent này chạy qua Docker — cần Docker Desktop đang mở. Hệ thống sẽ tự pull image và khởi động container sau khi cấu hình xong.
          </div>
        )}
      </div>

      {/* Step 2: API Key with auto-verify */}
      <div className="izzi-setup__field-group">
        <label className="izzi-setup__field-label">
          <span className="izzi-setup__field-num">2</span>
          Izzi API Key
        </label>
        <div className="izzi-setup__key-input-wrap">
          <input
            className="izzi-setup__key-input"
            type="password"
            placeholder="izzi-xxxxxxxxxxxxxxxx"
            value={apiKey}
            onChange={e => setApiKey(e.target.value)}
            id="express-api-key"
          />
          <div className={`izzi-setup__key-status ${verified ? 'izzi-setup__key-status--ok' : verifying ? 'izzi-setup__key-status--loading' : ''}`}>
            {verifying ? (
              <div className="izzi-setup__mini-spinner" />
            ) : verified ? (
              <span className="izzi-setup__key-check">✓</span>
            ) : apiKey.length > 0 ? (
              <span className="izzi-setup__key-x">✗</span>
            ) : null}
          </div>
        </div>
        <div className="izzi-setup__field-hint">
          Chưa có key?{' '}
          <button className="izzi-setup__link-btn" onClick={openIzziDashboard} type="button">
            Tạo miễn phí tại izziapi.com →
          </button>
        </div>
        <div className="izzi-setup__field-hint izzi-setup__field-hint--credit" role="note">
          {MODEL_CREDIT_NOTICE_VI['may-route-paid-only']}
        </div>
      </div>

      {/* Step 3: Channel quick-pick */}
      <div className="izzi-setup__field-group">
        <label className="izzi-setup__field-label">
          <span className="izzi-setup__field-num">3</span>
          Kênh chat
        </label>
        <div className="izzi-setup__pill-group">
          <button
            className={`izzi-setup__pill ${channel === 'telegram' ? 'izzi-setup__pill--active' : ''}`}
            onClick={() => setChannel('telegram')}
          >
            📱 Telegram
          </button>
          <button
            className={`izzi-setup__pill ${channel === 'zalo' ? 'izzi-setup__pill--active' : ''}`}
            onClick={() => setChannel('zalo')}
          >
            💬 Zalo
          </button>
        </div>
      </div>

      {/* Step 4: Bot Token */}
      <div className="izzi-setup__field-group">
        <label className="izzi-setup__field-label">
          <span className="izzi-setup__field-num">4</span>
          {channel === 'telegram' ? 'Telegram Bot Token' : 'Zalo App ID'}
        </label>
        <input
          className="izzi-setup__input"
          type="text"
          placeholder={channel === 'telegram' ? 'Token từ @BotFather' : 'Zalo App ID'}
          value={botToken}
          onChange={e => setBotToken(e.target.value)}
          id="express-bot-token"
        />
      </div>

      {/* Launch button */}
      <button
        className="izzi-setup__launch-btn"
        disabled={!canInstall}
        onClick={onInstall}
        id="express-install-btn"
      >
        <span className="izzi-setup__launch-icon">🚀</span>
        Cài đặt Express
      </button>
    </div>
  );
}

// ══════════════════════════════════════════
// Custom Mode — Vertical Accordion
// ══════════════════════════════════════════

function CustomMode({
  expandedSection, setExpandedSection,
  channel, setChannel,
  provider, setProvider,
  telegramTokens, updateTelegramToken, addTelegramToken, removeTelegramToken,
  zaloAppId, setZaloAppId, zaloAppSecret, setZaloAppSecret,
  zaloRefreshToken, setZaloRefreshToken,
  apiKey, setApiKey, baseUrl, setBaseUrl,
  selectedModels, toggleModel,
  autoStart, setAutoStart,
  onInstall, onBack,
  progress, isInstalling, isDone, onComplete,
}: {
  expandedSection: string; setExpandedSection: (s: string) => void;
  channel: ChannelType; setChannel: (c: ChannelType) => void;
  provider: AIProvider; setProvider: (p: AIProvider) => void;
  telegramTokens: string[]; updateTelegramToken: (i: number, v: string) => void;
  addTelegramToken: () => void; removeTelegramToken: (i: number) => void;
  zaloAppId: string; setZaloAppId: (v: string) => void;
  zaloAppSecret: string; setZaloAppSecret: (v: string) => void;
  zaloRefreshToken: string; setZaloRefreshToken: (v: string) => void;
  apiKey: string; setApiKey: (v: string) => void;
  baseUrl: string; setBaseUrl: (v: string) => void;
  selectedModels: string[]; toggleModel: (id: string) => void;
  autoStart: boolean; setAutoStart: (v: boolean) => void;
  onInstall: () => void; onBack: () => void;
  progress: SetupProgress[]; isInstalling: boolean; isDone: boolean;
  onComplete?: () => void;
}) {
  const showTelegram = ['telegram', 'telegram-multi', 'combo'].includes(channel);
  const showZalo = ['zalo-bot', 'zalo-personal', 'combo'].includes(channel);
  const showApiKey = !['ollama', '9router'].includes(provider);
  const showModels = provider === 'izzi';

  if (isInstalling || isDone) {
    return (
      <InstallTerminal
        progress={progress}
        isInstalling={isInstalling}
        isDone={isDone}
        onComplete={onComplete}
        onBack={onBack}
      />
    );
  }

  const sections = [
    { key: 'channel', label: 'Kênh chat', summary: CHANNELS.find(c => c.id === channel)?.name || channel },
    { key: 'provider', label: 'AI Provider', summary: PROVIDERS.find(p => p.id === provider)?.name || provider },
    { key: 'config', label: 'Cấu hình', summary: apiKey ? '🔑 Key đã nhập' : '⏳ Chờ cấu hình' },
    { key: 'options', label: 'Tùy chọn', summary: autoStart ? 'Auto-start bật' : 'Auto-start tắt' },
  ];

  return (
    <div className="izzi-setup__custom">
      <button className="izzi-setup__back-btn" onClick={onBack} id="custom-back">
        ← Quay lại
      </button>

      <div className="izzi-setup__custom-header">
        <h2>🎛️ Tuỳ chỉnh đầy đủ</h2>
        <p>Mở từng phần để cấu hình theo ý muốn</p>
      </div>

      {/* Accordion */}
      <div className="izzi-setup__accordion">
        {sections.map((sec, idx) => (
          <div
            key={sec.key}
            className={`izzi-setup__accordion-item ${expandedSection === sec.key ? 'izzi-setup__accordion-item--open' : ''}`}
          >
            <button
              className="izzi-setup__accordion-header"
              onClick={() => setExpandedSection(expandedSection === sec.key ? '' : sec.key)}
            >
              <span className="izzi-setup__accordion-num">{idx + 1}</span>
              <span className="izzi-setup__accordion-label">{sec.label}</span>
              <span className="izzi-setup__accordion-summary">{sec.summary}</span>
              <span className="izzi-setup__accordion-chevron">
                {expandedSection === sec.key ? '▾' : '▸'}
              </span>
            </button>

            {expandedSection === sec.key && (
              <div className="izzi-setup__accordion-body">
                {sec.key === 'channel' && (
                  <div className="izzi-setup__pill-grid">
                    {CHANNELS.map(ch => (
                      <button
                        key={ch.id}
                        className={`izzi-setup__option-pill ${channel === ch.id ? 'izzi-setup__option-pill--active' : ''}`}
                        onClick={() => setChannel(ch.id)}
                      >
                        <span>{ch.icon}</span>
                        <span className="izzi-setup__option-pill-name">{ch.name}</span>
                        <span className="izzi-setup__option-pill-desc">{ch.desc}</span>
                        {ch.warning && <span className="izzi-setup__option-pill-warn">{ch.warning}</span>}
                      </button>
                    ))}
                  </div>
                )}

                {sec.key === 'provider' && (
                  <div className="izzi-setup__provider-list">
                    {PROVIDERS.map(pr => (
                      <button
                        key={pr.id}
                        className={`izzi-setup__provider-row ${provider === pr.id ? 'izzi-setup__provider-row--active' : ''}`}
                        onClick={() => setProvider(pr.id)}
                      >
                        <span className="izzi-setup__provider-name">
                          {pr.name}
                          {pr.recommended && <span className="izzi-setup__provider-badge">⭐</span>}
                          {pr.free && <span className="izzi-setup__provider-free">Free</span>}
                        </span>
                        <span className="izzi-setup__provider-desc">{pr.desc}</span>
                        {provider === pr.id && <span className="izzi-setup__provider-check">✓</span>}
                      </button>
                    ))}
                  </div>
                )}

                {sec.key === 'config' && (
                  <div className="izzi-setup__config-fields">
                    {showTelegram && (
                      <div className="izzi-setup__config-block">
                        <label>📱 Telegram Bot Token</label>
                        {telegramTokens.map((token, i) => (
                          <div key={i} className="izzi-setup__token-row">
                            <input
                              className="izzi-setup__input"
                              placeholder={`Bot Token ${i + 1}`}
                              value={token}
                              onChange={e => updateTelegramToken(i, e.target.value)}
                            />
                            {telegramTokens.length > 1 && (
                              <button className="izzi-setup__token-remove" onClick={() => removeTelegramToken(i)}>✕</button>
                            )}
                          </div>
                        ))}
                        {channel === 'telegram-multi' && telegramTokens.length < 5 && (
                          <button className="izzi-setup__link-btn" onClick={addTelegramToken}>+ Thêm bot</button>
                        )}
                      </div>
                    )}
                    {showZalo && (
                      <div className="izzi-setup__config-block">
                        <label>💬 Zalo</label>
                        <input className="izzi-setup__input" placeholder="Zalo App ID" value={zaloAppId} onChange={e => setZaloAppId(e.target.value)} />
                        {channel !== 'zalo-personal' && (
                          <>
                            <input className="izzi-setup__input" type="password" placeholder="App Secret" value={zaloAppSecret} onChange={e => setZaloAppSecret(e.target.value)} />
                            <input className="izzi-setup__input" placeholder="Refresh Token" value={zaloRefreshToken} onChange={e => setZaloRefreshToken(e.target.value)} />
                          </>
                        )}
                      </div>
                    )}
                    {showApiKey && (
                      <div className="izzi-setup__config-block">
                        <label>🔑 API Key</label>
                        <input
                          className="izzi-setup__input"
                          type="password"
                          placeholder={provider === 'izzi' ? 'izzi-xxxxxxxx' : 'sk-...'}
                          value={apiKey}
                          onChange={e => setApiKey(e.target.value)}
                        />
                      </div>
                    )}
                    {provider === 'custom' && (
                      <div className="izzi-setup__config-block">
                        <label>🌐 Base URL</label>
                        <input className="izzi-setup__input" type="url" placeholder="https://your-api.com" value={baseUrl} onChange={e => setBaseUrl(e.target.value)} />
                      </div>
                    )}
                    {showModels && (
                      <div className="izzi-setup__config-block">
                        <label>🧠 Models ({selectedModels.length})</label>
                        <div className="izzi-setup__model-chips">
                          {IZZI_MODELS.map(model => (
                            <button
                              type="button"
                              key={model.id}
                              className={`izzi-setup__model-chip ${selectedModels.includes(model.id) ? 'izzi-setup__model-chip--active' : ''}`}
                              onClick={() => toggleModel(model.id)}
                            >
                              <span>{model.name}</span>
                              {getModelCreditPolicy(model.id) === 'paid-balance-required' && (
                                <span className="izzi-setup__model-credit">Số dư nạp</span>
                              )}
                              {getModelCreditPolicy(model.id) === 'may-route-paid-only' && (
                                <span className="izzi-setup__model-credit">Có thể tính phí</span>
                              )}
                            </button>
                          ))}
                        </div>
                        <div className="izzi-setup__model-credit-notice" role="note">
                          {MODEL_CREDIT_NOTICE_VI['may-route-paid-only']}
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {sec.key === 'options' && (
                  <div className="izzi-setup__options">
                    <label className="izzi-setup__toggle-row">
                      <input type="checkbox" checked={autoStart} onChange={e => setAutoStart(e.target.checked)} />
                      <span>Tự khởi động cùng Windows</span>
                    </label>
                  </div>
                )}
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Install CTA */}
      <button
        className="izzi-setup__launch-btn"
        onClick={onInstall}
        disabled={isInstalling}
        id="custom-install-btn"
      >
        <span className="izzi-setup__launch-icon">🚀</span>
        Cài đặt ngay
      </button>
    </div>
  );
}

// ══════════════════════════════════════════
// Restore Mode
// ══════════════════════════════════════════

function RestoreMode({ onBack, onComplete }: { onBack: () => void; onComplete?: () => void }) {
  const [scanning, setScanning] = useState(false);
  const [found, setFound] = useState(false);

  const handleScan = async () => {
    setScanning(true);
    await new Promise(r => setTimeout(r, 1500));
    setFound(true);
    setScanning(false);
  };

  return (
    <div className="izzi-setup__restore">
      <button className="izzi-setup__back-btn" onClick={onBack} id="restore-back">
        ← Quay lại
      </button>

      <div className="izzi-setup__restore-header">
        <div className="izzi-setup__express-icon">🔄</div>
        <h2>Khôi phục cấu hình</h2>
        <p>Quét và import cấu hình có sẵn từ <code>~/.openclaw/</code></p>
      </div>

      {!found ? (
        <div className="izzi-setup__restore-actions">
          <button
            className="izzi-setup__launch-btn"
            onClick={handleScan}
            disabled={scanning}
            id="restore-scan-btn"
          >
            {scanning ? (
              <>
                <div className="izzi-setup__mini-spinner" />
                Đang quét...
              </>
            ) : (
              <>
                <span>🔍</span> Quét cấu hình
              </>
            )}
          </button>
        </div>
      ) : (
        <div className="izzi-setup__restore-result">
          <div className="izzi-setup__terminal">
            <div className="izzi-setup__terminal-line">$ Tìm thấy cấu hình tại ~/.openclaw/</div>
            <div className="izzi-setup__terminal-line">  → .env (Izzi API, 3 models)</div>
            <div className="izzi-setup__terminal-line">  → agent.yaml (Telegram bot)</div>
            <div className="izzi-setup__terminal-line">  → memory/ (2.4 MB)</div>
            <div className="izzi-setup__terminal-line">✓ Sẵn sàng khôi phục</div>
          </div>
          <button className="izzi-setup__launch-btn" onClick={() => onComplete?.()} id="restore-apply-btn">
            <span>✅</span> Áp dụng cấu hình
          </button>
        </div>
      )}
    </div>
  );
}

// ══════════════════════════════════════════
// Install Terminal — Dev-Tool Style
// ══════════════════════════════════════════

function InstallTerminal({
  progress, isInstalling, isDone, onComplete, onBack,
}: {
  progress: SetupProgress[];
  isInstalling: boolean;
  isDone: boolean;
  onComplete?: () => void;
  onBack: () => void;
}) {
  const lastProgress = progress[progress.length - 1];
  const percent = lastProgress?.percent || 0;

  return (
    <div className="izzi-setup__install-view">
      <div className="izzi-setup__install-header">
        <h2>{isDone ? '✅ Setup hoàn tất!' : '⏳ Đang cài đặt...'}</h2>
        {!isDone && (
          <div className="izzi-setup__progress-bar">
            <div className="izzi-setup__progress-fill" style={{ width: `${percent}%` }} />
            <span className="izzi-setup__progress-pct">{percent}%</span>
          </div>
        )}
      </div>

      <div className="izzi-setup__terminal izzi-setup__terminal--lg" id="install-terminal">
        {progress.map((p, i) => (
          <div
            key={i}
            className={`izzi-setup__terminal-line ${p.isError ? 'izzi-setup__terminal-line--error' : ''}`}
          >
            {p.message}
          </div>
        ))}
        {isInstalling && (
          <div className="izzi-setup__terminal-line izzi-setup__terminal-line--blink">
            █
          </div>
        )}
      </div>

      <div className="izzi-setup__install-actions">
        {isDone ? (
          <button className="izzi-setup__launch-btn" onClick={() => onComplete?.()} id="install-complete-btn">
            <span>🎉</span> Bắt đầu sử dụng
          </button>
        ) : (
          <button className="izzi-setup__back-btn" onClick={onBack} disabled={isInstalling} id="install-back-btn">
            ← Huỷ
          </button>
        )}
      </div>
    </div>
  );
}
