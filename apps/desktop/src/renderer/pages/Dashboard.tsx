import React, { useEffect, useState } from 'react';

interface DashboardPageProps {
  user: any;
  onRefresh?: () => void;
  onOpenClawQuickInstall?: () => void;
  onBuyApi?: () => void;
  onGoChat?: () => void;
}

interface ActivityItem {
  title: string;
  time: string;
}

const RECENT_ACTIVITY: ActivityItem[] = [
  { title: 'Marketplace data đã được đồng bộ', time: '5 phút trước' },
  { title: 'Kiểm tra cập nhật extensions thành công', time: '1 giờ trước' },
  { title: 'Hồ sơ IzziAPI đã được refresh', time: 'Hôm nay' },
];

export function DashboardPage({
  user,
  onRefresh,
  onOpenClawQuickInstall,
  onBuyApi,
  onGoChat,
}: DashboardPageProps) {
  const [syncStatus, setSyncStatus] = useState<'idle' | 'syncing' | 'success' | 'error'>('idle');
  const [extensionCount, setExtensionCount] = useState(0);
  const [lastSynced, setLastSynced] = useState<string | null>(null);

  useEffect(() => {
    void loadData();
  }, []);

  async function loadData() {
    try {
      if (!window.electronAPI) {
        return;
      }

      const [extensions, status] = await Promise.all([
        window.electronAPI.extensions.list(),
        window.electronAPI.sync.status(),
      ]);

      setExtensionCount(Array.isArray(extensions) ? extensions.length : 0);
      setLastSynced(status?.lastSynced || null);
    } catch {
      setExtensionCount(0);
    }
  }

  async function handleSync() {
    setSyncStatus('syncing');

    try {
      if (window.electronAPI) {
        const result = await window.electronAPI.sync.start();
        setSyncStatus(result.status === 'error' ? 'error' : 'success');
        setLastSynced(result.lastSynced || null);
        onRefresh?.();
      } else {
        window.setTimeout(() => setSyncStatus('success'), 400);
      }
    } catch {
      setSyncStatus('error');
    }
  }

  const stats = [
    { label: 'Balance', value: user?.balance !== undefined ? `$${Number(user.balance).toFixed(2)}` : '$0.00' },
    { label: 'Plan', value: user?.plan || 'free' },
    { label: 'Active keys', value: String(user?.activeKeys || 0) },
    { label: 'Installed extensions', value: String(extensionCount) },
  ];

  return (
    <div>
      <div className="page-header">
        <div className="page-header__eyebrow">Secondary workspace</div>
        <h1 className="page-header__title">Overview</h1>
        <p className="page-header__subtitle">
          Overview giữ vai trò theo dõi nhanh cho tài khoản, sync và các shortcut. Luồng chính của app bắt đầu từ Chat.
        </p>
      </div>

      <div className="card glass-card section-gap">
        <div className="card__header">
          <h3 className="card__title">Agent workspace</h3>
        </div>
        <p className="card__body-copy">
          Nếu bạn muốn lập kế hoạch, giao task hay tiếp tục một cuộc hội thoại đang dở, hãy quay lại trang Chat.
        </p>
        <div className="action-row">
          <button className="btn btn--primary" onClick={onGoChat}>
            Mở Chat
          </button>
          <button className="btn btn--secondary" onClick={handleSync} disabled={syncStatus === 'syncing'}>
            {syncStatus === 'syncing' ? 'Đang đồng bộ...' : 'Đồng bộ ngay'}
          </button>
        </div>
        {lastSynced && (
          <div className="meta-caption">
            Lần đồng bộ cuối: {new Date(lastSynced).toLocaleString('vi-VN')}
          </div>
        )}
      </div>

      <div className="stats-grid">
        {stats.map((stat) => (
          <div key={stat.label} className="stat-card glass-card animate-in">
            <div className="stat-card__value">{stat.value}</div>
            <div className="stat-card__label">{stat.label}</div>
          </div>
        ))}
      </div>

      <div className="card glass-card section-gap">
        <div className="card__header">
          <h3 className="card__title">Core actions</h3>
        </div>
        <div className="quick-action-grid">
          <QuickAction
            title="Mở / cài OpenClaw"
            description="Mở nhanh local OpenClaw nếu đã có sẵn, hoặc mở docs cài đặt."
            onClick={onOpenClawQuickInstall}
          />
          <QuickAction
            title="Mua API trên IzziAPI"
            description="Đi tới pricing của IzziAPI để mua gói hoặc nạp thêm balance."
            onClick={onBuyApi}
          />
          <QuickAction
            title="Web dashboard"
            description="Mở dashboard OpenClaw Gateway trên trình duyệt (local)."
            onClick={() => window.electronAPI?.shell.openExternal('http://127.0.0.1:18789/')}
          />
          <QuickAction
            title="Docs"
            description="Mở tài liệu OpenClaw và IzziAPI khi cần tham khảo nhanh."
            onClick={() => window.electronAPI?.shell.openExternal('https://docs.openclaw.ai')}
          />
        </div>
      </div>

      <div className="card glass-card">
        <div className="card__header">
          <h3 className="card__title">Recent activity</h3>
          <button className="btn btn--ghost btn--sm" onClick={() => void loadData()}>
            Làm mới
          </button>
        </div>
        <div className="activity-feed">
          {RECENT_ACTIVITY.map((item) => (
            <div key={`${item.title}-${item.time}`} className="activity-feed__item animate-in">
              <div className="activity-feed__content">
                <span className="activity-feed__text">{item.title}</span>
                <span className="activity-feed__time">{item.time}</span>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function QuickAction({
  title,
  description,
  onClick,
}: {
  title: string;
  description: string;
  onClick?: () => void;
}) {
  return (
    <button
      type="button"
      className="quick-action-card"
      onClick={onClick}
    >
      <div className="quick-action-card__title">{title}</div>
      <div className="quick-action-card__description">{description}</div>
    </button>
  );
}
