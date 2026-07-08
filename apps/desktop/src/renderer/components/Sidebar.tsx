import React from 'react';
import {
  AffiliateIcon,
  AgentHubIcon,
  ChatIcon,
  CostIcon,
  ExtensionIcon,
  KnowledgeIcon,
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
  { id: 'setup', icon: SetupIcon, label: 'Capture setup', badge: '01' },
  { id: 'chat', icon: ChatIcon, label: 'Chat agent', badge: 'Live' },
  { id: 'knowledge', icon: KnowledgeIcon, label: 'MyGraph' },
  { id: 'tasks', icon: TasksIcon, label: 'Replay tasks' },
  { id: 'memory', icon: MemoryIcon, label: 'Recall library' },
  { id: 'status', icon: StatusIcon, label: 'Guardrails' },
  { id: 'dashboard', icon: OverviewIcon, label: 'Operations' },
  { id: 'costs', icon: CostIcon, label: 'Chi phí' },
];

const EXPLORE_ITEMS = [
  { id: 'agents', icon: AgentHubIcon, label: 'Agent hub', badge: 'v2' },
  { id: 'connections', icon: SetupIcon, label: 'Kết nối Model' },
  { id: 'marketplace', icon: MarketplaceIcon, label: 'Knowleadmarket', badge: 'Hot', prominent: true },
  { id: 'affiliate', icon: AffiliateIcon, label: 'Affiliate', badge: '20%', prominent: true },
  { id: 'extensions', icon: ExtensionIcon, label: 'Workflow imports' },
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

  const renderItem = (item: { id: string; icon: React.ComponentType<{ className?: string }>; label: string; badge?: string; prominent?: boolean }) => {
    const Icon = item.icon;
    const badge = item.id === 'extensions' && updateCount > 0 ? `${updateCount} up` : item.badge;
    const isUpdateBadge = item.id === 'extensions' && updateCount > 0;

    return (
      <button
        type="button"
        key={item.id}
        className={`sidebar__item ${currentPage === item.id ? 'sidebar__item--active' : ''} ${
          item.prominent ? 'sidebar__item--featured' : ''
        }`}
        onClick={() => onNavigate(item.id)}
      >
        <span className="sidebar__item-icon">
          <Icon className="sidebar__icon-svg" />
        </span>
        <span>{item.label}</span>
        {badge && (
          <span
            className={`sidebar__item-badge ${isUpdateBadge ? 'sidebar__item-badge--update' : ''} ${
              item.prominent ? 'sidebar__item-badge--featured' : ''
            }`}
          >
            {badge}
          </span>
        )}
      </button>
    );
  };

  return (
    <aside className="sidebar glass-panel" role="complementary" aria-label="Thanh dieu huong">
      <div className="sidebar__brand-panel" aria-label="IzziAI Memory Universe">
        <span className="sidebar__brand-kicker">IzziAI Memory Universe</span>
        <strong>Recall routes for repeat work.</strong>
        <span className="sidebar__brand-flow">Capture / Structure / Recall / Replay</span>
      </div>

      <nav className="sidebar__nav" aria-label="Menu chinh">
        <div className="sidebar__section-title">Memory core</div>
        {WORKSPACE_ITEMS.map(renderItem)}

        <div className="sidebar__section-title">Operational surface</div>
        {EXPLORE_ITEMS.map(renderItem)}

        <div className="sidebar__section-title">System</div>
        {SYSTEM_ITEMS.map(renderItem)}
      </nav>

      <div className="sidebar__user">
        {(appUpdateAvailable || appUpdateDownloaded) && (
          <button
            type="button"
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
          </button>
        )}
        <button type="button" className="sidebar__user-card" onClick={() => onNavigate('settings')}>
          <div className="sidebar__avatar">
            {user?.avatar && typeof user.avatar === 'string' && user.avatar.length <= 2
              ? user.avatar
              : getInitials(user?.name || 'User')}
          </div>
          <div className="sidebar__user-info">
            <div className="sidebar__user-name">{user?.name || 'User'}</div>
            <div className="sidebar__user-plan">{user?.plan || 'Free'} plan</div>
          </div>
        </button>
      </div>
    </aside>
  );
}
