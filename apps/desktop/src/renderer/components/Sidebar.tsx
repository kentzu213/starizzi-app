import React from 'react';
import {
  ChatIcon,
  ExtensionIcon,
  MarketplaceIcon,
  MemoryIcon,
  OverviewIcon,
  SetupIcon,
  SettingsIcon,
  StatusIcon,
  TasksIcon,
} from './AppIcons';

interface SidebarProps {
  currentPage: string;
  onNavigate: (page: any) => void;
  user: any;
  updateCount?: number;
  appUpdateAvailable?: boolean;
  appUpdateDownloaded?: boolean;
  onUpdateClick?: () => void;
}

const WORKSPACE_ITEMS = [
  { id: 'setup', icon: SetupIcon, label: 'Setup Wizard', badge: 'New' },
  { id: 'chat', icon: ChatIcon, label: 'Agent Gateway', badge: 'v2' },
  { id: 'tasks', icon: TasksIcon, label: 'Tasks' },
  { id: 'memory', icon: MemoryIcon, label: 'Memory' },
  { id: 'status', icon: StatusIcon, label: 'Status' },
  { id: 'dashboard', icon: OverviewIcon, label: 'Overview' },
  { id: 'costs', icon: () => <span style={{ fontSize: 16 }}>💰</span>, label: 'Chi phí' },
];

const EXPLORE_ITEMS = [
  { id: 'agents', icon: () => <span style={{ fontSize: 16 }}>🤖</span>, label: 'Agent Hub', badge: 'v2' },
  { id: 'marketplace', icon: MarketplaceIcon, label: 'Marketplace' },
  { id: 'extensions', icon: ExtensionIcon, label: 'Extensions' },
];

const SYSTEM_ITEMS = [{ id: 'settings', icon: SettingsIcon, label: 'Settings' }];

export function Sidebar({ currentPage, onNavigate, user, updateCount = 0, appUpdateAvailable, appUpdateDownloaded, onUpdateClick }: SidebarProps) {
  const getInitials = (name: string) => {
    if (!name) return '?';
    return name
      .split(' ')
      .map((word) => word[0])
      .join('')
      .toUpperCase()
      .slice(0, 2);
  };

  const renderItem = (item: { id: string; icon: React.ComponentType<{ className?: string }>; label: string; badge?: string }) => {
    const Icon = item.icon;
    const badge = item.id === 'extensions' && updateCount > 0 ? `${updateCount} up` : item.badge;

    return (
      <div
        key={item.id}
        className={`sidebar__item ${currentPage === item.id ? 'sidebar__item--active' : ''}`}
        onClick={() => onNavigate(item.id)}
      >
        <span className="sidebar__item-icon">
          <Icon className="sidebar__icon-svg" />
        </span>
        <span>{item.label}</span>
        {badge && (
          <span
            className={`sidebar__item-badge ${
              item.id === 'extensions' && updateCount > 0 ? 'sidebar__item-badge--update' : ''
            }`}
          >
            {badge}
          </span>
        )}
      </div>
    );
  };

  return (
    <aside className="sidebar glass-panel" role="complementary" aria-label="Thanh dieu huong">
      <nav className="sidebar__nav" aria-label="Menu chinh">
        <div className="sidebar__section-title">Workspace</div>
        {WORKSPACE_ITEMS.map(renderItem)}

        <div className="sidebar__section-title">Explore</div>
        {EXPLORE_ITEMS.map(renderItem)}

        <div className="sidebar__section-title">System</div>
        {SYSTEM_ITEMS.map(renderItem)}
      </nav>

      <div className="sidebar__user">
        {(appUpdateAvailable || appUpdateDownloaded) && (
          <div
            className={`sidebar__update-prompt ${appUpdateDownloaded ? 'sidebar__update-prompt--ready' : ''}`}
            onClick={onUpdateClick}
          >
            <span className="sidebar__update-prompt-dot" />
            <span className="sidebar__update-prompt-text">
              {appUpdateDownloaded ? '🚀 Sẵn sàng cài đặt' : '🔄 Có bản cập nhật mới'}
            </span>
            <span className="sidebar__update-prompt-action">
              {appUpdateDownloaded ? 'Cài đặt' : 'Tải xuống'}
            </span>
          </div>
        )}
        <div className="sidebar__user-card" onClick={() => onNavigate('settings')}>
          <div className="sidebar__avatar">
            {user?.avatar && typeof user.avatar === 'string' && user.avatar.length <= 2
              ? user.avatar
              : getInitials(user?.name || 'User')}
          </div>
          <div className="sidebar__user-info">
            <div className="sidebar__user-name">{user?.name || 'User'}</div>
            <div className="sidebar__user-plan">{user?.plan || 'Free'} plan</div>
          </div>
        </div>
      </div>
    </aside>
  );
}
