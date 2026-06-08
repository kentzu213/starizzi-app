import React, { useEffect } from 'react';
import { AgentStatusBadge } from '../components/AgentStatusBadge';
import { useAgentWorkspaceStore } from '../store/agentWorkspace';

interface SettingsPageProps {
  user: any;
  onLogout: () => void;
  onRefresh?: () => void;
  onOpenClawQuickInstall?: () => void;
  onBuyApi?: () => void;
}

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

  useEffect(() => {
    void Promise.all([refreshDiagnostics(10), refreshIntegrations()]);
  }, [refreshDiagnostics, refreshIntegrations]);

  return (
    <div>
      <div className="page-header">
        <h1 className="page-header__title">Settings</h1>
        <p className="page-header__subtitle">Quản lý tài khoản, managed runner, onboarding và diagnostic của desktop app.</p>
      </div>

      {onboardingState?.hasPendingSetup && (
        <div className="card section-gap card--accent glass-card">
          <div className="card__header">
            <h3 className="card__title">Finish setup</h3>
            <button className="btn btn--primary btn--sm" onClick={openOnboarding}>
              Mở onboarding
            </button>
          </div>
          <p className="card__body-copy">
            Wizard vẫn chưa được hoàn tất. Bạn có thể mở lại bất kỳ lúc nào để kết nối Telegram, Discord và Zalo.
          </p>
        </div>
      )}

      <div className="card glass-card section-gap">
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

      <div className="card glass-card section-gap">
        <div className="card__header">
          <h3 className="card__title">Desktop updates</h3>
          <div className="action-row">
            <button className="btn btn--ghost btn--sm" onClick={() => void checkForUpdates()}>
              Kiểm tra
            </button>
            {updaterState.state === 'available' && (
              <button className="btn btn--primary btn--sm" onClick={() => void downloadUpdate()}>
                Tải xuống
              </button>
            )}
            {updaterState.state === 'downloaded' && (
              <button className="btn btn--primary btn--sm" onClick={() => void restartToUpdate()}>
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
          {updaterState.error && <SettingRow label="Updater error" value={updaterState.error} />}
        </div>
      </div>

      <div className="card glass-card section-gap">
        <div className="card__header">
          <h3 className="card__title">Integrations</h3>
          <button className="btn btn--ghost btn--sm" onClick={() => void refreshIntegrations()}>
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

      <div className="card glass-card section-gap">
        <div className="card__header">
          <h3 className="card__title">Account</h3>
          <button
            className="btn btn--ghost btn--sm"
            onClick={() => window.electronAPI?.shell.openExternal('https://izziapi.com/dashboard/settings')}
          >
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

      <div className="card glass-card section-gap">
        <div className="card__header">
          <h3 className="card__title">Diagnostics</h3>
          <button className="btn btn--ghost btn--sm" onClick={() => void refreshDiagnostics(10)}>
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
    </div>
  );
}

function SettingRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="settings-item">
      <div className="settings-item__label">{label}</div>
      <div className="settings-item__value">{value}</div>
    </div>
  );
}
