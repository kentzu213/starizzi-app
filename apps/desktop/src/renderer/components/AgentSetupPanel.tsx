import React, { useEffect, useRef, useState } from 'react';
import { MODEL_CREDIT_NOTICE_VI } from '../../shared/model-credit-policy';
import type { ExternalAgent } from '../types/agent-registry';

/** Editorial monogram from a display name (e.g. "Hermes Agent" -> "HA"). */
function monogram(name: string): string {
  const c = (name || '').trim();
  if (!c) return '??';
  const w = c.split(/\s+/).filter(Boolean);
  return (w.length >= 2 ? (w[0][0] + w[1][0]) : c.slice(0, 2)).toUpperCase();
}

interface AgentSetupPanelProps {
  agent: ExternalAgent;
  onClose: () => void;
  onInstallComplete: (agentId: string) => void;
}

/** Manual `docker run` command shown to the user for copy/paste. */
function buildRunCommand(agent: ExternalAgent): string {
  const name = `izzi-agent-${agent.id}`;
  const port = agent.defaultPort;
  return `docker run -d --name ${name} -p ${port}:${port} ${agent.dockerImage ?? '<image>'}`;
}

/**
 * Probe an agent's health endpoint via the MAIN process (Node — no CORS/Origin
 * restrictions). The renderer's own `fetch` always sends an `Origin` header and
 * is CORS-enforced; some agent health servers (e.g. Hermes' aiohttp server)
 * reject browser-origin requests with 403 and send no CORS headers, so a healthy
 * agent would look unreachable. Falls back to a direct fetch if the bridge is old.
 */
async function probeHealth(agent: ExternalAgent, timeoutMs = 5000): Promise<boolean> {
  const bridge = (window.electronAPI as any)?.dockerAgent;
  if (bridge?.healthCheck) {
    try {
      const res = await bridge.healthCheck({
        defaultPort: agent.defaultPort,
        healthEndpoint: agent.healthEndpoint,
        timeoutMs,
      });
      return !!res?.ok;
    } catch {
      return false;
    }
  }
  // Fallback for an older preload bridge (subject to CORS — best effort).
  try {
    const url = `http://127.0.0.1:${agent.defaultPort}${agent.healthEndpoint}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
    return res.ok;
  } catch {
    return false;
  }
}

export function AgentSetupPanel({ agent, onClose, onInstallComplete }: AgentSetupPanelProps) {
  const [step, setStep] = useState(0);
  const [isInstalling, setIsInstalling] = useState(false);
  const [installLog, setInstallLog] = useState<string[]>([]);
  const [installDone, setInstallDone] = useState(false);
  const [installError, setInstallError] = useState<string | null>(null);
  const [dockerMissing, setDockerMissing] = useState(false);
  const [isProbing, setIsProbing] = useState(false);
  const [probeMessage, setProbeMessage] = useState<string | null>(null);
  // Upfront Docker detection so we can show the best path per machine
  // ('available' → 1-click install; 'missing' → guidance + download link).
  const [dockerStatus, setDockerStatus] = useState<'unknown' | 'checking' | 'available' | 'missing'>('unknown');

  const isDocker = agent.setupMethod === 'docker';
  const needsCompose = isDocker && !!agent.dockerComposeUrl;
  const dockerAgentApi = (window.electronAPI as any)?.dockerAgent;

  const steps = ['Thông tin', 'Model', 'Cài đặt'];
  const logEndRef = useRef<HTMLDivElement | null>(null);

  function appendLog(line: string) {
    setInstallLog((prev) => [...prev, line]);
  }

  // Subscribe to real docker pull progress for this agent.
  useEffect(() => {
    if (!dockerAgentApi?.onProgress) return;
    const off = dockerAgentApi.onProgress((data: { agentId: string; line: string }) => {
      if (data.agentId === agent.id) {
        appendLog(`  ${data.line}`);
      }
    });
    return () => { off?.(); };
  }, [agent.id, dockerAgentApi]);

  // Auto-scroll terminal to bottom on new lines.
  useEffect(() => {
    logEndRef.current?.scrollIntoView({ block: 'end' });
  }, [installLog]);

  /** Detect Docker availability as soon as the user reaches the install step. */
  async function detectDocker() {
    setDockerStatus('checking');
    try {
      const ok = dockerAgentApi ? await dockerAgentApi.isAvailable() : false;
      setDockerStatus(ok ? 'available' : 'missing');
    } catch {
      setDockerStatus('missing');
    }
  }

  useEffect(() => {
    if (step !== 2 || !isDocker) return;
    let cancelled = false;
    setDockerStatus('checking');
    (async () => {
      try {
        const ok = dockerAgentApi ? await dockerAgentApi.isAvailable() : false;
        if (!cancelled) setDockerStatus(ok ? 'available' : 'missing');
      } catch {
        if (!cancelled) setDockerStatus('missing');
      }
    })();
    return () => { cancelled = true; };
  }, [step, isDocker, dockerAgentApi]);

  /** Open the Docker Desktop download page in the user's browser. */
  function openDockerDownload() {
    const url = 'https://www.docker.com/products/docker-desktop/';
    if (window.electronAPI?.shell?.openExternal) {
      window.electronAPI.shell.openExternal(url);
    } else {
      window.open(url, '_blank');
    }
  }

  /** Real Docker install pipeline: pull → run → health-probe (with retries). */
  async function handleInstall() {
    setIsInstalling(true);
    setInstallLog([]);
    setInstallError(null);
    setDockerMissing(false);
    setInstallDone(false);

    if (!dockerAgentApi) {
      setInstallError('Không tìm thấy cầu nối Docker (electronAPI.dockerAgent). Hãy khởi động lại app.');
      setIsInstalling(false);
      return;
    }

    try {
      // 1. Docker daemon availability
      appendLog('$ docker info');
      const available = await dockerAgentApi.isAvailable();
      if (!available) {
        appendLog('  ✗ Docker daemon không phản hồi.');
        setDockerMissing(true);
        setInstallError('Docker chưa chạy. Hãy mở Docker Desktop rồi thử lại (hoặc cài thủ công theo hướng dẫn bên dưới).');
        setIsInstalling(false);
        return;
      }
      appendLog('  ✓ Docker đang chạy.');

      // 2. Pull image (streamed output via onProgress)
      appendLog(`$ docker pull ${agent.dockerImage}`);
      const pull = await dockerAgentApi.install({
        id: agent.id,
        dockerImage: agent.dockerImage,
        defaultPort: agent.defaultPort,
        dockerComposeUrl: agent.dockerComposeUrl,
      });
      if (!pull.ok) {
        appendLog(`✗ Pull thất bại: ${pull.error}`);
        setInstallError(`Pull image thất bại: ${pull.error}`);
        setIsInstalling(false);
        return;
      }
      appendLog('  ✓ Image đã sẵn sàng.');
      if (agent.id === 'hermes') {
        appendLog('  ℹ️ Hermes có thể mất vài phút để khởi động lần đầu.');
      }

      // 3. Run / start container
      appendLog(`$ docker run -d --name izzi-agent-${agent.id} -p ${agent.defaultPort}:${agent.defaultPort} ${agent.dockerImage}`);
      const start = await dockerAgentApi.start({
        id: agent.id,
        dockerImage: agent.dockerImage,
        defaultPort: agent.defaultPort,
        dockerComposeUrl: agent.dockerComposeUrl,
      });
      if (!start.ok) {
        appendLog(`✗ Khởi động container thất bại: ${start.error}`);
        setInstallError(`Khởi động container thất bại: ${start.error}`);
        setIsInstalling(false);
        return;
      }
      appendLog(`  ✓ Container đang chạy (${start.containerId?.slice(0, 12) ?? 'started'}).`);

      // 4. Health probe with retries (container needs time to boot)
      appendLog(`$ health-check http://127.0.0.1:${agent.defaultPort}${agent.healthEndpoint}`);
      let healthy = false;
      // Hermes does heavy first-boot setup (bundles skills, etc.) — allow longer.
      const maxAttempts = agent.id === 'hermes' ? 20 : 6;
      for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        appendLog(`  … thử kết nối lần ${attempt}/${maxAttempts}`);
        healthy = await probeHealth(agent, 5000);
        if (healthy) break;
        await new Promise((r) => setTimeout(r, 3000));
      }

      if (!healthy) {
        appendLog('✗ Container chạy nhưng health endpoint chưa phản hồi.');
        setInstallError(
          `Container đã khởi động nhưng chưa phản hồi tại ${agent.healthEndpoint} (port ${agent.defaultPort}). ` +
          'Agent có thể cần thêm thời gian hoặc cấu hình. Dùng "Kiểm tra kết nối" sau ít phút.',
        );
        setIsInstalling(false);
        return;
      }

      appendLog(`✓ ${agent.displayName} đã chạy và phản hồi health-check!`);
      if (agent.id === 'hermes') {
        appendLog('  ✓ Đã định tuyến qua Izzi smart router của bạn — sẵn sàng chat.');
        appendLog('     (App tự quản lý key/định tuyến; chỉ cần đăng nhập Izzi trong app.)');
      }
      setInstallDone(true);
      setIsInstalling(false);
      setTimeout(() => onInstallComplete(agent.id), 1200);
    } catch (err: any) {
      appendLog(`✗ Lỗi: ${err?.message ?? 'unknown'}`);
      setInstallError(err?.message || 'Cài đặt thất bại');
      setIsInstalling(false);
    }
  }

  /** Manual connection probe (works for any agent the user started themselves). */
  async function handleProbe() {
    setIsProbing(true);
    setProbeMessage(null);
    const healthy = await probeHealth(agent, 5000);
    if (healthy) {
      setProbeMessage(`✓ Kết nối thành công tới ${agent.displayName} (port ${agent.defaultPort}).`);
      onInstallComplete(agent.id);
    } else {
      setProbeMessage(
        `✗ Chưa kết nối được tới 127.0.0.1:${agent.defaultPort}${agent.healthEndpoint}. ` +
        'Hãy chắc chắn agent đang chạy.',
      );
    }
    setIsProbing(false);
  }

  function renderStepContent() {
    if (step === 0) {
      return (
        <div className="agent-setup__info">
          <div className="agent-setup__hero">
            <span className="agent-setup__hero-icon">{monogram(agent.displayName)}</span>
            <div>
              <h3 className="agent-setup__hero-name">{agent.displayName}</h3>
              <div className="agent-setup__hero-stars">
                ⭐ {agent.githubStars} GitHub stars
              </div>
            </div>
          </div>

          <p className="agent-setup__desc">{agent.longDescription}</p>

          <div className="agent-setup__features">
            <h4>Tính năng:</h4>
            <div className="agent-setup__feature-list">
              {agent.features.map((f) => (
                <span key={f} className="agent-setup__feature-tag">
                  ✅ {f}
                </span>
              ))}
            </div>
          </div>

          <div className="agent-setup__meta">
            <div className="agent-setup__meta-item">
              <span className="agent-setup__meta-label">Setup method:</span>
              <span className="agent-setup__meta-value">
                {agent.setupMethod === 'docker' && '🐳 Docker'}
                {agent.setupMethod === 'npm' && '📦 npm'}
                {agent.setupMethod === 'pip' && '🐍 pip'}
                {agent.setupMethod === 'native' && '💻 Native'}
              </span>
            </div>
            <div className="agent-setup__meta-item">
              <span className="agent-setup__meta-label">Default port:</span>
              <span className="agent-setup__meta-value">{agent.defaultPort}</span>
            </div>
            <div className="agent-setup__meta-item">
              <span className="agent-setup__meta-label">Category:</span>
              <span className="agent-setup__meta-value">{agent.category}</span>
            </div>
          </div>

          <a
            className="agent-setup__github-link"
            href={agent.githubUrl}
            onClick={(e) => {
              e.preventDefault();
              if (window.electronAPI?.shell?.openExternal) {
                window.electronAPI.shell.openExternal(agent.githubUrl);
              } else {
                window.open(agent.githubUrl, '_blank');
              }
            }}
          >
            📘 Xem trên GitHub →
          </a>
        </div>
      );
    }

    if (step === 1) {
      return (
        <div className="agent-setup__provider">
          <h3>⚡ Model — Izzi Smart Router</h3>
          <p className="agent-setup__provider-hint">
            {agent.displayName} sẽ dùng <strong>Izzi Smart Router</strong> của bạn: hệ thống tự
            chọn model tốt nhất cho mỗi yêu cầu, tính phí vào tài khoản Izzi đã đăng nhập.
          </p>

          <div className="agent-setup__credit-notice" role="note">
            {MODEL_CREDIT_NOTICE_VI['may-route-paid-only']}
          </div>
          <div className="agent-setup__provider-card agent-setup__provider-card--active" aria-hidden>
            <div className="agent-setup__provider-header">
              <span className="agent-setup__provider-name">
                ⚡ Izzi Smart Router
                <span className="agent-setup__provider-badge">Mặc định</span>
              </span>
              <span className="agent-setup__provider-check">✓</span>
            </div>
            <span className="agent-setup__provider-desc">
              Tất cả model trong 1 key — không cần chọn provider hay nhập API key thủ công.
            </span>
          </div>

          <p className="agent-setup__provider-hint" style={{ marginTop: 12 }}>
            🔒 Key/định tuyến do app quản lý an toàn (không lưu trong container). Chỉ cần đảm bảo
            bạn đã <strong>đăng nhập Izzi</strong> trong app. Chưa có tài khoản?{' '}
            <button
              className="agent-setup__link"
              onClick={() => {
                if (window.electronAPI?.shell?.openExternal) {
                  window.electronAPI.shell.openExternal('https://izziapi.com');
                } else {
                  window.open('https://izziapi.com', '_blank');
                }
              }}
              type="button"
            >
              Tạo miễn phí tại izziapi.com →
            </button>
          </p>
        </div>
      );
    }

    // Step 2: Install
    return (
      <div className="agent-setup__install">
        <h3>🚀 Cài đặt {agent.displayName}</h3>

        {!isInstalling && !installDone && installLog.length === 0 && (
          <div className="agent-setup__install-summary">
            <div className="agent-setup__install-row">
              <span>Agent:</span>
              <span>{agent.displayName}</span>
            </div>
            <div className="agent-setup__install-row">
              <span>Model:</span>
              <span>⚡ Izzi Smart Router</span>
            </div>
            <div className="agent-setup__install-row">
              <span>Method:</span>
              <span>{isDocker ? '🐳 Docker' : agent.setupMethod}</span>
            </div>
            <div className="agent-setup__install-row">
              <span>Port:</span>
              <span>{agent.defaultPort}</span>
            </div>
          </div>
        )}

        {needsCompose && (
          <div className="agent-setup__error" style={{ background: 'var(--color-warning-bg)', color: 'var(--color-warning)' }}>
            ⚠️ {agent.displayName} cần Docker Compose (nhiều service). Cài tự động một-container có thể không đủ —
            xem hướng dẫn compose thủ công bên dưới nếu bản tự động không lên được.
          </div>
        )}

        {installLog.length > 0 && (
          <div className="agent-setup__terminal">
            {installLog.map((line, i) => (
              <div
                key={i}
                className={`agent-setup__terminal-line ${
                  line.startsWith('✓') ? 'agent-setup__terminal-line--ok' :
                  line.startsWith('✗') ? 'agent-setup__terminal-line--err' : ''
                }`}
              >
                {line}
              </div>
            ))}
            <div ref={logEndRef} />
          </div>
        )}

        {installDone && (
          <div className="agent-setup__success">
            🎉 {agent.displayName} đã chạy và phản hồi! Bạn có thể bắt đầu chat ngay.
          </div>
        )}

        {installError && (
          <div className="agent-setup__error">❌ {installError}</div>
        )}

        {probeMessage && (
          <div
            className={probeMessage.startsWith('✓') ? 'agent-setup__success' : 'agent-setup__error'}
          >
            {probeMessage}
          </div>
        )}

        {/* Docker detected → 1-click auto-install */}
        {isDocker && dockerStatus === 'available' && !isInstalling && !installDone && (
          <>
            <div className="agent-setup__success" style={{ marginBottom: 8 }}>
              🐳 Đã phát hiện Docker trên máy — có thể cài tự động 1 chạm.
            </div>
            <button
              className="agent-setup__install-btn"
              onClick={handleInstall}
              type="button"
            >
              🚀 Cài tự động bằng Docker (1 chạm)
            </button>
          </>
        )}

        {/* Checking Docker availability */}
        {isDocker && dockerStatus === 'checking' && !isInstalling && !installDone && (
          <div className="agent-setup__installing">
            <div className="agent-setup__spinner" />
            <span>Đang kiểm tra Docker trên máy…</span>
          </div>
        )}

        {/* Docker missing → friendly guidance + download link + re-check */}
        {isDocker && dockerStatus === 'missing' && !isInstalling && !installDone && (
          <div className="agent-setup__error" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <span>
              🐳 Máy bạn chưa cài hoặc chưa mở Docker. Bạn có thể cài Docker để dùng cài tự động 1 chạm,
              hoặc làm theo hướng dẫn thủ công bên dưới rồi bấm "Kiểm tra kết nối".
            </span>
            <div className="action-row" style={{ gap: 8 }}>
              <button className="btn btn--primary btn--sm" onClick={openDockerDownload} type="button">
                ⬇️ Tải Docker Desktop
              </button>
              <button className="btn btn--ghost btn--sm" onClick={() => void detectDocker()} type="button">
                🔄 Kiểm tra lại Docker
              </button>
            </div>
          </div>
        )}

        {isInstalling && (
          <div className="agent-setup__installing">
            <div className="agent-setup__spinner" />
            <span>Đang cài đặt thật (docker pull/run)…</span>
          </div>
        )}

        {/* Manual guidance — for non-docker agents, when Docker is missing,
            for compose-based agents, or if an install attempt found Docker missing. */}
        {(!isDocker || dockerStatus === 'missing' || dockerMissing || needsCompose) && !installDone && (
          <div className="agent-setup__install-summary" style={{ marginTop: 12 }}>
            <div className="agent-setup__install-row" style={{ justifyContent: 'flex-start' }}>
              <strong style={{ color: 'var(--color-text-primary)' }}>
                📖 Hướng dẫn cài thủ công
              </strong>
            </div>
            {!isDocker && (
              <p className="agent-setup__provider-hint" style={{ margin: 0 }}>
                {agent.displayName} dùng phương thức <code>{agent.setupMethod}</code> — chưa hỗ trợ cài tự động.
                Làm theo các bước rồi bấm "Kiểm tra kết nối".
              </p>
            )}
            <ol style={{ margin: '4px 0 0', paddingLeft: 18, fontSize: 12, color: 'var(--color-text-secondary)' }}>
              {agent.setupSteps.map((s, i) => (
                <li key={i} style={{ padding: '2px 0' }}>{s}</li>
              ))}
            </ol>
            {isDocker && (
              <code className="agent-setup__code-block">
                {needsCompose
                  ? `# Compose: tải ${agent.dockerComposeUrl} rồi: docker compose up -d`
                  : buildRunCommand(agent)}
              </code>
            )}
          </div>
        )}

        {/* Manual connection probe — always available */}
        {!installDone && (
          <button
            className="agent-setup__nav-btn agent-setup__nav-btn--back"
            style={{ width: '100%', marginTop: 10 }}
            onClick={handleProbe}
            disabled={isProbing || isInstalling}
            type="button"
          >
            {isProbing ? '⏳ Đang kiểm tra…' : '🔌 Kiểm tra kết nối'}
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="agent-modal-overlay" onClick={onClose}>
      <div className="agent-setup glass-card" onClick={(e) => e.stopPropagation()}>
        <button className="agent-modal__close" onClick={onClose} type="button">✕</button>

        {/* Progress */}
        <div className="agent-setup__progress">
          {steps.map((label, i) => (
            <div
              key={label}
              className={`agent-setup__progress-step ${
                i === step ? 'agent-setup__progress-step--active' :
                i < step ? 'agent-setup__progress-step--done' : ''
              }`}
            >
              <span className="agent-setup__progress-num">{i < step ? '✓' : i + 1}</span>
              <span className="agent-setup__progress-label">{label}</span>
            </div>
          ))}
        </div>

        {/* Content */}
        {renderStepContent()}

        {/* Navigation */}
        <div className="agent-setup__nav">
          {step > 0 && !installDone && (
            <button
              className="agent-setup__nav-btn agent-setup__nav-btn--back"
              onClick={() => setStep(step - 1)}
              disabled={isInstalling}
              type="button"
            >
              ← Quay lại
            </button>
          )}
          {step < steps.length - 1 && (
            <button
              className="agent-setup__nav-btn agent-setup__nav-btn--next"
              onClick={() => setStep(step + 1)}
              type="button"
            >
              Tiếp theo →
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
