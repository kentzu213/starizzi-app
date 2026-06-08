import React, { useState } from 'react';
import type { ExternalAgent, AIProvider } from '../types/agent-registry';
import { MODEL_PROVIDERS } from '../types/agent-registry';

interface AgentSetupPanelProps {
  agent: ExternalAgent;
  onClose: () => void;
  onInstallComplete: (agentId: string) => void;
}

// Build the real, honest command a user runs to start the external agent locally.
function buildRunCommand(agent: ExternalAgent): string {
  switch (agent.setupMethod) {
    case 'docker':
      return `docker run -p ${agent.defaultPort}:${agent.defaultPort} ${agent.dockerImage ?? agent.name}`;
    case 'pip':
      return `pip install ${agent.name}${agent.version ? `==${agent.version}` : ''}`;
    case 'npm':
      return `npx ${agent.name}`;
    case 'native':
    default:
      return `# Xem hướng dẫn cài đặt tại GitHub: ${agent.githubUrl}`;
  }
}

export function AgentSetupPanel({ agent, onClose, onInstallComplete }: AgentSetupPanelProps) {
  const [step, setStep] = useState(0);
  const [selectedProvider, setSelectedProvider] = useState<AIProvider>('izzi');
  const [apiKey, setApiKey] = useState('');
  const [isProbing, setIsProbing] = useState(false);
  const [probeResult, setProbeResult] = useState<'idle' | 'reachable' | 'unreachable'>('idle');

  const steps = ['Thông tin', 'Model Provider', 'Kết nối'];

  // Honest health probe: only confirm "running" when the agent's health
  // endpoint actually responds. No simulation, no fake success.
  async function handleProbe() {
    setIsProbing(true);
    setProbeResult('idle');

    try {
      const url = `http://127.0.0.1:${agent.defaultPort}${agent.healthEndpoint}`;
      const res = await fetch(url, { signal: AbortSignal.timeout(3000) });

      if (res.ok) {
        setProbeResult('reachable');
        // Only now is the agent genuinely running — let the store reflect it.
        setTimeout(() => onInstallComplete(agent.id), 1200);
      } else {
        setProbeResult('unreachable');
      }
    } catch {
      setProbeResult('unreachable');
    } finally {
      setIsProbing(false);
    }
  }

  function renderStepContent() {
    if (step === 0) {
      return (
        <div className="agent-setup__info">
          <div className="agent-setup__hero">
            <span className="agent-setup__hero-icon">{agent.icon}</span>
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
      const supportedProviders = MODEL_PROVIDERS.filter((p) =>
        agent.supportedProviders.includes(p.id),
      );

      return (
        <div className="agent-setup__provider">
          <h3>🧠 Chọn Model Provider</h3>
          <p className="agent-setup__provider-hint">
            Chọn nguồn AI model cho {agent.displayName}. IzziAPI được khuyến nghị — tất cả model trong 1 key.
          </p>

          <div className="agent-setup__provider-list">
            {supportedProviders.map((provider) => (
              <button
                key={provider.id}
                className={`agent-setup__provider-card ${
                  selectedProvider === provider.id ? 'agent-setup__provider-card--active' : ''
                }`}
                onClick={() => setSelectedProvider(provider.id)}
                type="button"
              >
                <div className="agent-setup__provider-header">
                  <span className="agent-setup__provider-name">
                    {provider.name}
                    {provider.recommended && (
                      <span className="agent-setup__provider-badge">⭐ Recommended</span>
                    )}
                    {provider.free && (
                      <span className="agent-setup__provider-free-badge">Free</span>
                    )}
                  </span>
                  {selectedProvider === provider.id && (
                    <span className="agent-setup__provider-check">✓</span>
                  )}
                </div>
                <span className="agent-setup__provider-desc">{provider.description}</span>
              </button>
            ))}
          </div>

          {MODEL_PROVIDERS.find((p) => p.id === selectedProvider)?.apiKeyRequired && (
            <div className="agent-setup__key-field">
              <label className="agent-setup__key-label">
                API Key ({MODEL_PROVIDERS.find((p) => p.id === selectedProvider)?.name})
              </label>
              <input
                className="agent-setup__key-input"
                type="password"
                placeholder={selectedProvider === 'izzi' ? 'izzi-xxxxxxxxxxxxxxxx' : 'Nhập API key...'}
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
              />
              {selectedProvider === 'izzi' && (
                <p className="agent-setup__key-hint">
                  Chưa có key?{' '}
                  <button
                    className="agent-setup__link"
                    onClick={() => {
                      if (window.electronAPI?.shell?.openExternal) {
                        window.electronAPI.shell.openExternal('https://izziapi.com/dashboard/keys');
                      } else {
                        window.open('https://izziapi.com/dashboard/keys', '_blank');
                      }
                    }}
                    type="button"
                  >
                    Tạo miễn phí tại izziapi.com →
                  </button>
                </p>
              )}
            </div>
          )}
        </div>
      );
    }

    // Step 2: Connect — honest manual setup + real health probe (no simulation)
    return (
      <div className="agent-setup__install">
        <h3>🔌 Kết nối {agent.displayName}</h3>

        <div className="agent-setup__error">
          ⚠️ Đây là agent mã nguồn mở của bên thứ ba. Izzi <strong>chưa</strong> tự động
          cài/chạy agent này cho bạn — bạn cần tự khởi chạy nó ở máy của mình rồi bấm
          "Kiểm tra kết nối" bên dưới.
        </div>

        <div className="agent-setup__install-summary">
          <div className="agent-setup__install-row">
            <span>Agent:</span>
            <span>{agent.icon} {agent.displayName}</span>
          </div>
          <div className="agent-setup__install-row">
            <span>Provider:</span>
            <span>{MODEL_PROVIDERS.find((p) => p.id === selectedProvider)?.name}</span>
          </div>
          <div className="agent-setup__install-row">
            <span>Method:</span>
            <span>{agent.setupMethod === 'docker' ? '🐳 Docker' : agent.setupMethod}</span>
          </div>
          <div className="agent-setup__install-row">
            <span>Phải chạy tại:</span>
            <span>127.0.0.1:{agent.defaultPort}</span>
          </div>
        </div>

        <div className="agent-setup__meta">
          <span className="agent-setup__meta-label">Lệnh cài/chạy (chạy trong terminal của bạn):</span>
          <div className="agent-setup__terminal">
            <div className="agent-setup__terminal-line">$ {buildRunCommand(agent)}</div>
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
          📘 Hướng dẫn cài đặt đầy đủ trên GitHub →
        </a>

        {probeResult === 'reachable' && (
          <div className="agent-setup__success">
            ✅ Đã phát hiện {agent.displayName} đang chạy ở port {agent.defaultPort}. Sẵn sàng chat.
          </div>
        )}

        {probeResult === 'unreachable' && (
          <div className="agent-setup__error">
            ❌ Chưa phát hiện {agent.displayName} đang chạy ở port {agent.defaultPort}.
            Hãy chắc chắn agent đã khởi động rồi thử lại.
          </div>
        )}

        {!isProbing && probeResult !== 'reachable' && (
          <button
            className="agent-setup__install-btn"
            onClick={handleProbe}
            type="button"
          >
            🔍 Kiểm tra kết nối
          </button>
        )}

        {isProbing && (
          <div className="agent-setup__installing">
            <div className="agent-setup__spinner" />
            <span>Đang kiểm tra {agent.defaultPort}...</span>
          </div>
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
          {step > 0 && probeResult !== 'reachable' && (
            <button
              className="agent-setup__nav-btn agent-setup__nav-btn--back"
              onClick={() => setStep(step - 1)}
              disabled={isProbing}
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
