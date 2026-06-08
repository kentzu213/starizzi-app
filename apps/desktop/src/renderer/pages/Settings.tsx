import React, { useEffect, useState } from 'react';
import { AgentStatusBadge } from '../components/AgentStatusBadge';
import { useAgentWorkspaceStore } from '../store/agentWorkspace';
import type {
  AgentRuntimeState,
  DiagnosticEvent,
  IntegrationConnection,
} from '../../main/agent/types';
import type { DesktopUpdaterState } from '../../main/updater/types';

interface SettingsPageProps {
  user: any;
  onLogout: () => void;
  onRefresh?: () => void;
  onOpenClawQuickInstall?: () => void;
  onBuyApi?: () => void;
}

type SettingsSectionId =
  | 'account'
  | 'runner'
  | 'customProvider'
  | 'updates'
  | 'integrations'
  | 'diagnostics'
  | 'danger';

interface SectionMeta {
  id: SettingsSectionId;
  label: string;
}

const SECTIONS: SectionMeta[] = [
  { id: 'account', label: 'Tài khoản' },
  { id: 'runner', label: 'Runner & Plan' },
  { id: 'customProvider', label: 'Custom Provider' },
  { id: 'updates', label: 'Cập nhật' },
  { id: 'integrations', label: 'Tích hợp' },
  { id: 'diagnostics', label: 'Chẩn đoán' },
  { id: 'danger', label: 'Danger zone' },
];

export function SettingsPage({
  user,
  onLogout,
  onRefresh,
  onOpenClawQuickInstall,
  onBuyApi,
}: SettingsPageProps) {
  const runtimeState = useAgentWorkspaceStore((state) => state.runtimeState);
  const diagnostics = useAgentWorkspaceStore((state) => state.diagnostics);
  const onboardingState = useAgentWorkspaceStore((state) => state.onboardingState);
  const integrations = useAgentWorkspaceStore((state) => state.integrations);
  const updaterState = useAgentWorkspaceStore((state) => state.updaterState);
  const refreshDiagnostics = useAgentWorkspaceStore((state) => state.refreshDiagnostics);
  const refreshIntegrations = useAgentWorkspaceStore((state) => state.refreshIntegrations);
  const openOnboarding = useAgentWorkspaceStore((state) => state.openOnboarding);
  const checkForUpdates = useAgentWorkspaceStore((state) => state.checkForUpdates);
  const downloadUpdate = useAgentWorkspaceStore((state) => state.downloadUpdate);
  const restartToUpdate = useAgentWorkspaceStore((state) => state.restartToUpdate);

  const [activeSection, setActiveSection] = useState<SettingsSectionId>('account');

  useEffect(() => {
    void Promise.all([refreshDiagnostics(10), refreshIntegrations()]);
  }, [refreshDiagnostics, refreshIntegrations]);

  return (
    <div>
      <div className="page-header">
        <h1 className="page-header__title">Settings</h1>
        <p className="page-header__subtitle">Quản lý tài khoản, managed runner, onboarding và diagnostic của desktop app.</p>
      </div>

      <div className="card glass-card section-gap">
        <div className="card__header">
          <h3 className="card__title">Core actions</h3>
        </div>
        <div className="action-row">
          <button className="btn btn--primary" onClick={onOpenClawQuickInstall}>
            Mở / cài OpenClaw
          </button>
          <button className="btn btn--secondary" onClick={onBuyApi}>
            Mua API trên IzziAPI
          </button>
          <button className="btn btn--ghost" onClick={onRefresh}>
            Refresh profile
          </button>
        </div>
      </div>

      {onboardingState?.hasPendingSetup && <OnboardingBanner onOpen={openOnboarding} />}

      <SettingsNav active={activeSection} onSelect={setActiveSection} />

      <div className="ext-detail__content">
        {activeSection === 'account' && (
          <AccountSection
            user={user}
            onOpenDashboard={() =>
              window.electronAPI?.shell.openExternal('https://izziapi.com/dashboard/settings')
            }
          />
        )}
        {activeSection === 'runner' && <RunnerPlanSection runtimeState={runtimeState} user={user} />}
        {activeSection === 'customProvider' && <CustomProviderSection />}
        {activeSection === 'updates' && (
          <UpdatesSection
            updaterState={updaterState}
            onCheck={() => void checkForUpdates()}
            onDownload={() => void downloadUpdate()}
            onRestart={() => void restartToUpdate()}
          />
        )}
        {activeSection === 'integrations' && (
          <IntegrationsSection
            integrations={integrations}
            onRefresh={() => void refreshIntegrations()}
          />
        )}
        {activeSection === 'diagnostics' && (
          <DiagnosticsSection diagnostics={diagnostics} onRefresh={() => void refreshDiagnostics(10)} />
        )}
        {activeSection === 'danger' && <DangerZoneSection onLogout={onLogout} />}
      </div>
    </div>
  );
}

function SettingsNav({
  active,
  onSelect,
}: {
  active: SettingsSectionId;
  onSelect: (id: SettingsSectionId) => void;
}) {
  return (
    <div className="ext-detail__tabs section-gap">
      {SECTIONS.map((section) => (
        <button
          key={section.id}
          className={`ext-detail__tab${active === section.id ? ' ext-detail__tab--active' : ''}`}
          onClick={() => onSelect(section.id)}
        >
          {section.label}
        </button>
      ))}
    </div>
  );
}

function OnboardingBanner({ onOpen }: { onOpen: () => void }) {
  return (
    <div className="card glass-card section-gap card--accent">
      <div className="card__header">
        <h3 className="card__title">Finish setup</h3>
        <button className="btn btn--primary btn--sm" onClick={onOpen}>
          Mở onboarding
        </button>
      </div>
      <p className="card__body-copy">
        Wizard vẫn chưa được hoàn tất. Bạn có thể mở lại bất kỳ lúc nào để kết nối Telegram, Discord và Zalo.
      </p>
    </div>
  );
}

function AccountSection({ user, onOpenDashboard }: { user: any; onOpenDashboard: () => void }) {
  return (
    <div className="card glass-card">
      <div className="card__header">
        <h3 className="card__title">Account</h3>
        <button className="btn btn--ghost btn--sm" onClick={onOpenDashboard}>
          Mở trên IzziAPI
        </button>
      </div>

      <div className="settings-group">
        <SettingRow label="Name" value={user?.name || 'N/A'} />
        <SettingRow label="Email" value={user?.email || 'N/A'} />
        <SettingRow label="Role" value={user?.role || 'user'} />
        <SettingRow label="Active keys" value={String(user?.activeKeys || 0)} />
        <SettingRow
          label="Joined"
          value={user?.createdAt ? new Date(user.createdAt).toLocaleDateString('vi-VN') : 'N/A'}
        />
      </div>
    </div>
  );
}

function RunnerPlanSection({ runtimeState, user }: { runtimeState: AgentRuntimeState; user: any }) {
  return (
    <div className="card glass-card">
      <div className="card__header">
        <h3 className="card__title">Managed Runner</h3>
      </div>

      <div className="settings-group">
        <div className="settings-item">
          <div>
            <div className="settings-item__label">Connection</div>
            <div className="settings-item__description">Desktop app đang sử dụng managed runner qua IzziAPI.</div>
          </div>
          <AgentStatusBadge state={runtimeState.state} detail={runtimeState.lastError} />
        </div>

        <SettingRow label="Plan" value={(user?.plan || 'free').toString()} />
        <SettingRow
          label="Balance"
          value={user?.balance !== undefined ? `$${Number(user.balance).toFixed(2)}` : '$0.00'}
        />
        <SettingRow
          label="Last agent status"
          value={`${runtimeState.state} / ${new Date(runtimeState.updatedAt).toLocaleString('vi-VN')}`}
        />
        {runtimeState.lastError && <SettingRow label="Last error" value={runtimeState.lastError} />}
      </div>
    </div>
  );
}

function UpdatesSection({
  updaterState,
  onCheck,
  onDownload,
  onRestart,
}: {
  updaterState: DesktopUpdaterState;
  onCheck: () => void;
  onDownload: () => void;
  onRestart: () => void;
}) {
  const [isUpdaterErrorExpanded, setExpanded] = useState(false);

  return (
    <div className="card glass-card">
      <div className="card__header">
        <h3 className="card__title">Desktop updates</h3>
        <div className="action-row">
          <button className="btn btn--ghost btn--sm" onClick={onCheck}>
            Kiểm tra
          </button>
          {updaterState.state === 'available' && (
            <button className="btn btn--primary btn--sm" onClick={onDownload}>
              Tải xuống
            </button>
          )}
          {updaterState.state === 'downloaded' && (
            <button className="btn btn--primary btn--sm" onClick={onRestart}>
              Khởi động lại
            </button>
          )}
        </div>
      </div>
      <div className="settings-group">
        <SettingRow label="State" value={updaterState.state} />
        <SettingRow label="Current version" value={updaterState.version || 'N/A'} />
        <SettingRow label="Available version" value={updaterState.availableVersion || 'Không có'} />
        <SettingRow
          label="Progress"
          value={typeof updaterState.progress === 'number' ? `${updaterState.progress}%` : 'N/A'}
        />
        {updaterState.error && (
          <>
            <div className="settings-item">
              <div className="settings-item__label">Updater error</div>
              <button className="btn btn--ghost btn--sm" onClick={() => setExpanded((value) => !value)}>
                {isUpdaterErrorExpanded ? 'Thu gọn' : 'Xem chi tiết'}
              </button>
            </div>
            {isUpdaterErrorExpanded ? (
              <pre className="settings-error__detail">{updaterState.error}</pre>
            ) : (
              <div className="settings-item__description settings-error__summary">
                {summarizeError(updaterState.error)}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function IntegrationsSection({
  integrations,
  onRefresh,
}: {
  integrations: IntegrationConnection[];
  onRefresh: () => void;
}) {
  return (
    <div className="card glass-card">
      <div className="card__header">
        <h3 className="card__title">Integrations</h3>
        <button className="btn btn--ghost btn--sm" onClick={onRefresh}>
          Làm mới
        </button>
      </div>

      <div className="settings-group">
        {integrations.map((integration) => (
          <div key={integration.provider} className="settings-item">
            <div>
              <div className="settings-item__label">{integration.provider}</div>
              <div className="settings-item__description">
                {integration.accountLabel || 'Chưa kết nối'}
              </div>
            </div>
            <span
              className={`sync-badge sync-badge--${
                integration.status === 'connected'
                  ? 'success'
                  : integration.status === 'error'
                    ? 'error'
                    : 'idle'
              }`}
            >
              {integration.status}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

function DiagnosticsSection({
  diagnostics,
  onRefresh,
}: {
  diagnostics: DiagnosticEvent[];
  onRefresh: () => void;
}) {
  return (
    <div className="card glass-card">
      <div className="card__header">
        <h3 className="card__title">Diagnostics</h3>
        <button className="btn btn--ghost btn--sm" onClick={onRefresh}>
          Làm mới
        </button>
      </div>

      {diagnostics.length === 0 ? (
        <p className="empty-copy">
          Chưa có diagnostic event nào được ghi lại.
        </p>
      ) : (
        <div className="diagnostic-list">
          {diagnostics.map((event) => (
            <div key={event.id} className="diagnostic-card">
              <div className="diagnostic-card__head">
                <strong>{event.type}</strong>
                <span
                  className={`sync-badge sync-badge--${
                    event.status === 'error' ? 'error' : event.status === 'success' ? 'success' : 'idle'
                  }`}
                >
                  {event.status}
                </span>
              </div>
              <div className="diagnostic-card__body">{event.detail}</div>
              <div className="diagnostic-card__time">
                {new Date(event.timestamp).toLocaleString('vi-VN')}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function DangerZoneSection({ onLogout }: { onLogout: () => void }) {
  return (
    <div className="card glass-card">
      <div className="card__header">
        <h3 className="card__title card__title--danger">
          Danger zone
        </h3>
      </div>
      <div className="danger-row">
        <div>
          <div className="danger-row__title">Đăng xuất</div>
          <div className="danger-row__copy">
            Ngắt kết nối tài khoản IzziAPI khỏi desktop app.
          </div>
        </div>
        <button className="btn btn--danger" onClick={onLogout}>
          Đăng xuất
        </button>
      </div>
    </div>
  );
}

const ALLOWED_MODELS_UI = ['gpt-5.5', 'gpt-5.4', 'gpt-5.4-mini', 'gpt-5.3-codex'] as const;

interface CustomProviderConfigView {
  baseUrl: string;
  authType: 'bearer' | 'x-api-key';
  selectedModel: string;
}

function CustomProviderSection() {
  const [enabled, setEnabled] = useState(false);
  const [baseUrl, setBaseUrl] = useState('');
  const [authType, setAuthType] = useState<'bearer' | 'x-api-key'>('bearer');
  const [selectedModel, setSelectedModel] = useState<string>(ALLOWED_MODELS_UI[0]);
  const [apiKey, setApiKey] = useState('');
  const [hasKey, setHasKey] = useState(false);
  const [maskedKeyHint, setMaskedKeyHint] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function loadConfig() {
    if (!window.electronAPI?.customProvider) return;
    try {
      const result = await window.electronAPI.customProvider.getConfig();
      const config = result.config as CustomProviderConfigView | null;
      setEnabled(Boolean(result.enabled));
      setHasKey(Boolean(result.hasKey));
      setMaskedKeyHint(result.maskedKeyHint ?? null);
      if (config) {
        setBaseUrl(config.baseUrl ?? '');
        setAuthType(config.authType ?? 'bearer');
        setSelectedModel(config.selectedModel ?? ALLOWED_MODELS_UI[0]);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Không tải được cấu hình');
    }
  }

  useEffect(() => {
    void loadConfig();
  }, []);

  async function handleSave() {
    if (!window.electronAPI?.customProvider) return;
    setBusy(true);
    setError(null);
    setInfo(null);
    try {
      const result = await window.electronAPI.customProvider.saveConfig({
        baseUrl,
        authType,
        selectedModel,
        apiKey: apiKey || undefined,
      });
      if (!result.ok) {
        setError((result.errors || ['Lưu thất bại']).join('; '));
        return;
      }
      setApiKey('');
      setInfo('Đã lưu cấu hình.');
      await loadConfig();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Lưu thất bại');
    } finally {
      setBusy(false);
    }
  }

  async function handleToggle(next: boolean) {
    if (!window.electronAPI?.customProvider) return;
    setBusy(true);
    setError(null);
    setInfo(null);
    try {
      const result = await window.electronAPI.customProvider.setEnabled(next);
      if (!result.ok) {
        setError((result.errors || ['Không thể bật custom provider']).join('; '));
        setEnabled(false);
        return;
      }
      setEnabled(result.activeProvider === 'custom');
      setInfo(`Active provider: ${result.activeProvider}.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Không thể đổi trạng thái');
    } finally {
      setBusy(false);
    }
  }

  async function handleDeleteKey() {
    if (!window.electronAPI?.customProvider) return;
    setBusy(true);
    setError(null);
    setInfo(null);
    try {
      await window.electronAPI.customProvider.deleteKey();
      setInfo('Đã xoá API key.');
      await loadConfig();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Xoá key thất bại');
    } finally {
      setBusy(false);
    }
  }

  async function handleTest() {
    if (!window.electronAPI?.customProvider) return;
    setBusy(true);
    setError(null);
    setInfo(null);
    try {
      const result = await window.electronAPI.customProvider.testConnection({
        apiKey: apiKey || undefined,
      });
      if (result.ok) {
        setInfo(`OK — model: ${result.model || selectedModel}`);
      } else {
        setError(result.message || 'Test connection thất bại');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Test connection thất bại');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card glass-card">
      <div className="card__header">
        <h3 className="card__title">Custom Provider</h3>
      </div>

      <div className="settings-group">
        <div className="settings-item">
          <div>
            <div className="settings-item__label">Dùng custom provider</div>
            <div className="settings-item__description">
              Bật để định tuyến chat tới endpoint LLM riêng của bạn thay cho managed runner.
            </div>
          </div>
          <label className="izzi-setup__toggle-row">
            <input
              type="checkbox"
              checked={enabled}
              disabled={busy}
              onChange={(event) => void handleToggle(event.target.checked)}
            />
          </label>
        </div>

        <div className="settings-item">
          <div className="settings-item__label">Base URL</div>
          <input
            className="input"
            type="url"
            placeholder="https://cpab.example.dev/v1"
            value={baseUrl}
            onChange={(event) => setBaseUrl(event.target.value)}
          />
        </div>

        <div className="settings-item">
          <div className="settings-item__label">Kiểu auth</div>
          <select
            className="input"
            value={authType}
            onChange={(event) => setAuthType(event.target.value as 'bearer' | 'x-api-key')}
          >
            <option value="bearer">Bearer</option>
            <option value="x-api-key">x-api-key</option>
          </select>
        </div>

        <div className="settings-item">
          <div className="settings-item__label">Model</div>
          <select
            className="input"
            value={selectedModel}
            onChange={(event) => setSelectedModel(event.target.value)}
          >
            {ALLOWED_MODELS_UI.map((model) => (
              <option key={model} value={model}>
                {model}
              </option>
            ))}
          </select>
        </div>

        <div className="settings-item">
          <div className="settings-item__label">API key</div>
          <input
            className="input"
            type="password"
            placeholder={hasKey ? (maskedKeyHint || '••••') : '<YOUR_API_KEY>'}
            value={apiKey}
            onChange={(event) => setApiKey(event.target.value)}
            autoComplete="off"
          />
        </div>

        {hasKey && (
          <div className="settings-item">
            <div className="settings-item__description">
              Đã lưu key {maskedKeyHint || '••••'}. Để trống ô trên nếu giữ key cũ.
            </div>
            <button className="btn btn--ghost btn--sm" disabled={busy} onClick={() => void handleDeleteKey()}>
              Xoá key
            </button>
          </div>
        )}
      </div>

      <div className="action-row">
        <button className="btn btn--primary" disabled={busy} onClick={() => void handleSave()}>
          Lưu
        </button>
        <button className="btn btn--secondary" disabled={busy} onClick={() => void handleTest()}>
          Test connection
        </button>
      </div>

      {info && <div className="settings-item__description">{info}</div>}
      {error && <div className="settings-item__description settings-error__summary">{summarizeError(error)}</div>}
    </div>
  );
}

function summarizeError(error: string): string {
  const firstLine = error.split('\n')[0];
  if (firstLine.length > 120) {
    return `${firstLine.slice(0, 120)}…`;
  }
  if (firstLine.length < error.length) {
    return `${firstLine} …`;
  }
  return firstLine;
}

function SettingRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="settings-item">
      <div className="settings-item__label">{label}</div>
      <div style={{ fontSize: '14px', color: 'var(--color-text-secondary)' }}>{value}</div>
    </div>
  );
}
