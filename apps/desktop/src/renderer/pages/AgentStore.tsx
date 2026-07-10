import React, { useState, useEffect } from 'react';
import { AgentSetupPanel } from '../components/AgentSetupPanel';
import { AgentHubIcon } from '../components/AppIcons';
import { useAgentGatewayStore } from '../store/agentGateway';
import type { ExternalAgent } from '../types/agent-registry';
import '../styles/agent-store.css';
import '../styles/agent-hub.css';

// ── Types ──

interface AgentBundle {
  id: string;
  name: string;
  displayName: string;
  description: string;
  longDescription?: string;
  icon: string;
  category: string;
  author: { name: string; verified?: boolean };
  version: string;
  rating: number;
  installs: number;
  pricing: 'free' | 'paid' | 'freemium';
  price?: { monthly: number; yearly: number; currency: string };
  trialDays?: number;
  screenshots: string[];
  skills: string[];
  cronJobs: number;
  platforms: string[];
  tags: string[];
  featured?: boolean;
  installed?: boolean;
}

interface InstalledAgentInfo {
  name: string;
  displayName: string;
  icon: string;
  status: 'active' | 'paused' | 'configuring' | 'error' | 'stopped';
  version: string;
  connectedPlatforms: string[];
  activeCronJobs: number;
  stats?: { totalMessages: number; totalWorkflowRuns: number };
}

// ── Demo Data ──

const DEMO_AGENTS: AgentBundle[] = [
  {
    id: 'auto-facebook',
    name: 'auto-facebook',
    displayName: 'Auto Facebook Agent',
    description: 'Tự động đăng bài, trả lời comment, phân tích audience, lên lịch content cho Facebook Page.',
    icon: '📘',
    category: 'social-media',
    author: { name: 'Izzi Team', verified: true },
    version: '1.0.0',
    rating: 4.8,
    installs: 12500,
    pricing: 'paid',
    price: { monthly: 19.99, yearly: 199, currency: 'USD' },
    trialDays: 7,
    screenshots: [],
    skills: ['fb-auto-poster', 'fb-comment-responder', 'fb-audience-analyzer', 'fb-content-calendar', 'fb-report-generator', 'fb-competitor-tracker', 'fb-hashtag-generator', 'fb-ad-optimizer'],
    cronJobs: 3,
    platforms: ['facebook', 'messenger'],
    tags: ['facebook', 'social-media', 'marketing', 'automation'],
    featured: true,
  },
  {
    id: 'auto-saler',
    name: 'auto-saler',
    displayName: 'Auto Saler Agent',
    description: 'Chatbot bán hàng thông minh, follow-up khách hàng, phân loại lead, báo cáo doanh thu tự động.',
    icon: '💰',
    category: 'sales',
    author: { name: 'Izzi Team', verified: true },
    version: '1.0.0',
    rating: 4.9,
    installs: 25000,
    pricing: 'paid',
    price: { monthly: 29.99, yearly: 299, currency: 'USD' },
    trialDays: 7,
    screenshots: [],
    skills: ['sales-chatbot', 'sales-lead-qualifier', 'sales-follow-up', 'sales-proposal-writer', 'sales-crm-sync', 'sales-report-daily', 'sales-objection-handler', 'sales-upsell-recommender'],
    cronJobs: 4,
    platforms: ['facebook', 'telegram', 'zalo', 'messenger'],
    tags: ['sales', 'chatbot', 'crm', 'automation'],
    featured: true,
  },
  {
    id: 'auto-secretary',
    name: 'auto-secretary',
    displayName: 'Auto Secretary Agent',
    description: 'Thư ký AI nhắc lịch, quản lý task, tóm tắt cuộc họp, dự thảo email cho bạn.',
    icon: '📋',
    category: 'productivity',
    author: { name: 'Izzi Team', verified: true },
    version: '1.0.0',
    rating: 4.7,
    installs: 8900,
    pricing: 'freemium',
    price: { monthly: 9.99, yearly: 99, currency: 'USD' },
    screenshots: [],
    skills: ['secretary-calendar', 'secretary-reminder', 'secretary-meeting-summary', 'secretary-task-manager', 'secretary-email-draft', 'secretary-daily-brief', 'secretary-document-organizer', 'secretary-travel-planner'],
    cronJobs: 5,
    platforms: ['telegram', 'email'],
    tags: ['productivity', 'calendar', 'tasks', 'assistant'],
    featured: true,
  },
  {
    id: 'auto-content',
    name: 'auto-content',
    displayName: 'Auto Content Agent',
    description: 'Viết nội dung marketing đa nền tảng, SEO blog, email campaigns, kịch bản video.',
    icon: '✍️',
    category: 'content',
    author: { name: 'Izzi Team', verified: true },
    version: '1.0.0',
    rating: 4.6,
    installs: 6700,
    pricing: 'paid',
    price: { monthly: 14.99, yearly: 149, currency: 'USD' },
    trialDays: 7,
    screenshots: [],
    skills: ['content-blog-writer', 'content-social-creator', 'content-email-campaign', 'content-video-script', 'content-seo-optimizer', 'content-repurpose', 'content-a-b-tester', 'content-trend-hunter'],
    cronJobs: 2,
    platforms: ['webhook'],
    tags: ['content', 'seo', 'blog', 'marketing', 'writing'],
  },
];

const CATEGORIES = [
  { id: 'all', label: '🔥 Tất cả', icon: '🔥' },
  { id: 'social-media', label: '📱 Social Media', icon: '📱' },
  { id: 'sales', label: '💼 Bán hàng', icon: '💼' },
  { id: 'productivity', label: '📋 Năng suất', icon: '📋' },
  { id: 'content', label: '✍️ Content', icon: '✍️' },
  { id: 'marketing', label: '📣 Marketing', icon: '📣' },
];

/** Editorial monogram from a display name (e.g. "Auto Facebook Agent" -> "AF", "Dify" -> "DI"). */
function mono(name: string): string {
  const cleaned = (name || '').trim();
  if (!cleaned) return '??';
  const words = cleaned.split(/\s+/).filter(Boolean);
  if (words.length >= 2) return (words[0][0] + words[1][0]).toUpperCase();
  return cleaned.slice(0, 2).toUpperCase();
}

// ── Main Component ──

interface AgentStorePageProps {
  /** Navigate to the Chat agent page — used by "Chat Now" after opening a session. */
  onNavigateToChat?: () => void;
}

export function AgentStorePage({ onNavigateToChat }: AgentStorePageProps = {}) {
  const [agents, setAgents] = useState<AgentBundle[]>(DEMO_AGENTS);
  const [filteredAgents, setFilteredAgents] = useState<AgentBundle[]>(DEMO_AGENTS);
  const [installedAgents, setInstalledAgents] = useState<InstalledAgentInfo[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [activeCategory, setActiveCategory] = useState('all');
  const [selectedAgent, setSelectedAgent] = useState<AgentBundle | null>(null);
  const [showSetupWizard, setShowSetupWizard] = useState(false);
  const [activeTab, setActiveTab] = useState<'top-agents' | 'store' | 'installed'>('top-agents');

  // External agents (Top 5 from gateway store)
  const externalAgents = useAgentGatewayStore((state) => state.agents);
  const updateAgentStatus = useAgentGatewayStore((state) => state.updateAgentStatus);
  const refreshAgentStatuses = useAgentGatewayStore((state) => state.refreshAgentStatuses);
  const [setupAgent, setSetupAgent] = useState<ExternalAgent | null>(null);

  // Filter agents by category + search
  useEffect(() => {
    let result = agents;

    if (activeCategory !== 'all') {
      result = result.filter(a => a.category === activeCategory);
    }

    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      result = result.filter(a =>
        a.displayName.toLowerCase().includes(q) ||
        a.description.toLowerCase().includes(q) ||
        a.tags.some(t => t.includes(q))
      );
    }

    setFilteredAgents(result);
  }, [agents, activeCategory, searchQuery]);

  // Load installed agents
  useEffect(() => {
    loadInstalledAgents();
  }, []);

  // Sync real Docker running-state into the Top Agents badges. The gateway store
  // starts every launch with all agents 'not-installed', so without this a
  // running container shows "Not Installed" until re-setup. Runs on mount (initial
  // tab) and whenever the user returns to the Top Agents tab.
  useEffect(() => {
    if (activeTab === 'top-agents') {
      void refreshAgentStatuses();
    }
  }, [activeTab, refreshAgentStatuses]);

  async function loadInstalledAgents() {
    try {
      if (window.electronAPI?.agents) {
        const list = await window.electronAPI.agents.list();
        setInstalledAgents(list || []);
      }
    } catch {
      setInstalledAgents([]);
    }
  }

  function handleInstallClick(agent: AgentBundle) {
    setSelectedAgent(agent);
    setShowSetupWizard(true);
  }

  function formatInstalls(n: number): string {
    if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
    return n.toString();
  }

  function formatPrice(agent: AgentBundle): string {
    if (agent.pricing === 'free') return 'Miễn phí';
    if (agent.pricing === 'freemium') return 'Freemium';
    if (agent.price) return `$${agent.price.monthly}/tháng`;
    return '';
  }

  // ── Render ──

  return (
    <div className="agent-store">
      {/* Header */}
      <header className="agent-store__header">
        <div className="agent-store__header-content">
          <h1 className="agent-store__title">
            <span className="agent-store__title-icon"><AgentHubIcon className="agent-store__title-icon-svg" /></span>
            Agent Hub
          </h1>
          <p className="agent-store__subtitle">
            Setup nhanh AI Agents hàng đầu — 1 click cài đặt, sẵn sàng chat
          </p>
        </div>

        {/* Tab Switcher */}
        <div className="agent-store__tabs">
          <button
            className={`agent-store__tab ${activeTab === 'top-agents' ? 'agent-store__tab--active' : ''}`}
            onClick={() => setActiveTab('top-agents')}
          >
            🌟 Top Agents
          </button>
          <button
            className={`agent-store__tab ${activeTab === 'store' ? 'agent-store__tab--active' : ''}`}
            onClick={() => setActiveTab('store')}
          >
            🏪 Izzi Agents
          </button>
          <button
            className={`agent-store__tab ${activeTab === 'installed' ? 'agent-store__tab--active' : ''}`}
            onClick={() => setActiveTab('installed')}
          >
            📦 Đã cài ({installedAgents.length})
          </button>
        </div>
      </header>

      {/* Top Agents Tab */}
      {activeTab === 'top-agents' && (
        <div className="agent-hub__top-section">
          <h2 className="agent-hub__top-title">
            🌟 Top AI Agents trên GitHub
          </h2>
          <p className="agent-hub__top-subtitle">
            Open-source AI Agents phổ biến nhất — chạy cục bộ trên máy bạn, kết nối với IzziAPI hoặc bất kỳ provider nào
          </p>
          <div className="agent-hub__top-grid">
            {externalAgents.map((agent) => (
              <div key={agent.id} className="agent-hub__top-card glass-card">
                <span className={`agent-hub__top-card-status agent-hub__top-card-status--${agent.runtime === 'izzi' ? 'running' : agent.status}`}>
                  {agent.runtime === 'izzi' ? '⚡ Sẵn sàng' :
                   agent.status === 'running' ? '🟢 Running' :
                   agent.status === 'stopped' ? '🟡 Stopped (đã cài)' :
                   agent.status === 'installing' ? '⏳ Installing' :
                   agent.status === 'error' ? '🔴 Error' :
                   '⚪ Not Installed'}
                </span>
                <div className="agent-hub__top-card-header">
                  <span className="agent-hub__top-card-icon">{mono(agent.displayName)}</span>
                  <div className="agent-hub__top-card-info">
                    <h3 className="agent-hub__top-card-name">{agent.displayName}</h3>
                    <div className="agent-hub__top-card-stars">
                      {agent.runtime === 'izzi'
                        ? '⚡ by Izzi · chạy qua Izzi API'
                        : `⭐ ${agent.githubStars} GitHub stars`}
                    </div>
                  </div>
                  <span className="agent-hub__top-card-category">{agent.category}</span>
                </div>
                <p className="agent-hub__top-card-desc">{agent.description}</p>
                <div className="agent-hub__top-card-tags">
                  {agent.tags.slice(0, 4).map((tag) => (
                    <span key={tag} className="agent-hub__top-card-tag">{tag}</span>
                  ))}
                </div>
                <div className="agent-hub__top-card-actions">
                  {agent.runtime === 'izzi' ? (
                    // izzi personas run via the Izzi API — always ready, no install
                    // to do (and nothing to persist). Open a chat directly.
                    <button
                      className="agent-hub__top-card-btn agent-hub__top-card-btn--chat"
                      onClick={() => {
                        useAgentGatewayStore.getState().openAgentChat(agent.id);
                        onNavigateToChat?.();
                      }}
                      title="Chạy qua Izzi API — luôn sẵn sàng, không cần cài đặt"
                    >
                      💬 Chat
                    </button>
                  ) : agent.status === 'not-installed' ? (
                    <button
                      className="agent-hub__top-card-btn agent-hub__top-card-btn--setup"
                      onClick={() => setSetupAgent(agent)}
                    >
                      ⚙️ Hướng dẫn & Kết nối
                    </button>
                  ) : agent.status === 'running' ? (
                    <button
                      className="agent-hub__top-card-btn agent-hub__top-card-btn--chat"
                      onClick={() => {
                        useAgentGatewayStore.getState().openAgentChat(agent.id);
                        onNavigateToChat?.();
                      }}
                    >
                      💬 Chat Now
                    </button>
                  ) : (
                    // Installed but stopped/errored (e.g. Hermes exited) — offer Start.
                    <button
                      className="agent-hub__top-card-btn agent-hub__top-card-btn--start"
                      onClick={() => setSetupAgent(agent)}
                    >
                      ▶️ Khởi động lại
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Agent Setup Panel */}
      {setupAgent && (
        <AgentSetupPanel
          agent={setupAgent}
          onClose={() => setSetupAgent(null)}
          onInstallComplete={(agentId) => {
            updateAgentStatus(agentId, 'running');
            setSetupAgent(null);
          }}
        />
      )}

      {activeTab === 'store' && (
        <>
          {/* Search + Filters */}
          <div className="agent-store__controls">
            <div className="agent-store__search-wrap">
              <span className="agent-store__search-icon">🔍</span>
              <input
                type="text"
                className="agent-store__search"
                placeholder="Tìm agent... (vd: facebook, bán hàng, thư ký)"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
            </div>

            <div className="agent-store__categories">
              {CATEGORIES.map((cat) => (
                <button
                  key={cat.id}
                  className={`agent-store__category ${activeCategory === cat.id ? 'agent-store__category--active' : ''}`}
                  onClick={() => setActiveCategory(cat.id)}
                >
                  {cat.label}
                </button>
              ))}
            </div>
          </div>

          {/* Featured Banner */}
          {activeCategory === 'all' && !searchQuery && (
            <div className="agent-store__featured-banner">
              <div className="agent-store__featured-glow" />
              <div className="agent-store__featured-content">
                <div className="agent-store__featured-badge">⚡ Bundle deal</div>
                <h2 className="agent-store__featured-title">All-in-One Agent Bundle</h2>
                <p className="agent-store__featured-desc">
                  4 Agent trong 1 gói: Auto Facebook + Auto Saler + Auto Secretary + Auto Content
                </p>
                <div className="agent-store__featured-price">
                  <span className="agent-store__featured-old-price">$74.96/tháng</span>
                  <span className="agent-store__featured-new-price">$49.99/tháng</span>
                  <span className="agent-store__featured-save">Tiết kiệm 33%</span>
                </div>
                <button className="agent-store__featured-cta">
                  🚀 Dùng thử 14 ngày miễn phí
                </button>
              </div>
            </div>
          )}

          {/* Agent Grid */}
          <div className="agent-store__grid">
            {filteredAgents.map((agent) => (
              <div
                key={agent.id}
                className={`agent-card glass-card ${agent.featured ? 'agent-card--featured' : ''}`}
                onClick={() => setSelectedAgent(agent)}
              >
                {/* Card Header */}
                <div className="agent-card__header">
                  <span className="agent-card__icon">{mono(agent.displayName)}</span>
                  <div className="agent-card__meta">
                    <h3 className="agent-card__title">{agent.displayName}</h3>
                    <div className="agent-card__author">
                      by {agent.author.name}
                      {agent.author.verified && <span className="agent-card__verified" title="Verified">✓</span>}
                    </div>
                  </div>
                  {agent.featured && <span className="agent-card__featured-badge">⭐ Featured</span>}
                </div>

                {/* Description */}
                <p className="agent-card__desc">{agent.description}</p>

                {/* Skills preview */}
                <div className="agent-card__skills">
                  <span className="agent-card__skills-label">
                    ✅ {agent.skills.length} skills
                  </span>
                  <span className="agent-card__skills-label">
                    ⏰ {agent.cronJobs} cron jobs
                  </span>
                  <span className="agent-card__skills-label">
                    🔗 {agent.platforms.length} platforms
                  </span>
                </div>

                {/* Footer */}
                <div className="agent-card__footer">
                  <div className="agent-card__stats">
                    <span className="agent-card__rating">⭐{agent.rating}</span>
                    <span className="agent-card__installs">📥{formatInstalls(agent.installs)}</span>
                  </div>
                  <div className="agent-card__price-row">
                    <span className={`agent-card__price ${agent.pricing === 'free' ? 'agent-card__price--free' : ''}`}>
                      {formatPrice(agent)}
                    </span>
                  </div>
                </div>

                {/* Install Button */}
                <button
                  className="agent-card__install-btn"
                  onClick={(e) => {
                    e.stopPropagation();
                    handleInstallClick(agent);
                  }}
                >
                  🚀 Cài đặt 1-Click
                </button>
              </div>
            ))}
          </div>

          {filteredAgents.length === 0 && (
            <div className="agent-store__empty">
              <span className="agent-store__empty-icon">🔍</span>
              <p>Không tìm thấy agent nào phù hợp</p>
              <button className="agent-store__empty-btn" onClick={() => { setSearchQuery(''); setActiveCategory('all'); }}>
                Xem tất cả agents
              </button>
            </div>
          )}
        </>
      )}

      {activeTab === 'installed' && (
        /* Installed Agents Tab */
        <InstalledAgentsPanel
          agents={installedAgents}
          onRefresh={loadInstalledAgents}
        />
      )}

      {/* Agent Detail Modal */}
      {selectedAgent && !showSetupWizard && (
        <AgentDetailModal
          agent={selectedAgent}
          onClose={() => setSelectedAgent(null)}
          onInstall={() => {
            setShowSetupWizard(true);
          }}
        />
      )}

      {/* Setup Wizard Modal */}
      {showSetupWizard && selectedAgent && (
        <AgentSetupWizardModal
          agent={selectedAgent}
          onClose={() => {
            setShowSetupWizard(false);
            setSelectedAgent(null);
          }}
          onComplete={() => {
            setShowSetupWizard(false);
            setSelectedAgent(null);
            loadInstalledAgents();
          }}
        />
      )}
    </div>
  );
}

// ── Agent Detail Modal ──

function AgentDetailModal({ agent, onClose, onInstall }: {
  agent: AgentBundle;
  onClose: () => void;
  onInstall: () => void;
}) {
  return (
    <div className="agent-modal-overlay" onClick={onClose}>
      <div className="agent-modal" onClick={(e) => e.stopPropagation()}>
        <button className="agent-modal__close" onClick={onClose}>✕</button>

        <div className="agent-modal__header">
          <span className="agent-modal__icon">{mono(agent.displayName)}</span>
          <div>
            <h2 className="agent-modal__title">{agent.displayName}</h2>
            <div className="agent-modal__author">
              by {agent.author.name}
              {agent.author.verified && <span className="agent-card__verified">✓</span>}
              <span className="agent-modal__version">v{agent.version}</span>
            </div>
            <div className="agent-modal__stats">
              <span>⭐ {agent.rating} ({Math.floor(agent.installs * 0.02)} reviews)</span>
              <span>📥 {agent.installs.toLocaleString()} installs</span>
            </div>
          </div>
        </div>

        <p className="agent-modal__desc">{agent.description}</p>

        {/* What's Included */}
        <div className="agent-modal__section">
          <h3 className="agent-modal__section-title">Bao gồm:</h3>
          <div className="agent-modal__includes">
            <div className="agent-modal__include-item">
              <span>✅</span> {agent.skills.length} skills đóng gói sẵn
            </div>
            <div className="agent-modal__include-item">
              <span>⏰</span> {agent.cronJobs} automation cron jobs
            </div>
            <div className="agent-modal__include-item">
              <span>🔗</span> {agent.platforms.join(', ')} integration
            </div>
            <div className="agent-modal__include-item">
              <span>🧠</span> Memory system (nhớ phong cách, preferences)
            </div>
            <div className="agent-modal__include-item">
              <span>🎯</span> SOUL.md persona chuyên biệt
            </div>
          </div>
        </div>

        {/* Skills List */}
        <div className="agent-modal__section">
          <h3 className="agent-modal__section-title">Skills:</h3>
          <div className="agent-modal__skills-grid">
            {agent.skills.map((skill) => (
              <span key={skill} className="agent-modal__skill-tag">{skill}</span>
            ))}
          </div>
        </div>

        {/* Install CTA */}
        <div className="agent-modal__cta">
          <button className="agent-modal__install-btn" onClick={onInstall}>
            🚀 Cài đặt 1-Click
            {agent.pricing !== 'free' && agent.price && (
              <span> — ${agent.price.monthly}/tháng</span>
            )}
          </button>
          {agent.trialDays && (
            <p className="agent-modal__trial-note">
              🎁 Dùng thử {agent.trialDays} ngày miễn phí
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Setup Wizard Modal ──

function AgentSetupWizardModal({ agent, onClose, onComplete }: {
  agent: AgentBundle;
  onClose: () => void;
  onComplete: () => void;
}) {
  const [currentStep, setCurrentStep] = useState(0);
  const [secrets, setSecrets] = useState<Record<string, string>>({});
  const [isInstalling, setIsInstalling] = useState(false);
  const [installStatus, setInstallStatus] = useState<'idle' | 'installing' | 'success' | 'error'>('idle');
  const [error, setError] = useState<string | null>(null);

  const [dataConsent, setDataConsent] = useState(false);

  // Generate setup steps from agent platforms
  const steps = [
    { id: 'welcome', title: 'Chào mừng', type: 'info' as const },
    ...agent.platforms.filter(p => p !== 'webhook').map(p => ({
      id: p,
      title: `Kết nối ${p.charAt(0).toUpperCase() + p.slice(1)}`,
      type: 'secret' as const,
    })),
    { id: 'privacy', title: 'Bảo mật dữ liệu', type: 'privacy' as const },
    { id: 'confirm', title: 'Xác nhận', type: 'confirm' as const },
  ];

  async function handleInstall() {
    setIsInstalling(true);
    setInstallStatus('installing');

    try {
      if (window.electronAPI?.agents) {
        await window.electronAPI.agents.install({
          bundleId: agent.id,
          secrets,
          config: {},
        });
      }
      setInstallStatus('success');
      setTimeout(onComplete, 1500);
    } catch (err: any) {
      setInstallStatus('error');
      setError(err.message || 'Cài đặt thất bại');
    } finally {
      setIsInstalling(false);
    }
  }

  function renderStepContent() {
    const step = steps[currentStep];

    if (step.type === 'info') {
      return (
        <div className="setup-wizard__step-content">
          <span className="setup-wizard__big-icon">{mono(agent.displayName)}</span>
          <h3>Cài đặt {agent.displayName}</h3>
          <p>Agent này sẽ được cài đặt với {agent.skills.length} skills và {agent.cronJobs} automation jobs.</p>
          <div className="setup-wizard__time">⏱️ Ước tính: 2–3 phút</div>
        </div>
      );
    }

    if (step.type === 'secret') {
      const platformConfig: Record<string, {
        label: string; placeholder: string; key: string;
        helpTitle: string; helpSteps: string[];
        helpLink?: string; optional?: boolean;
      }> = {
        facebook: {
          label: 'Facebook Graph API Access Token',
          placeholder: 'EAA...',
          key: 'FACEBOOK_PAGE_TOKEN',
          helpTitle: 'Cách lấy Facebook Graph API Token:',
          helpSteps: [
            '1. Truy cập developers.facebook.com → Tạo/chọn App',
            '2. Thêm "Pages API" product vào App',
            '3. Settings → Basic → lấy App ID và App Secret',
            '4. Vào Graph API Explorer → chọn Page → Generate Token',
            '5. Copy Page Access Token (long-lived)',
          ],
          helpLink: 'https://developers.facebook.com/docs/pages/getting-started',
        },
        telegram: {
          label: 'Telegram Bot Token',
          placeholder: '123456:ABC-DEF1234ghIkl-zyx57W2v1u123ew11',
          key: 'TELEGRAM_BOT_TOKEN',
          helpTitle: 'Cách lấy Telegram Bot Token:',
          helpSteps: [
            '1. Mở Telegram → tìm @BotFather',
            '2. Gửi /newbot → đặt tên bot',
            '3. Copy token được cung cấp',
          ],
          helpLink: 'https://core.telegram.org/bots/tutorial',
        },
        zalo: {
          label: 'Zalo OA Access Token',
          placeholder: 'zalo_oa_...',
          key: 'ZALO_OA_TOKEN',
          helpTitle: 'Cách lấy Zalo OA Token:',
          helpSteps: [
            '1. Truy cập oa.zalo.me → Đăng nhập',
            '2. Tạo Official Account (nếu chưa có)',
            '3. Vào developers.zalo.me → Tạo App',
            '4. Thêm Zalo OA API → cấu hình webhook',
            '5. Lấy Access Token từ trang quản lý API',
          ],
          helpLink: 'https://developers.zalo.me/docs/official-account/',
        },
        discord: {
          label: 'Discord Bot Token',
          placeholder: 'MTk...',
          key: 'DISCORD_BOT_TOKEN',
          helpTitle: 'Cách lấy Discord Bot Token:',
          helpSteps: [
            '1. Truy cập discord.com/developers → New Application',
            '2. Bot tab → Add Bot → Copy Token',
          ],
        },
        messenger: {
          label: 'Messenger Page Token',
          placeholder: 'EAA...',
          key: 'MESSENGER_TOKEN',
          helpTitle: 'Dùng chung với Facebook Graph API Token',
          helpSteps: [
            '1. Token trùng với Facebook Page Token',
            '2. Bỏ qua nếu đã cấu hình Facebook ở bước trước',
          ],
          optional: true,
        },
        email: {
          label: 'SMTP Configuration',
          placeholder: 'smtp.gmail.com:587',
          key: 'SMTP_CONFIG',
          helpTitle: 'Cấu hình SMTP Email:',
          helpSteps: [
            '1. Gmail: bật 2FA → tạo App Password',
            '2. Format: host:port (vd: smtp.gmail.com:587)',
            '3. User/Pass sẽ được yêu cầu riêng',
          ],
        },
      };

      const info = platformConfig[step.id] || {
        label: step.title, placeholder: '', key: step.id.toUpperCase(),
        helpTitle: '', helpSteps: [],
      };

      return (
        <div className="setup-wizard__step-content">
          <h3>🔗 {step.title}</h3>

          {/* Setup instructions */}
          <div className="setup-wizard__help-box">
            <h4 className="setup-wizard__help-title">{info.helpTitle}</h4>
            <ol className="setup-wizard__help-steps">
              {info.helpSteps.map((s, i) => (
                <li key={i} className="setup-wizard__help-step">{s}</li>
              ))}
            </ol>
            {info.helpLink && (
              <a
                className="setup-wizard__help-link"
                href={info.helpLink}
                target="_blank"
                rel="noopener noreferrer"
              >
                📘 Xem hướng dẫn chi tiết →
              </a>
            )}
          </div>

          {/* Token input */}
          <div className="setup-wizard__field">
            <label className="setup-wizard__label">
              {info.label}
              {info.optional && <span className="setup-wizard__optional"> (Tùy chọn)</span>}
            </label>
            <input
              type="password"
              className="setup-wizard__input"
              placeholder={info.placeholder}
              value={secrets[info.key] || ''}
              onChange={(e) => setSecrets(prev => ({ ...prev, [info.key]: e.target.value }))}
            />
          </div>

          <p className="setup-wizard__security-note">
            🔒 Token được mã hóa AES-256 và lưu trữ cục bộ trên máy bạn.
            Không bao giờ gửi lên server.
          </p>
          <p className="setup-wizard__skip-note">
            Có thể bỏ qua và cấu hình sau trong Settings
          </p>
        </div>
      );
    }

    if (step.type === 'privacy') {
      return (
        <div className="setup-wizard__step-content">
          <h3>🛡️ Bảo mật \u0026 Quyền riêng tư dữ liệu</h3>

          <div className="setup-wizard__privacy-info">
            <div className="setup-wizard__privacy-section">
              <h4>📋 Dữ liệu Agent xử lý:</h4>
              <ul className="setup-wizard__privacy-list">
                <li>Tin nhắn, comment từ khách hàng trên các nền tảng được kết nối</li>
                <li>Thông tin liên hệ cơ bản (tên, ID profile)</li>
                <li>Nội dung bài viết do Agent tạo ra</li>
                <li>Thống kê hiệu suất (engagement, reach)</li>
              </ul>
            </div>

            <div className="setup-wizard__privacy-section">
              <h4>🔒 Cam kết bảo mật (PDPA Compliance):</h4>
              <ul className="setup-wizard__privacy-list">
                <li>✅ Dữ liệu được xử lý <strong>100% cục bộ</strong> trên máy bạn</li>
                <li>✅ Token API <strong>mã hóa AES-256</strong>, không gửi lên cloud</li>
                <li>✅ Không chia sẻ dữ liệu với bên thứ ba</li>
                <li>✅ Có thể xóa toàn bộ dữ liệu bất kỳ lúc nào</li>
                <li>✅ Log hoạt động lưu cục bộ, tự động xóa sau 30 ngày</li>
              </ul>
            </div>

            <div className="setup-wizard__privacy-section">
              <h4>⚠️ Lưu ý quan trọng:</h4>
              <ul className="setup-wizard__privacy-list">
                <li>LLM calls (nếu dùng cloud API) sẽ gửi nội dung tin nhắn qua API provider</li>
                <li>Bạn chịu trách nhiệm tuân thủ chính sách của từng nền tảng</li>
                <li>Khuyến nghị: thông báo cho khách hàng về việc sử dụng AI assistant</li>
              </ul>
            </div>
          </div>

          <label className="setup-wizard__consent-label">
            <input
              type="checkbox"
              checked={dataConsent}
              onChange={(e) => setDataConsent(e.target.checked)}
              className="setup-wizard__consent-checkbox"
            />
            <span>
              Tôi đã đọc và đồng ý với chính sách xử lý dữ liệu.
              Tôi hiểu rằng dữ liệu khách hàng sẽ được Agent xử lý
              theo các điều khoản bên trên.
            </span>
          </label>
        </div>
      );
    }

    if (step.type === 'confirm') {
      return (
        <div className="setup-wizard__step-content">
          <h3>✅ Xác nhận cài đặt</h3>
          <div className="setup-wizard__summary">
            <div className="setup-wizard__summary-row">
              <span>Agent:</span>
              <span>{agent.displayName}</span>
            </div>
            <div className="setup-wizard__summary-row">
              <span>Skills:</span>
              <span>{agent.skills.length} skills</span>
            </div>
            <div className="setup-wizard__summary-row">
              <span>Automation:</span>
              <span>{agent.cronJobs} cron jobs</span>
            </div>
            <div className="setup-wizard__summary-row">
              <span>Platforms:</span>
              <span>{Object.keys(secrets).length} đã kết nối</span>
            </div>
            <div className="setup-wizard__summary-row">
              <span>Giá:</span>
              <span>{agent.pricing === 'free' ? 'Miễn phí' : `$${agent.price?.monthly}/tháng`}</span>
            </div>
          </div>

          {installStatus === 'success' && (
            <div className="setup-wizard__success">
              <span className="setup-wizard__success-icon">🎉</span>
              <p>Agent đã được cài đặt thành công!</p>
            </div>
          )}

          {installStatus === 'error' && (
            <div className="setup-wizard__error">
              <span>❌</span> {error}
            </div>
          )}
        </div>
      );
    }

    return null;
  }

  return (
    <div className="agent-modal-overlay" onClick={onClose}>
      <div className="setup-wizard" onClick={(e) => e.stopPropagation()}>
        <button className="agent-modal__close" onClick={onClose}>✕</button>

        {/* Progress bar */}
        <div className="setup-wizard__progress">
          <div className="setup-wizard__progress-fill" style={{ width: `${((currentStep + 1) / steps.length) * 100}%` }} />
        </div>
        <div className="setup-wizard__step-label">
          Bước {currentStep + 1}/{steps.length}: {steps[currentStep].title}
        </div>

        {/* Content */}
        {renderStepContent()}

        {/* Navigation */}
        <div className="setup-wizard__actions">
          {currentStep > 0 && (
            <button className="setup-wizard__btn setup-wizard__btn--back" onClick={() => setCurrentStep(s => s - 1)}>
              ← Quay lại
            </button>
          )}

          {currentStep < steps.length - 1 ? (
            <button className="setup-wizard__btn setup-wizard__btn--next" onClick={() => setCurrentStep(s => s + 1)}>
              Tiếp tục →
            </button>
          ) : (
            <button
              className="setup-wizard__btn setup-wizard__btn--install"
              onClick={handleInstall}
              disabled={isInstalling || installStatus === 'success' || !dataConsent}
            >
              {isInstalling ? '⏳ Đang cài đặt...' :
               installStatus === 'success' ? '✅ Hoàn tất' :
               '🚀 Cài đặt ngay'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Installed Agents Panel ──

function InstalledAgentsPanel({ agents, onRefresh }: {
  agents: InstalledAgentInfo[];
  onRefresh: () => void;
}) {
  if (agents.length === 0) {
    return (
      <div className="agent-store__empty">
        <span className="agent-store__empty-icon">📦</span>
        <p>Chưa có agent nào được cài đặt</p>
        <p className="agent-store__empty-sub">Cài đặt agent từ cửa hàng để bắt đầu</p>
      </div>
    );
  }

  const statusLabels: Record<string, { label: string; color: string }> = {
    active: { label: '🟢 Đang hoạt động', color: 'var(--color-success)' },
    paused: { label: '⏸️ Tạm dừng', color: 'var(--color-warning)' },
    configuring: { label: '⚙️ Đang cấu hình', color: 'var(--color-info)' },
    error: { label: '🔴 Lỗi', color: 'var(--color-error)' },
    stopped: { label: '⏹️ Đã dừng', color: 'var(--color-text-tertiary)' },
  };

  return (
    <div className="installed-agents">
      <div className="installed-agents__header">
        <h2>Agent đã cài đặt</h2>
        <button className="installed-agents__refresh" onClick={onRefresh}>🔄 Làm mới</button>
      </div>
      <div className="installed-agents__list">
        {agents.map((agent) => {
          const statusInfo = statusLabels[agent.status] || statusLabels.stopped;

          return (
            <div key={agent.name} className="installed-agent-card">
              <div className="installed-agent-card__header">
                <span className="installed-agent-card__icon">{mono(agent.displayName)}</span>
                <div className="installed-agent-card__info">
                  <h3>{agent.displayName}</h3>
                  <span className="installed-agent-card__version">v{agent.version}</span>
                </div>
                <span className="installed-agent-card__status" style={{ color: statusInfo.color }}>
                  {statusInfo.label}
                </span>
              </div>
              <div className="installed-agent-card__stats">
                <span>💬 {agent.stats?.totalMessages || 0} messages</span>
                <span>⚡ {agent.stats?.totalWorkflowRuns || 0} workflows</span>
                <span>🔗 {agent.connectedPlatforms.length} platforms</span>
                <span>⏰ {agent.activeCronJobs} cron jobs</span>
              </div>
              <div className="installed-agent-card__actions">
                <button className="installed-agent-card__btn installed-agent-card__btn--chat">💬 Chat</button>
                <button className="installed-agent-card__btn">⚙️ Cấu hình</button>
                <button className="installed-agent-card__btn">
                  {agent.status === 'active' ? '⏸️ Tạm dừng' : '▶️ Bật'}
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
