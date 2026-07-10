import React, { useState, useEffect, useCallback, useRef } from 'react';
import { apiClient } from '../lib/api-client';
import { ExtensionDetailPage } from './ExtensionDetail';
import { DeveloperUploadPage } from './DeveloperUpload';
import { DeveloperDashboardPage } from './DeveloperDashboard';
import { SkeletonGrid } from '../components/Skeleton';
import { useAgentGatewayStore } from '../store/agentGateway';
import { buildSelfInstallPrompt } from '../lib/agent-self-install-prompt';

interface MarketplaceExtension {
  id: string;
  name: string;
  displayName: string;
  description: string;
  author: string;
  version: string;
  category: string;
  rating: number;
  installs: number;
  price: { monthly: number; yearly: number } | null;
  icon: string;
}

const CATEGORIES = ['Tất cả', 'SEO', 'Marketing', 'Content', 'Video', 'Voice', 'Analytics', 'Email', 'Customer Support'];

// Demo fallback data
const DEMO_EXTENSIONS: MarketplaceExtension[] = [
  { id: 'ext-seo-scanner', name: 'smart-seo-scanner', displayName: 'Smart SEO Scanner', description: 'Quét và phân tích SEO tự động cho website. Tìm lỗi meta tags, broken links, và tối ưu on-page.', author: 'SEO Tools Inc.', version: '1.2.0', category: 'SEO', rating: 4.8, installs: 12500, price: null, icon: '🔍' },
  { id: 'ext-social-auto-poster', name: 'social-auto-poster', displayName: 'Social Auto Poster', description: 'Lên lịch & tự động đăng bài Facebook / YouTube / TikTok qua Auto-Post Tool. Mở tiện ích là tự khởi động backend cục bộ (localhost) — dùng chung tài khoản izzi.', author: 'Starizzi', version: '0.3.0', category: 'Marketing', rating: 4.5, installs: 8900, price: { monthly: 9.99, yearly: 99.99 }, icon: '📱' },
  { id: 'ext-ai-content', name: 'ai-content-writer', displayName: 'AI Content Writer', description: 'Viết nội dung marketing, blog, email bằng AI. Hỗ trợ tiếng Việt và 30+ ngôn ngữ.', author: 'ContentAI Co.', version: '3.1.0', category: 'Content', rating: 4.9, installs: 25000, price: { monthly: 19.99, yearly: 199.99 }, icon: '✨' },
  { id: 'ext-analytics', name: 'deep-analytics', displayName: 'Deep Analytics Dashboard', description: 'Dashboard phân tích traffic, conversion, user behavior. Tích hợp Google Analytics và Facebook Pixel.', author: 'DataViz Studio', version: '1.5.0', category: 'Analytics', rating: 4.7, installs: 15200, price: null, icon: '📊' },
  { id: 'ext-email-campaign', name: 'email-campaign-pro', displayName: 'Email Campaign Pro', description: 'Tạo và gửi email marketing chuyên nghiệp. A/B testing, automation workflows, và analytics.', author: 'MailFlow Solutions', version: '2.3.0', category: 'Email', rating: 4.6, installs: 6700, price: { monthly: 14.99, yearly: 149.99 }, icon: '📧' },
  { id: 'ext-chatbot', name: 'smart-chatbot', displayName: 'Smart Chatbot Builder', description: 'Xây dựng chatbot AI cho website và Messenger. Tự động trả lời khách hàng 24/7.', author: 'BotFactory', version: '1.0.0', category: 'Customer Support', rating: 4.4, installs: 3200, price: { monthly: 24.99, yearly: 249.99 }, icon: '🤖' },
  // ── Tool thật của izzi (từ F:\Ai Tools) — có backend/source riêng ──
  { id: 'ext-chat-quality', name: 'chat-quality-agent', displayName: 'Chat Quality Agent (CSKH)', description: 'Đồng bộ Zalo OA & Facebook Messenger, dùng AI chấm điểm chất lượng chăm sóc khách hàng (Đạt/Không đạt, 0-100), phân loại chat, cảnh báo Telegram/Email.', author: 'Starizzi', version: '1.0.0', category: 'Customer Support', rating: 4.6, installs: 2100, price: { monthly: 12.99, yearly: 129 }, icon: '📞' },
  { id: 'ext-toonflow', name: 'toonflow-studio', displayName: 'Toonflow Studio', description: 'Biến tiểu thuyết/truyện thành kịch bản → phân cảnh → ảnh → video ngắn (short drama) trên canvas vô hạn. Đa AI provider (Sora / Nano Banana / Seedance).', author: 'Starizzi', version: '1.0.0', category: 'Video', rating: 4.7, installs: 3400, price: { monthly: 24.99, yearly: 249 }, icon: '🎬' },
  { id: 'ext-omnivoice', name: 'omnivoice-tts', displayName: 'OmniVoice TTS', description: 'Text-to-speech + voice cloning đa ngôn ngữ, chạy cục bộ. Tạo sách nói / lồng tiếng từ văn bản.', author: 'Starizzi', version: '1.0.0', category: 'Voice', rating: 4.5, installs: 1800, price: null, icon: '🎙️' },
  { id: 'ext-html-video', name: 'html-to-video', displayName: 'HTML to Video', description: 'Render HTML/template thành video bằng Playwright — lớp "HTML→Video" cho coding agent. Không phụ thuộc token bên thứ ba.', author: 'Starizzi', version: '0.1.0', category: 'Video', rating: 4.3, installs: 900, price: null, icon: '🎞️' },
  { id: 'ext-meta-ads-ai', name: 'meta-ads-autopilot', displayName: 'Meta Ads Autopilot', description: 'Tự động hoá Meta Ads chuyên sâu: AI bidding, rule automation, A/B creative testing — chuẩn Revealbot/Madgicx. Thay cho script FB Ads cơ bản.', author: 'izzi', version: '1.0.0', category: 'Marketing', rating: 4.6, installs: 3900, price: { monthly: 29.99, yearly: 299 }, icon: '🎯' },
  // ── Tool desktop đã cài trên máy (chạy cục bộ) ──
  { id: 'ext-ai-video-studio', name: 'ai-video-studio', displayName: 'AI Video Studio', description: 'Tạo video AI (text/image→video) điều khiển Veo/Grok/SORA. Lưu ý: nên dùng nguồn hợp lệ (model open-weight hoặc API chính thức) thay vì tự động hoá API nội bộ.', author: 'Starizzi', version: '0.1.0', category: 'Video', rating: 4.2, installs: 1500, price: { monthly: 29.99, yearly: 299 }, icon: '📹' },
  { id: 'ext-facefusion', name: 'facefusion', displayName: 'FaceFusion', description: 'Hoán đổi/chỉnh khuôn mặt trên ảnh & video (face swap), chạy cục bộ, cần GPU. Dùng có trách nhiệm — cần sự đồng ý của người xuất hiện.', author: 'FaceFusion (OSS)', version: '3.0.0', category: 'Video', rating: 4.3, installs: 4200, price: null, icon: '🎭' },
  { id: 'ext-quickmagic', name: 'quick-magic', displayName: 'Quick Magic', description: 'Tải & chuyển đổi video từ URL (yt-dlp + ffmpeg), gói gọn trong app desktop.', author: 'Starizzi', version: '1.0.0', category: 'Video', rating: 4.4, installs: 5100, price: null, icon: '⬇️' },
  // ── Tối ưu nhất 2026 (quốc tế + Việt Nam) — bổ sung bên cạnh tool sẵn có ──
  { id: 'ext-chatterbox', name: 'chatterbox-voice', displayName: 'Chatterbox Voice (v3)', description: 'Voice cloning + TTS đa ngôn ngữ chất lượng cao (Resemble AI) — được ưa hơn ElevenLabs trong test A/B mù, có watermark. Chạy cục bộ. Nâng cấp cho OmniVoice.', author: 'Resemble AI (OSS)', version: '3.0.0', category: 'Voice', rating: 4.8, installs: 6400, price: null, icon: '🔊' },
  { id: 'ext-vieneu-tts', name: 'vieneu-tts', displayName: 'VieNeu-TTS (Việt)', description: 'TTS tiếng Việt on-device 48kHz, clone giọng tức thì, song ngữ Anh–Việt, chạy cả CPU (ONNX). Tối ưu cho nội dung Việt.', author: 'pnnbao (OSS)', version: '3.0.0', category: 'Voice', rating: 4.7, installs: 3100, price: null, icon: '🇻🇳' },
  { id: 'ext-ltx2', name: 'ltx2-video', displayName: 'LTX-2 Video', description: 'Sinh video AI open-weight (miễn phí, chạy qua ComfyUI) — text/image→video. Nguồn hợp pháp thay cho tự động hoá API nội bộ, không rủi ro ToS.', author: 'Lightricks (OSS)', version: '2.0.0', category: 'Video', rating: 4.6, installs: 5200, price: null, icon: '🎥' },
  { id: 'ext-mcai', name: 'mcai-video', displayName: 'MCAI (Việt)', description: 'Tạo video AI tiếng Việt: ảnh nhân vật → video nguồn, giọng đọc, đồng bộ nhép miệng thành video hoàn chỉnh. Cho creator/shop/marketing Việt.', author: 'MCAI', version: '1.0.0', category: 'Video', rating: 4.5, installs: 2800, price: { monthly: 9.99, yearly: 99 }, icon: '📽️' },
  { id: 'ext-postiz', name: 'postiz', displayName: 'Postiz', description: 'Lên lịch đăng 30+ nền tảng từ 1 dashboard (open-source, 29k★ GitHub) — self-host thay Buffer. Bổ sung cho Social Auto Poster.', author: 'Postiz (OSS)', version: '1.0.0', category: 'Marketing', rating: 4.7, installs: 7300, price: null, icon: '🗓️' },
];

export function MarketplacePage({ onNavigateToChat }: { onNavigateToChat?: () => void } = {}) {
  const [extensions, setExtensions] = useState<MarketplaceExtension[]>([]);
  const [filteredExtensions, setFilteredExtensions] = useState<MarketplaceExtension[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [activeCategory, setActiveCategory] = useState('Tất cả');
  const [installedIds, setInstalledIds] = useState<Set<string>>(new Set());
  const [installingId, setInstallingId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [apiStatus, setApiStatus] = useState<'checking' | 'online' | 'offline'>('checking');
  const [error, setError] = useState<string | null>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const PAGE_SIZE = 12;
  const [selectedExtension, setSelectedExtension] = useState<MarketplaceExtension | null>(null);
  const [showDevUpload, setShowDevUpload] = useState(false);
  const [showDevDash, setShowDevDash] = useState(false);
  const [searchSuggestions, setSearchSuggestions] = useState<MarketplaceExtension[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [sortBy, setSortBy] = useState<'popular' | 'rating' | 'newest' | 'name'>('popular');
  const searchRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    checkApiAndLoad();
    loadInstalled();
  }, []);

  useEffect(() => {
    filterExtensions();
  }, [extensions, searchQuery, activeCategory, sortBy]);

  async function checkApiAndLoad() {
    setIsLoading(true);
    setError(null);

    // Try marketplace API (port 8788) first
    const isApiOnline = await apiClient.checkMarketplaceHealth();
    setApiStatus(isApiOnline ? 'online' : 'offline');

    if (isApiOnline) {
      await loadFromApi();
    } else if (window.electronAPI) {
      await loadFromElectron();
    } else {
      // Browser dev mode — no API available, use demo data
      console.log('[Marketplace] Using demo data (API offline, no Electron)');
      setExtensions(DEMO_EXTENSIONS);
    }

    setIsLoading(false);
  }

  async function loadFromApi(page = 1) {
    try {
      const data = await apiClient.getMarketplaceExtensions({
        search: searchQuery || undefined,
        category: activeCategory !== 'Tất cả' ? activeCategory : undefined,
        page,
        limit: PAGE_SIZE,
        sort: 'popular',
      });

      // Normalize API response to our interface
      const mapped: MarketplaceExtension[] = (data.extensions || data || []).map((e: any) => ({
        id: e.id,
        name: e.name,
        displayName: e.display_name || e.displayName,
        description: e.description,
        author: e.author || e.developer_name || 'Unknown',
        version: e.version,
        category: e.category,
        rating: e.rating_avg || e.rating || 0,
        installs: e.install_count || e.installs || 0,
        price: e.price_monthly
          ? { monthly: e.price_monthly, yearly: e.price_yearly || e.price_monthly * 10 }
          : null,
        icon: e.icon_url || e.icon || '🧩',
      }));

      setExtensions(mapped);
      setTotalPages(data.pagination?.totalPages || data.totalPages || Math.ceil((data.pagination?.total || data.total || mapped.length) / PAGE_SIZE));
      setCurrentPage(data.pagination?.page || page);
      console.log(`[Marketplace] Loaded ${mapped.length} extensions from API (page ${page})`);
    } catch (err: any) {
      console.error('[Marketplace] API fetch failed:', err);
      setError(`API Error: ${err.message}`);
      // Fall back to demo
      setExtensions(DEMO_EXTENSIONS);
    }
  }

  async function loadFromElectron() {
    try {
      const data = await window.electronAPI!.extensions.marketplace(searchQuery || undefined);
      setExtensions(data || []);
      console.log(`[Marketplace] Loaded ${data?.length || 0} extensions from Electron IPC`);
    } catch (err: any) {
      console.warn('[Marketplace] Electron IPC failed:', err);
      setExtensions(DEMO_EXTENSIONS);
    }
  }

  async function loadInstalled() {
    try {
      if (window.electronAPI) {
        const ids = new Set<string>();
        const installed = await window.electronAPI.extensions.list();
        installed.forEach((e: any) => ids.add(e.id));
        // Also treat runtime-loaded extensions (installed on disk / first-party bundled) as installed.
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const runtime = await (window as any).electronAPI.extensionRuntime?.list?.();
        (runtime || []).forEach((e: any) => ids.add(e.id));
        setInstalledIds(ids);
      }
    } catch {}
  }

  const filterExtensions = useCallback(() => {
    let filtered = [...extensions];
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      filtered = filtered.filter(
        e => e.displayName.toLowerCase().includes(q) ||
             e.description.toLowerCase().includes(q) ||
             e.author.toLowerCase().includes(q)
      );
    }
    if (activeCategory !== 'Tất cả') {
      filtered = filtered.filter(e => e.category === activeCategory);
    }
    // Apply sorting
    switch (sortBy) {
      case 'popular':
        filtered.sort((a, b) => b.installs - a.installs);
        break;
      case 'rating':
        filtered.sort((a, b) => b.rating - a.rating);
        break;
      case 'newest':
        filtered.sort((a, b) => b.version.localeCompare(a.version));
        break;
      case 'name':
        filtered.sort((a, b) => a.displayName.localeCompare(b.displayName));
        break;
    }
    setFilteredExtensions(filtered);
  }, [extensions, searchQuery, activeCategory, sortBy]);

  // Debounced API search
  useEffect(() => {
    if (apiStatus !== 'online') return;
    const timer = setTimeout(() => {
      loadFromApi(1);
    }, 400);
    return () => clearTimeout(timer);
  }, [searchQuery, activeCategory]);

  const [installToast, setInstallToast] = useState<{ message: string; type: 'success' | 'error' | 'info' } | null>(null);

  /**
   * "Loop Prompt" for a tool: a tool isn't a chat agent, so open a capable izzi
   * persona's chat and seed a self-install instruction for this extension. The
   * user reviews + sends; the agent installs/configures it in-session.
   */
  function openLoopPromptForTool(ext: MarketplaceExtension) {
    const gw = useAgentGatewayStore.getState();
    const installer = gw.agents.find((a) => a.runtime === 'izzi') ?? gw.agents[0];
    if (!installer) return;
    gw.openAgentChat(installer.id);
    gw.setComposerDraft(
      buildSelfInstallPrompt({ kind: 'tool', id: ext.id, displayName: ext.displayName, setupHint: `Danh mục: ${ext.category}` }),
    );
    onNavigateToChat?.();
  }

  async function handleInstall(ext: MarketplaceExtension) {
    setInstallingId(ext.id);
    setInstallToast({ message: `Đang tải ${ext.displayName}...`, type: 'info' });

    try {
      if (window.electronAPI?.extensionRuntime) {
        // Use the full download → SHA-256 verify → install pipeline
        const result = await window.electronAPI.extensionRuntime.installFromMarketplace(ext.id);
        if (result.success) {
          setInstalledIds(prev => new Set([...prev, ext.id]));
          setInstallToast({ message: `✅ Đã cài đặt ${ext.displayName}!`, type: 'success' });
        } else {
          setInstallToast({ message: `❌ ${result.error || 'Cài đặt thất bại'}`, type: 'error' });
        }
      } else if (apiStatus === 'online') {
        // Browser mode — API-only install tracking
        await apiClient.installExtension(ext.id);
        setInstalledIds(prev => new Set([...prev, ext.id]));
        setInstallToast({ message: `✅ Đã đánh dấu cài đặt ${ext.displayName}`, type: 'success' });
      } else {
        // Demo mode
        await new Promise(r => setTimeout(r, 1500));
        setInstalledIds(prev => new Set([...prev, ext.id]));
        setInstallToast({ message: `✅ Demo — ${ext.displayName} đã được cài đặt`, type: 'success' });
      }
    } catch (err: any) {
      console.error('Install failed:', err);
      setInstallToast({ message: `❌ Lỗi: ${err.message || 'Unknown error'}`, type: 'error' });
    }

    setInstallingId(null);
    // Auto-dismiss toast after 4 seconds
    setTimeout(() => setInstallToast(null), 4000);
  }

  function formatInstalls(count: number): string {
    if (count >= 1000) return `${(count / 1000).toFixed(1)}k`;
    return String(count);
  }

  function renderStars(rating: number): string {
    const full = Math.floor(rating);
    return '★'.repeat(full) + '☆'.repeat(5 - full);
  }

  function handlePageChange(page: number) {
    if (apiStatus === 'online') {
      loadFromApi(page);
    }
  }

  // If a detail extension is selected, render the detail view
  if (selectedExtension) {
    return (
      <div>
        <div className="page-header">
          <h1 className="page-header__title">🏪 Marketplace</h1>
        </div>
        <ExtensionDetailPage
          extension={selectedExtension}
          isInstalled={installedIds.has(selectedExtension.id)}
          onInstall={() => handleInstall(selectedExtension)}
          isInstalling={installingId === selectedExtension.id}
          onBack={() => setSelectedExtension(null)}
          onLoopPrompt={() => openLoopPromptForTool(selectedExtension)}
        />

        {/* Install Toast */}
        {installToast && (
          <div
            className="marketplace-toast"
            style={{
              // dynamic by toast type; values routed to Hệ_Token (Req 4.3)
              background: installToast.type === 'success'
                ? 'var(--gradient-toast-success)'
                : installToast.type === 'error'
                  ? 'var(--gradient-toast-error)'
                  : 'var(--gradient-toast-info)',
              color: 'var(--color-toast-text)',
              boxShadow: 'var(--shadow-toast)',
              backdropFilter: 'var(--glass-blur)',
            }}
          >
            {installToast.message}
          </div>
        )}

        <style>{`
          @keyframes toast-slide-in {
            from { transform: translateY(20px) scale(0.95); opacity: 0; }
            to { transform: translateY(0) scale(1); opacity: 1; }
          }
        `}</style>
      </div>
    );
  }

  // Developer Upload view
  if (showDevUpload) {
    return (
      <DeveloperUploadPage onBack={() => setShowDevUpload(false)} />
    );
  }

  // Developer Dashboard view
  if (showDevDash) {
    return (
      <DeveloperDashboardPage onBack={() => setShowDevDash(false)} />
    );
  }

  return (
    <div>
      <div className="page-header marketplace-header">
        <div>
          <h1 className="page-header__title">🏪 Marketplace</h1>
          <p className="page-header__subtitle">
            Khám phá và cài đặt tiện ích mở rộng cho Izzi OpenClaw
          </p>
        </div>
        <div className="marketplace-header__actions">
          <button
            className="btn btn--ghost btn--sm"
            onClick={() => setShowDevDash(true)}
          >
            👨‍💻 Dashboard
          </button>
          <button
            className="btn btn--accent"
            onClick={() => setShowDevUpload(true)}
          >
            🚀 Đăng tải tiện ích
          </button>
        </div>
      </div>

      {/* API Status Badge */}
      <div className="marketplace-api-status">
        <span
          className="marketplace-api-status__dot"
          style={{
            background: apiStatus === 'online' ? 'var(--color-success)' : apiStatus === 'offline' ? 'var(--color-error)' : 'var(--color-warning)',
          }}
        />
        <span className="marketplace-api-status__label">
          {apiStatus === 'online' && 'Marketplace API kết nối'}
          {apiStatus === 'offline' && 'Marketplace API offline — hiển thị dữ liệu demo'}
          {apiStatus === 'checking' && 'Đang kiểm tra kết nối...'}
        </span>
        {apiStatus === 'offline' && (
          <button
            className="btn btn--ghost btn--sm marketplace-api-status__retry"
            onClick={checkApiAndLoad}
          >
            🔄 Thử lại
          </button>
        )}
      </div>

      {error && (
        <div className="marketplace-error">
          ⚠️ {error}
        </div>
      )}

      {/* Search */}
      <div className="search-bar" ref={searchRef} role="search">
        <span className="search-bar__icon" aria-hidden="true">🔍</span>
        <input
          id="marketplace-search"
          className="search-bar__input"
          type="text"
          placeholder="Tìm kiếm tiện ích... (VD: SEO, chatbot, email)"
          aria-label="Tìm kiếm tiện ích mở rộng"
          aria-expanded={showSuggestions}
          aria-autocomplete="list"
          autoComplete="off"
          value={searchQuery}
          onKeyDown={e => {
            if (e.key === 'Escape') {
              setShowSuggestions(false);
              (e.target as HTMLInputElement).blur();
            }
          }}
          onChange={e => {
            const q = e.target.value;
            setSearchQuery(q);
            if (q.trim().length >= 2) {
              const matches = extensions.filter(ext =>
                ext.displayName.toLowerCase().includes(q.toLowerCase()) ||
                ext.description.toLowerCase().includes(q.toLowerCase()) ||
                ext.category.toLowerCase().includes(q.toLowerCase())
              ).slice(0, 5);
              setSearchSuggestions(matches);
              setShowSuggestions(matches.length > 0);
            } else {
              setShowSuggestions(false);
            }
          }}
          onFocus={() => {
            if (searchQuery.trim().length >= 2 && searchSuggestions.length > 0) {
              setShowSuggestions(true);
            }
          }}
          onBlur={() => {
            // Delayed hide so clicks on suggestions register
            setTimeout(() => setShowSuggestions(false), 200);
          }}
        />
        {/* Search Suggestions Dropdown */}
        {showSuggestions && searchSuggestions.length > 0 && (
          <div className="search-suggestions">
            {searchSuggestions.map(ext => (
              <button
                key={ext.id}
                className="search-suggestion"
                onMouseDown={() => {
                  setSelectedExtension(ext);
                  setShowSuggestions(false);
                  setSearchQuery('');
                }}
              >
                <span className="search-suggestion__icon">{ext.icon}</span>
                <div className="search-suggestion__info">
                  <span className="search-suggestion__name">{ext.displayName}</span>
                  <span className="search-suggestion__category">{ext.category}</span>
                </div>
                <span className="search-suggestion__rating">{'★'.repeat(Math.floor(ext.rating))} {ext.rating.toFixed(1)}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Sort & Category Controls */}
      <div className="marketplace-controls">
        {/* Category Filter */}
        <div className="filter-pills filter-pills--flush">
          {CATEGORIES.map(cat => (
            <button
              key={cat}
              className={`filter-pill ${activeCategory === cat ? 'filter-pill--active' : ''}`}
              onClick={() => setActiveCategory(cat)}
            >
              {cat}
            </button>
          ))}
        </div>

        {/* Sort Controls */}
        <div className="sort-controls">
          <span className="sort-controls__label">Sắp xếp:</span>
          {([
            { key: 'popular' as const, icon: '🔥', label: 'Phổ biến' },
            { key: 'rating' as const, icon: '⭐', label: 'Đánh giá' },
            { key: 'newest' as const, icon: '🆕', label: 'Mới nhất' },
            { key: 'name' as const, icon: '🔤', label: 'Tên' },
          ]).map(s => (
            <button
              key={s.key}
              className={`sort-pill ${sortBy === s.key ? 'sort-pill--active' : ''}`}
              onClick={() => setSortBy(s.key)}
            >
              {s.icon} {s.label}
            </button>
          ))}
        </div>
      </div>

      {/* Loading State */}
      {isLoading ? (
        <SkeletonGrid count={6} />
      ) : (
        <>
          {/* Extension Grid */}
          <div className="section-header">
            <h2 className="section-header__title">
              {activeCategory === 'Tất cả' ? 'Tất cả tiện ích' : activeCategory}
            </h2>
            <span className="marketplace-result-count">
              {filteredExtensions.length} kết quả
            </span>
          </div>

          <div className="marketplace-grid">
            {filteredExtensions.map((ext, i) => {
              const isInstalled = installedIds.has(ext.id);
              const isInstalling = installingId === ext.id;

              return (
                <div key={ext.id} className="ext-card glass-card animate-in" style={{ animationDelay: `${i * 60}ms` }}>
                  <div className="ext-card__header ext-card__header--clickable" onClick={() => setSelectedExtension(ext)}>
                    <div className="ext-card__icon">{ext.icon}</div>
                    <div className="ext-card__meta">
                      <div className="ext-card__name">{ext.displayName}</div>
                      <div className="ext-card__author">by {ext.author}</div>
                    </div>
                    <span className="ext-card__category">{ext.category}</span>
                  </div>

                  <p className="ext-card__description">{ext.description}</p>

                  <div className="ext-card__footer">
                    <div className="ext-card__stats">
                      <span className="ext-card__rating">
                        {renderStars(ext.rating)} {ext.rating.toFixed(1)}
                      </span>
                      <span className="ext-card__installs">
                        📥 {formatInstalls(ext.installs)}
                      </span>
                    </div>

                    <div className="ext-card__actions">
                      {ext.price ? (
                        <span className="ext-card__price ext-card__price--paid">
                          ${ext.price.monthly}/mo
                        </span>
                      ) : (
                        <span className="ext-card__price ext-card__price--free">Miễn phí</span>
                      )}

                      {isInstalled ? (
                        <button className="btn btn--installed btn--sm">✓ Đã cài</button>
                      ) : (
                        <button
                          className="btn btn--primary btn--sm"
                          onClick={() => handleInstall(ext)}
                          disabled={isInstalling}
                        >
                          {isInstalling ? '⏳' : '📦'} {isInstalling ? 'Đang cài...' : 'Cài đặt'}
                        </button>
                      )}
                      <button
                        className="ext-card__loop-btn"
                        onClick={() => openLoopPromptForTool(ext)}
                        title="Mở loop prompt để agent tự cài đặt tiện ích trong phiên chat"
                      >
                        ⟳ Tự cài
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="marketplace-pagination">
              <button
                className="btn btn--ghost btn--sm"
                onClick={() => handlePageChange(currentPage - 1)}
                disabled={currentPage <= 1}
              >
                ← Trước
              </button>
              {Array.from({ length: totalPages }, (_, i) => i + 1).map(page => (
                <button
                  key={page}
                  className={`btn btn--sm marketplace-page-btn ${page === currentPage ? 'btn--primary' : 'btn--ghost'}`}
                  onClick={() => handlePageChange(page)}
                >
                  {page}
                </button>
              ))}
              <button
                className="btn btn--ghost btn--sm"
                onClick={() => handlePageChange(currentPage + 1)}
                disabled={currentPage >= totalPages}
              >
                Tiếp →
              </button>
            </div>
          )}

          {filteredExtensions.length === 0 && !isLoading && (
            <div className="empty-state">
              <div className="empty-state__icon">🔍</div>
              <h3 className="empty-state__title">Không tìm thấy tiện ích</h3>
              <p className="empty-state__description">
                Thử thay đổi từ khóa tìm kiếm hoặc chọn danh mục khác
              </p>
            </div>
          )}
        </>
      )}

      {/* Install Toast Notification */}
      {installToast && (
        <div
          className="marketplace-toast"
          style={{
            // dynamic by toast type; values routed to Hệ_Token (Req 4.3)
            background: installToast.type === 'success'
              ? 'var(--gradient-toast-success)'
              : installToast.type === 'error'
                ? 'var(--gradient-toast-error)'
                : 'var(--gradient-toast-info)',
            color: 'var(--color-toast-text)',
            boxShadow: 'var(--shadow-toast)',
            backdropFilter: 'var(--glass-blur)',
          }}
        >
          {installToast.type === 'info' && (
            <span
              className="marketplace-toast__spinner"
              style={{
                // ring colors routed to Hệ_Token (Req 4.3)
                border: '2px solid var(--color-border-hover)',
                borderTopColor: 'var(--color-toast-text)',
              }}
            />
          )}
          {installToast.message}
          <button
            onClick={() => setInstallToast(null)}
            className="marketplace-toast__close"
            style={{
              color: 'var(--color-toast-text)',
            }}
          >✕</button>
        </div>
      )}

      {/* Animations */}
      <style>{`
        @keyframes spin {
          to { transform: rotate(360deg); }
        }
        @keyframes toast-slide-in {
          from { transform: translateY(20px) scale(0.95); opacity: 0; }
          to { transform: translateY(0) scale(1); opacity: 1; }
        }
      `}</style>
    </div>
  );
}
