import React, { useEffect, useMemo } from 'react';
import { AgentStatusBadge } from '../components/AgentStatusBadge';
import { useAgentWorkspaceStore } from '../store/agentWorkspace';

export function StatusPage() {
  const session = useAgentWorkspaceStore((state) => state.session);
  const runtimeState = useAgentWorkspaceStore((state) => state.runtimeState);
  const diagnostics = useAgentWorkspaceStore((state) => state.diagnostics);
  const tasks = useAgentWorkspaceStore((state) => state.tasks);
  const memories = useAgentWorkspaceStore((state) => state.memories);
  const updaterState = useAgentWorkspaceStore((state) => state.updaterState);
  const refreshDiagnostics = useAgentWorkspaceStore((state) => state.refreshDiagnostics);
  const refreshStatus = useAgentWorkspaceStore((state) => state.refreshStatus);
  const checkForUpdates = useAgentWorkspaceStore((state) => state.checkForUpdates);
  const downloadUpdate = useAgentWorkspaceStore((state) => state.downloadUpdate);
  const restartToUpdate = useAgentWorkspaceStore((state) => state.restartToUpdate);

  useEffect(() => {
    void Promise.all([refreshDiagnostics(30), refreshStatus(session?.id)]);
  }, [refreshDiagnostics, refreshStatus, session?.id]);

  const lastSuccess = useMemo(
    () => diagnostics.find((event) => event.type === 'agent.chat' && event.status === 'success'),
    [diagnostics],
  );

  return (
    <div>
      <div className="page-header">
        <h1 className="page-header__title">Status</h1>
        <p className="page-header__subtitle">
          Theo dõi runtime hiện tại, lần chạy thành công gần nhất, diagnostic timeline và tổng số artifact đã lưu.
        </p>
      </div>

      <div className="status-overview">
        <div className="status-overview__card glass-card">
          <div className="status-overview__label">Current runner state</div>
          <AgentStatusBadge state={runtimeState.state} detail={runtimeState.lastError} />
        </div>
        <div className="status-overview__card glass-card">
          <div className="status-overview__label">Current session</div>
          <div className="status-overview__value">{session?.title || 'Chưa có session'}</div>
        </div>
        <div className="status-overview__card glass-card">
          <div className="status-overview__label">Stored tasks</div>
          <div className="status-overview__value">{tasks.length}</div>
        </div>
        <div className="status-overview__card glass-card">
          <div className="status-overview__label">Stored memories</div>
          <div className="status-overview__value">{memories.length}</div>
        </div>
      </div>

      <div className="card glass-card section-gap">
        <div className="card__header">
          <h3 className="card__title">Recent run</h3>
        </div>
        <div className="status-detail-list">
          <div className="status-detail-list__item">
            <span>Last update</span>
            <strong>{new Date(runtimeState.updatedAt).toLocaleString('vi-VN')}</strong>
          </div>
          <div className="status-detail-list__item">
            <span>Last error</span>
            <strong>{runtimeState.lastError || 'Không có'}</strong>
          </div>
          <div className="status-detail-list__item">
            <span>Last success</span>
            <strong>{lastSuccess ? new Date(lastSuccess.timestamp).toLocaleString('vi-VN') : 'Chưa có'}</strong>
          </div>
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
        <div className="status-detail-list">
          <div className="status-detail-list__item">
            <span>Updater state</span>
            <strong>{updaterState.state}</strong>
          </div>
          <div className="status-detail-list__item">
            <span>Current version</span>
            <strong>{updaterState.version || 'N/A'}</strong>
          </div>
          <div className="status-detail-list__item">
            <span>Available version</span>
            <strong>{updaterState.availableVersion || 'Không có'}</strong>
          </div>
          <div className="status-detail-list__item">
            <span>Progress</span>
            <strong>{typeof updaterState.progress === 'number' ? `${updaterState.progress}%` : 'N/A'}</strong>
          </div>
        </div>
        {updaterState.error && <div className="status-inline-error">{updaterState.error}</div>}
      </div>

      <div className="card glass-card">
        <div className="card__header">
          <h3 className="card__title">Diagnostics</h3>
          <button className="btn btn--ghost btn--sm" onClick={() => void refreshDiagnostics(30)}>
            Làm mới
          </button>
        </div>

        <div className="status-log">
          {diagnostics.length === 0 ? (
            <div className="status-log__empty">Chưa có diagnostic event nào.</div>
          ) : (
            diagnostics.map((event) => (
              <div key={event.id} className="status-log__item">
                <div className="status-log__item-head">
                  <strong>{event.type}</strong>
                  <span className={`sync-badge sync-badge--${event.status === 'info' ? 'idle' : event.status}`}>
                    {event.status}
                  </span>
                </div>
                <div className="status-log__item-detail">{event.detail}</div>
                <div className="status-log__item-time">{new Date(event.timestamp).toLocaleString('vi-VN')}</div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
