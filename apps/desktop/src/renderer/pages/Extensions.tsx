import React, { useState, useEffect, useCallback } from 'react';
import { PermissionDialog } from '../components/PermissionDialog';

interface RuntimeExtension {
  id: string;
  name: string;
  displayName: string;
  version: string;
  description?: string;
  author?: string;
  state: 'installed' | 'running' | 'stopped' | 'crashed' | 'disabled';
  permissions: string[];
  grantedPermissions: string[];
  categories?: string[];
}

interface InstalledExtension {
  id: string;
  name: string;
  displayName: string;
  version: string;
  description?: string;
  author?: string;
  isEnabled: boolean;
  installedAt: string;
}

const STATE_BADGES: Record<string, { label: string; className: string; icon: string }> = {
  running:   { label: 'Đang chạy',    className: 'sync-badge--success', icon: '🟢' },
  installed: { label: 'Đã cài',       className: 'sync-badge--idle',    icon: '⚪' },
  stopped:   { label: 'Đã dừng',      className: 'sync-badge--idle',    icon: '⏹️' },
  crashed:   { label: 'Lỗi',          className: 'sync-badge--error',   icon: '🔴' },
  disabled:  { label: 'Vô hiệu hóa', className: 'sync-badge--warning', icon: '⏸️' },
};

export function ExtensionsPage({
  onGoMarketplace,
  onOpenClawQuickInstall,
}: {
  onGoMarketplace?: () => void;
  onOpenClawQuickInstall?: () => void;
}) {
  const [runtimeExts, setRuntimeExts] = useState<RuntimeExtension[]>([]);
  const [legacyExts, setLegacyExts] = useState<InstalledExtension[]>([]);
  const [loading, setLoading] = useState(true);
  const [actioningId, setActioningId] = useState<string | null>(null);
  const [permDialogExt, setPermDialogExt] = useState<RuntimeExtension | null>(null);
  const [permDefinitions, setPermDefinitions] = useState<any[]>([]);
  const [notification, setNotification] = useState<{ message: string; type: string } | null>(null);

  const showNotif = useCallback((message: string, type: string = 'info') => {
    setNotification({ message, type });
    setTimeout(() => setNotification(null), 3000);
  }, []);

  // Load extensions
  const loadExtensions = useCallback(async () => {
    try {
      if (window.electronAPI) {
        // Try runtime list first (Sprint 2B)
        const runtime = await window.electronAPI.extensionRuntime?.list?.();
        if (runtime && runtime.length > 0) {
          setRuntimeExts(runtime);
        }
        // Also load legacy list
        const legacy = await window.electronAPI.extensions.list();
        setLegacyExts(legacy);
      }
    } catch (err) {
      console.error('Failed to load extensions:', err);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    loadExtensions();
  }, [loadExtensions]);

  // Listen for extension UI requests (notifications from running extensions)
  useEffect(() => {
    if (window.electronAPI?.extensionRuntime?.onUIRequest) {
      window.electronAPI.extensionRuntime.onUIRequest((data: any) => {
        if (data.action === 'showNotification') {
          showNotif(`[${data.extensionId}] ${data.args[0]}`, data.args[1] || 'info');
        }
      });
    }
  }, [showNotif]);

  async function handleStart(extId: string) {
    setActioningId(extId);
    try {
      const result = await window.electronAPI?.extensionRuntime?.start(extId);
      if (result?.success) {
        showNotif('Tiện ích đã khởi chạy', 'success');
      } else {
        showNotif(result?.error || 'Khởi chạy thất bại', 'error');
      }
    } catch (err: any) {
      showNotif(err.message, 'error');
    }
    setActioningId(null);
    loadExtensions();
  }

  async function handleStop(extId: string) {
    setActioningId(extId);
    try {
      await window.electronAPI?.extensionRuntime?.stop(extId);
      showNotif('Tiện ích đã dừng', 'info');
    } catch (err: any) {
      showNotif(err.message, 'error');
    }
    setActioningId(null);
    loadExtensions();
  }

  async function handleToggleEnable(ext: RuntimeExtension) {
    setActioningId(ext.id);
    try {
      if (ext.state === 'disabled') {
        await window.electronAPI?.extensionRuntime?.enable(ext.id);
        showNotif('Đã bật tiện ích', 'success');
      } else {
        await window.electronAPI?.extensionRuntime?.disable(ext.id);
        showNotif('Đã vô hiệu hóa tiện ích', 'info');
      }
    } catch (err: any) {
      showNotif(err.message, 'error');
    }
    setActioningId(null);
    loadExtensions();
  }

  async function handleUninstall(extId: string) {
    setActioningId(extId);
    try {
      if (window.electronAPI) {
        const result = await window.electronAPI.extensions.uninstall(extId);
        if (result.success) {
          showNotif('Đã gỡ cài đặt', 'success');
        }
      }
    } catch (err: any) {
      showNotif(err.message, 'error');
    }
    setActioningId(null);
    loadExtensions();
  }

  async function handleShowPermissions(ext: RuntimeExtension) {
    try {
      const result = await window.electronAPI?.extensionRuntime?.permissions(ext.id);
      if (result?.success) {
        setPermDefinitions(result.definitions);
        setPermDialogExt(ext);
      }
    } catch (err) {
      console.error('Failed to load permissions:', err);
    }
  }

  async function handleGrantPermissions(permissions: string[]) {
    if (!permDialogExt) return;
    try {
      await window.electronAPI?.extensionRuntime?.grantPermissions(permDialogExt.id, permissions);
      showNotif('Quyền đã được cập nhật', 'success');
    } catch (err: any) {
      showNotif(err.message, 'error');
    }
    setPermDialogExt(null);
    loadExtensions();
  }

  async function handleInstallOcx() {
    try {
      const result = await window.electronAPI?.extensionRuntime?.installOcx();
      if (result?.success) {
        showNotif(`Đã cài đặt: ${result.extension.displayName}`, 'success');
        loadExtensions();
      } else if (result?.error && result.error !== 'Cancelled') {
        showNotif(result.error, 'error');
      }
    } catch (err: any) {
      showNotif(err.message, 'error');
    }
  }

  const allExts = runtimeExts.length > 0 ? runtimeExts : legacyExts.map(e => ({
    id: e.id,
    name: e.name,
    displayName: e.displayName,
    version: e.version,
    description: e.description,
    author: e.author,
    state: (e.isEnabled ? 'installed' : 'disabled') as RuntimeExtension['state'],
    permissions: [],
    grantedPermissions: [],
  }));

  const runningCount = allExts.filter(e => e.state === 'running').length;
  const totalCount = allExts.length;

  return (
    <div>
      {/* Notification Toast */}
      {notification && (
        <div className={`notification-toast notification-toast--${notification.type}`}>
          {notification.type === 'success' ? '✅' : notification.type === 'error' ? '❌' : 'ℹ️'}{' '}
          {notification.message}
        </div>
      )}

      {/* Header */}
      <div className="page-header">
        <div className="page-header__split-row">
          <div>
            <h1 className="page-header__title">🧩 Tiện ích mở rộng</h1>
            <p className="page-header__subtitle">
              Quản lý các tiện ích đã cài đặt trên Izzi OpenClaw
              {totalCount > 0 && (
                <span className="extensions-running-count">
                  {runningCount}/{totalCount} đang chạy
                </span>
              )}
            </p>
          </div>
          <div className="extensions-header__actions">
            <button className="btn btn--secondary btn--sm" onClick={handleInstallOcx} title="Cài từ file .ocx">
              📦 Cài .ocx
            </button>
            <button className="btn btn--primary btn--sm" onClick={onGoMarketplace}>
              🏪 Marketplace
            </button>
          </div>
        </div>
      </div>

      {/* Available Updates Panel */}
      {!loading && allExts.length > 0 && (
        <div className="ext-updates-panel animate-in">
          <div className="ext-updates-panel__header">
            <div className="ext-updates-panel__header-left">
              <span className="ext-updates-panel__icon">🔄</span>
              <span className="ext-updates-panel__title">Bản cập nhật có sẵn</span>
              <span className="ext-updates-panel__count">2</span>
            </div>
            <button className="btn btn--primary btn--sm">📥 Cập nhật tất cả</button>
          </div>
          <div className="ext-updates-panel__list">
            <div className="ext-updates-panel__item">
              <span>🧩</span>
              <span className="ext-updates-panel__item-name">Smart SEO Scanner</span>
              <span className="ext-updates-panel__item-version">v1.1.0 → v1.2.0</span>
              <button className="btn btn--ghost btn--sm">Cập nhật</button>
            </div>
            <div className="ext-updates-panel__item">
              <span>🧩</span>
              <span className="ext-updates-panel__item-name">Chatbot Builder Pro</span>
              <span className="ext-updates-panel__item-version">v0.8.5 → v0.9.0</span>
              <button className="btn btn--ghost btn--sm">Cập nhật</button>
            </div>
          </div>
        </div>
      )}

      {/* Content */}
      {loading ? (
        <div className="card glass-card ext-loading-card">
          <div className="spinner ext-loading-card__spinner" />
          <p className="ext-loading-card__text">Đang tải tiện ích...</p>
        </div>
      ) : allExts.length === 0 ? (
        <div className="card glass-card">
          <div className="empty-state">
            <div className="empty-state__icon">🧩</div>
            <h3 className="empty-state__title">Chưa có tiện ích nào</h3>
            <p className="empty-state__description">
              Truy cập Marketplace để khám phá và cài đặt các tiện ích mở rộng giúp tăng hiệu quả công việc.
            </p>
            <div className="ext-empty-actions">
              <button className="btn btn--primary" onClick={onGoMarketplace}>🏪 Đi đến Marketplace</button>
              <button className="btn btn--secondary" onClick={handleInstallOcx}>📦 Cài từ file .ocx</button>
              <button className="btn btn--ghost" onClick={onOpenClawQuickInstall}>⚙️ Mở / cài OpenClaw CLI</button>
            </div>
          </div>
        </div>
      ) : (
        <div className="ext-list">
          {allExts.map((ext, i) => {
            const badge = STATE_BADGES[ext.state] || STATE_BADGES.installed;
            const isActioning = actioningId === ext.id;
            const isRuntime = runtimeExts.length > 0;
            const permCount = ext.permissions?.length || 0;
            const grantedCount = ext.grantedPermissions?.length || 0;

            return (
              <div key={ext.id} className="card glass-card animate-in" style={{ animationDelay: `${i * 60}ms` }}>
                <div className="ext-list-card__body">
                  {/* Icon */}
                  <div className="ext-card__icon ext-list-card__icon">
                    🧩
                  </div>

                  {/* Info */}
                  <div className="ext-list-card__info">
                    <div className="ext-list-card__title-row">
                      <span className="ext-list-card__name">
                        {ext.displayName || ext.name}
                      </span>
                      <span className="ext-list-card__version">
                        v{ext.version}
                      </span>
                      <span className={`sync-badge ${badge.className}`}>
                        {badge.icon} {badge.label}
                      </span>
                    </div>

                    {ext.description && (
                      <p className="ext-list-card__desc">
                        {ext.description}
                      </p>
                    )}

                    <div className="ext-list-card__meta">
                      {ext.author && <span>👤 {ext.author}</span>}
                      {permCount > 0 && (
                        <span
                          className="ext-list-card__perm"
                          onClick={() => isRuntime && handleShowPermissions(ext as RuntimeExtension)}
                          title="Xem quyền truy cập"
                        >
                          🔐 {grantedCount}/{permCount} quyền
                        </span>
                      )}
                      {ext.state === 'crashed' && (
                        <span className="ext-list-card__crash">⚠️ Extension bị crash</span>
                      )}
                    </div>
                  </div>

                  {/* Actions */}
                  <div className="ext-list-card__actions">
                    {isRuntime && (
                      <>
                        {ext.state === 'running' ? (
                          <button
                            className="btn btn--ghost btn--sm"
                            onClick={() => handleStop(ext.id)}
                            disabled={isActioning}
                          >
                            {isActioning ? '⏳' : '⏹️'} Dừng
                          </button>
                        ) : ext.state !== 'disabled' ? (
                          <button
                            className="btn btn--primary btn--sm"
                            onClick={() => handleStart(ext.id)}
                            disabled={isActioning}
                          >
                            {isActioning ? '⏳' : '▶️'} Chạy
                          </button>
                        ) : null}

                        <button
                          className={`btn btn--sm ${ext.state === 'disabled' ? 'btn--secondary' : 'btn--ghost'}`}
                          onClick={() => handleToggleEnable(ext as RuntimeExtension)}
                          disabled={isActioning}
                          title={ext.state === 'disabled' ? 'Bật lại' : 'Vô hiệu hóa'}
                        >
                          {ext.state === 'disabled' ? '🔓 Bật' : '⏸️'}
                        </button>

                        {permCount > 0 && (
                          <button
                            className="btn btn--ghost btn--sm"
                            onClick={() => handleShowPermissions(ext as RuntimeExtension)}
                            title="Quản lý quyền"
                          >
                            🔐
                          </button>
                        )}
                      </>
                    )}

                    <button
                      className="btn btn--danger btn--sm"
                      onClick={() => handleUninstall(ext.id)}
                      disabled={isActioning}
                    >
                      {isActioning ? '⏳' : '🗑️'}
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Permission Dialog */}
      {permDialogExt && (
        <PermissionDialog
          extensionName={permDialogExt.displayName}
          requestedPermissions={permDialogExt.permissions}
          grantedPermissions={permDialogExt.grantedPermissions}
          definitions={permDefinitions}
          onGrant={handleGrantPermissions}
          onCancel={() => setPermDialogExt(null)}
        />
      )}
    </div>
  );
}
