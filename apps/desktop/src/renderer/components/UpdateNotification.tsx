import React, { useEffect, useState } from 'react';
import type { DesktopUpdaterState } from '../../main/updater/types';

const DISMISSED_KEY = 'openclaw_dismissed_update_version';

function getDismissedVersion(): string | null {
  try {
    return localStorage.getItem(DISMISSED_KEY);
  } catch {
    return null;
  }
}

function setDismissedVersion(version: string): void {
  try {
    localStorage.setItem(DISMISSED_KEY, version);
  } catch {
    // ignore
  }
}

interface UpdateNotificationProps {
  updaterState: DesktopUpdaterState;
  onDownload: () => void;
  onRestart: () => void;
}

export function UpdateNotification({ updaterState, onDownload, onRestart }: UpdateNotificationProps) {
  const [visible, setVisible] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  const availableVersion = updaterState.availableVersion || '';
  const isAvailable = updaterState.state === 'available';
  const isDownloaded = updaterState.state === 'downloaded';

  useEffect(() => {
    if (!isAvailable && !isDownloaded) {
      setVisible(false);
      return;
    }

    if (dismissed) return;

    const dismissedVer = getDismissedVersion();
    if (dismissedVer === availableVersion && !isDownloaded) {
      return;
    }

    // Small delay for smoother UX
    const timer = setTimeout(() => setVisible(true), 1200);
    return () => clearTimeout(timer);
  }, [isAvailable, isDownloaded, availableVersion, dismissed]);

  function handleDismiss() {
    setDismissed(true);
    setVisible(false);
  }

  function handleSkipVersion() {
    if (availableVersion) {
      setDismissedVersion(availableVersion);
    }
    setDismissed(true);
    setVisible(false);
  }

  function handleAction() {
    if (isDownloaded) {
      onRestart();
    } else {
      onDownload();
      setVisible(false);
    }
  }

  if (!visible) return null;

  return (
    <div className="update-notification-overlay" onClick={handleDismiss}>
      <div className="update-notification glass-card" onClick={(e) => e.stopPropagation()}>
        <div className="update-notification__glow" />

        <div className="update-notification__header">
          <div className="update-notification__icon">
            {isDownloaded ? '🚀' : '✨'}
          </div>
          <h3 className="update-notification__title">
            {isDownloaded ? 'Bản cập nhật đã sẵn sàng!' : 'Có bản cập nhật mới!'}
          </h3>
        </div>

        <div className="update-notification__body">
          <div className="update-notification__versions">
            <div className="update-notification__version-item">
              <span className="update-notification__version-label">Phiên bản hiện tại</span>
              <span className="update-notification__version-value update-notification__version-value--current">
                v{updaterState.version}
              </span>
            </div>
            <div className="update-notification__version-arrow">→</div>
            <div className="update-notification__version-item">
              <span className="update-notification__version-label">Phiên bản mới</span>
              <span className="update-notification__version-value update-notification__version-value--new">
                v{availableVersion}
              </span>
            </div>
          </div>

          <p className="update-notification__desc">
            {isDownloaded
              ? 'Bản cập nhật đã tải xong. Khởi động lại để sử dụng phiên bản mới nhất.'
              : 'Cập nhật ngay để trải nghiệm các tính năng mới và cải tiến hiệu năng.'}
          </p>
        </div>

        <div className="update-notification__actions">
          <button
            type="button"
            className="btn btn--primary btn--lg update-notification__btn-primary"
            onClick={handleAction}
          >
            {isDownloaded ? '🔄 Khởi động lại ngay' : '⬇️ Tải xuống ngay'}
          </button>
          <div className="update-notification__secondary-actions">
            <button
              type="button"
              className="btn btn--ghost btn--sm"
              onClick={handleDismiss}
            >
              Nhắc sau
            </button>
            {!isDownloaded && (
              <button
                type="button"
                className="btn btn--ghost btn--sm"
                onClick={handleSkipVersion}
              >
                Bỏ qua version này
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
