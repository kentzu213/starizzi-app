import { app } from 'electron';
import * as path from 'path';
import * as fs from 'fs';
import { DatabaseManager } from '../db/database';

// Marketplace API URL (local dev)
const MARKETPLACE_API = process.env.OPENCLAW_MARKETPLACE_URL || 'http://localhost:8788';

export interface ExtensionManifest {
  name: string;
  version: string;
  displayName: string;
  description?: string;
  author?: { name: string; email?: string };
  engine?: string;
  permissions?: string[];
  activationEvents?: string[];
  contributes?: {
    commands?: { id: string; title: string }[];
    panels?: { id: string; title: string; entry: string }[];
  };
  pricing?: {
    model: 'free' | 'paid' | 'freemium';
    price?: { monthly?: number; yearly?: number; currency?: string };
  };
}

export interface InstalledExtension {
  id: string;
  name: string;
  displayName: string;
  version: string;
  description?: string;
  author?: string;
  iconPath?: string;
  installPath: string;
  isEnabled: boolean;
  licenseKey?: string;
  installedAt: string;
}

// Fallback marketplace data (when API is unreachable)
const FALLBACK_EXTENSIONS = [
  {
    id: 'ext-seo-scanner',
    name: 'smart-seo-scanner',
    display_name: 'Smart SEO Scanner',
    description: 'Quét và phân tích SEO tự động cho website.',
    version: '1.2.0',
    category: 'SEO',
    rating_avg: 4.8,
    install_count: 12500,
    pricing_model: 'free',
    manifest: { icon: '🔍' },
  },
  {
    id: 'ext-social-auto-poster',
    name: 'social-auto-poster',
    display_name: 'Social Auto Poster',
    description: 'Lên lịch & tự động đăng bài Facebook / YouTube / TikTok qua Auto-Post Tool. Mở tiện ích là tự khởi động backend cục bộ (localhost) — dùng chung tài khoản izzi.',
    version: '0.3.0',
    category: 'Marketing',
    rating_avg: 4.5,
    install_count: 8900,
    pricing_model: 'freemium',
    price_monthly: 9.99,
    manifest: { icon: '📱' },
  },
  {
    id: 'ext-ai-content',
    name: 'ai-content-writer',
    display_name: 'AI Content Writer',
    description: 'Viết nội dung marketing, blog, email bằng AI.',
    version: '3.1.0',
    category: 'Content',
    rating_avg: 4.9,
    install_count: 25000,
    pricing_model: 'free',
    price_monthly: 19.99,
    manifest: { icon: '✨' },
  },
  {
    id: 'ext-analytics',
    name: 'deep-analytics',
    display_name: 'Deep Analytics Dashboard',
    description: 'Dashboard phân tích traffic, conversion, user behavior.',
    version: '1.5.0',
    category: 'Analytics',
    rating_avg: 4.7,
    install_count: 15200,
    pricing_model: 'free',
    manifest: { icon: '📊' },
  },
  {
    id: 'ext-email-campaign',
    name: 'email-campaign-pro',
    display_name: 'Email Campaign Pro',
    description: 'Tạo và gửi email marketing chuyên nghiệp.',
    version: '2.3.0',
    category: 'Email',
    rating_avg: 4.6,
    install_count: 6700,
    pricing_model: 'free',
    price_monthly: 14.99,
    manifest: { icon: '📧' },
  },
  {
    id: 'ext-chatbot',
    name: 'smart-chatbot',
    display_name: 'Smart Chatbot Builder',
    description: 'Xây dựng chatbot AI cho website và Messenger.',
    version: '1.0.0',
    category: 'Customer Support',
    rating_avg: 4.4,
    install_count: 3200,
    pricing_model: 'free',
    price_monthly: 24.99,
    manifest: { icon: '🤖' },
  },
  // ── Tool thật của izzi (từ F:\Ai Tools) ──
  {
    id: 'ext-chat-quality',
    name: 'chat-quality-agent',
    display_name: 'Chat Quality Agent (CSKH)',
    description: 'Đồng bộ Zalo OA & Facebook Messenger, chấm điểm chất lượng CSKH bằng AI, phân loại chat, cảnh báo Telegram/Email.',
    version: '1.0.0',
    category: 'Customer Support',
    rating_avg: 4.6,
    install_count: 2100,
    pricing_model: 'freemium',
    price_monthly: 12.99,
    manifest: { icon: '📞' },
  },
  {
    id: 'ext-toonflow',
    name: 'toonflow-studio',
    display_name: 'Toonflow Studio',
    description: 'Tiểu thuyết → kịch bản → phân cảnh → video ngắn (short drama) trên canvas, đa AI provider.',
    version: '1.0.0',
    category: 'Video',
    rating_avg: 4.7,
    install_count: 3400,
    pricing_model: 'paid',
    price_monthly: 24.99,
    manifest: { icon: '🎬' },
  },
  {
    id: 'ext-omnivoice',
    name: 'omnivoice-tts',
    display_name: 'OmniVoice TTS',
    description: 'Text-to-speech + voice cloning đa ngôn ngữ, chạy cục bộ. Tạo sách nói / lồng tiếng.',
    version: '1.0.0',
    category: 'Voice',
    rating_avg: 4.5,
    install_count: 1800,
    pricing_model: 'free',
    manifest: { icon: '🎙️' },
  },
  {
    id: 'ext-html-video',
    name: 'html-to-video',
    display_name: 'HTML to Video',
    description: 'Render HTML/template thành video bằng Playwright — lớp HTML→Video cho coding agent.',
    version: '0.1.0',
    category: 'Video',
    rating_avg: 4.3,
    install_count: 900,
    pricing_model: 'free',
    manifest: { icon: '🎞️' },
  },
  {
    id: 'ext-meta-ads-ai',
    name: 'meta-ads-autopilot',
    display_name: 'Meta Ads Autopilot',
    description: 'Tự động hoá Meta Ads chuyên sâu: AI bidding, rule automation, A/B creative — chuẩn Revealbot/Madgicx. Thay cho script FB Ads cơ bản.',
    version: '1.0.0',
    category: 'Marketing',
    rating_avg: 4.6,
    install_count: 3900,
    pricing_model: 'paid',
    price_monthly: 29.99,
    manifest: { icon: '🎯' },
  },
  // ── Tool desktop đã cài trên máy ──
  {
    id: 'ext-ai-video-studio',
    name: 'ai-video-studio',
    display_name: 'AI Video Studio',
    description: 'Tạo video AI (text/image→video) qua Veo/Grok/SORA. Nên dùng nguồn hợp lệ (open-weight / API chính thức).',
    version: '0.1.0',
    category: 'Video',
    rating_avg: 4.2,
    install_count: 1500,
    pricing_model: 'paid',
    price_monthly: 29.99,
    manifest: { icon: '📹' },
  },
  {
    id: 'ext-facefusion',
    name: 'facefusion',
    display_name: 'FaceFusion',
    description: 'Hoán đổi/chỉnh khuôn mặt trên ảnh & video (face swap), chạy cục bộ, cần GPU. Dùng có trách nhiệm — cần sự đồng ý.',
    version: '3.0.0',
    category: 'Video',
    rating_avg: 4.3,
    install_count: 4200,
    pricing_model: 'free',
    manifest: { icon: '🎭' },
  },
  {
    id: 'ext-quickmagic',
    name: 'quick-magic',
    display_name: 'Quick Magic',
    description: 'Tải & chuyển đổi video từ URL (yt-dlp + ffmpeg), gói gọn trong app desktop.',
    version: '1.0.0',
    category: 'Video',
    rating_avg: 4.4,
    install_count: 5100,
    pricing_model: 'free',
    manifest: { icon: '⬇️' },
  },
  // ── Tối ưu nhất 2026 (quốc tế + Việt Nam) — bổ sung bên cạnh tool sẵn có ──
  {
    id: 'ext-chatterbox',
    name: 'chatterbox-voice',
    display_name: 'Chatterbox Voice (v3)',
    description: 'Voice cloning + TTS đa ngôn ngữ chất lượng cao (Resemble AI) — ưa hơn ElevenLabs trong test A/B mù. Chạy cục bộ. Nâng cấp cho OmniVoice.',
    version: '3.0.0',
    category: 'Voice',
    rating_avg: 4.8,
    install_count: 6400,
    pricing_model: 'free',
    manifest: { icon: '🔊' },
  },
  {
    id: 'ext-vieneu-tts',
    name: 'vieneu-tts',
    display_name: 'VieNeu-TTS (Việt)',
    description: 'TTS tiếng Việt on-device 48kHz, clone giọng tức thì, song ngữ Anh–Việt, chạy cả CPU (ONNX). Tối ưu cho nội dung Việt.',
    version: '3.0.0',
    category: 'Voice',
    rating_avg: 4.7,
    install_count: 3100,
    pricing_model: 'free',
    manifest: { icon: '🇻🇳' },
  },
  {
    id: 'ext-ltx2',
    name: 'ltx2-video',
    display_name: 'LTX-2 Video',
    description: 'Sinh video AI open-weight (miễn phí, chạy qua ComfyUI) — text/image→video. Nguồn hợp pháp thay tự động hoá API nội bộ, không rủi ro ToS.',
    version: '2.0.0',
    category: 'Video',
    rating_avg: 4.6,
    install_count: 5200,
    pricing_model: 'free',
    manifest: { icon: '🎥' },
  },
  {
    id: 'ext-mcai',
    name: 'mcai-video',
    display_name: 'MCAI (Việt)',
    description: 'Tạo video AI tiếng Việt: ảnh nhân vật → video, giọng đọc, đồng bộ nhép miệng. Cho creator/shop/marketing Việt.',
    version: '1.0.0',
    category: 'Video',
    rating_avg: 4.5,
    install_count: 2800,
    pricing_model: 'freemium',
    price_monthly: 9.99,
    manifest: { icon: '📽️' },
  },
  {
    id: 'ext-postiz',
    name: 'postiz',
    display_name: 'Postiz',
    description: 'Lên lịch đăng 30+ nền tảng từ 1 dashboard (open-source, 29k★ GitHub) — self-host thay Buffer. Bổ sung cho Social Auto Poster.',
    version: '1.0.0',
    category: 'Marketing',
    rating_avg: 4.7,
    install_count: 7300,
    pricing_model: 'free',
    manifest: { icon: '🗓️' },
  },
];

export class ExtensionManager {
  private db: DatabaseManager;
  private extensionsDir: string;

  constructor(db: DatabaseManager) {
    this.db = db;
    this.extensionsDir = path.join(app.getPath('userData'), 'extensions');
    if (!fs.existsSync(this.extensionsDir)) {
      fs.mkdirSync(this.extensionsDir, { recursive: true });
    }
  }

  getInstalled(): InstalledExtension[] {
    const rows = this.db.getInstalledExtensions();
    return rows.map((row: any) => ({
      id: row.id,
      name: row.name,
      displayName: row.display_name,
      version: row.version,
      description: row.description,
      author: row.author,
      iconPath: row.icon_path,
      installPath: row.install_path,
      isEnabled: row.is_enabled === 1,
      licenseKey: row.license_key,
      installedAt: row.installed_at,
    }));
  }

  async install(extensionId: string): Promise<{ success: boolean; error?: string }> {
    try {
      // Try to get extension from API first
      let ext: any = null;
      try {
        const response = await fetch(`${MARKETPLACE_API}/api/extensions/${extensionId}`);
        if (response.ok) {
          const data = await response.json() as any;
          ext = data.extension;
        }
      } catch {
        // API unreachable, try fallback data
      }

      // Fallback to built-in data
      if (!ext) {
        ext = FALLBACK_EXTENSIONS.find(e => e.id === extensionId);
        if (!ext) {
          return { success: false, error: 'Extension not found' };
        }
      }

      const extName = ext.name || ext.display_name?.toLowerCase().replace(/\s+/g, '-');

      // Create extension directory
      const installPath = path.join(this.extensionsDir, extName);
      if (!fs.existsSync(installPath)) {
        fs.mkdirSync(installPath, { recursive: true });
      }

      // Write manifest
      const manifest: ExtensionManifest = {
        name: extName,
        version: ext.version,
        displayName: ext.display_name,
        description: ext.description,
        author: ext.profiles ? { name: ext.profiles.name } : { name: 'Unknown' },
      };
      fs.writeFileSync(path.join(installPath, 'manifest.json'), JSON.stringify(manifest, null, 2));

      // Register in database
      this.db.addExtension({
        id: ext.id || extensionId,
        name: extName,
        displayName: ext.display_name,
        version: ext.version,
        description: ext.description,
        author: ext.profiles?.name || 'Unknown',
        installPath,
      });

      // Track install on API (fire-and-forget)
      try {
        await fetch(`${MARKETPLACE_API}/api/extensions/${ext.id || extensionId}/install`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
        });
      } catch {
        // Ignore API errors for install tracking
      }

      this.db.appendDiagnosticEvent({ type: 'extension.install', status: 'success', detail: `${ext.display_name} v${ext.version}` });
      console.log(`[Extensions] Installed: ${ext.display_name} v${ext.version}`);
      return { success: true };
    } catch (err: any) {
      console.error('[Extensions] Install failed:', err.message);
      this.db.appendDiagnosticEvent({ type: 'extension.install', status: 'error', detail: err.message });
      return { success: false, error: err.message };
    }
  }

  async uninstall(extensionId: string): Promise<{ success: boolean; error?: string }> {
    try {
      const extensions = this.getInstalled();
      const ext = extensions.find(e => e.id === extensionId);
      if (!ext) {
        return { success: false, error: 'Extension not installed' };
      }

      // Remove files
      if (fs.existsSync(ext.installPath)) {
        fs.rmSync(ext.installPath, { recursive: true, force: true });
      }

      // Remove from database
      this.db.removeExtension(extensionId);

      console.log(`[Extensions] Uninstalled: ${ext.displayName}`);
      return { success: true };
    } catch (err: any) {
      console.error('[Extensions] Uninstall failed:', err.message);
      return { success: false, error: err.message };
    }
  }

  // ── Marketplace Cache (SQLite, TTL 5min) ──
  private marketplaceCache: { data: any[]; timestamp: number } | null = null;
  private readonly CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

  private isCacheValid(): boolean {
    return this.marketplaceCache !== null &&
      (Date.now() - this.marketplaceCache.timestamp) < this.CACHE_TTL_MS;
  }

  async searchMarketplace(query?: string): Promise<any[]> {
    // Return from cache if valid and no specific query
    if (!query && this.isCacheValid()) {
      console.log('[Extensions] Returning cached marketplace data');
      return this.marketplaceCache!.data;
    }

    // Try to fetch from real Marketplace API
    try {
      const params = new URLSearchParams();
      if (query) params.set('q', query);
      params.set('limit', '20');

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 5000); // 5s timeout

      const response = await fetch(`${MARKETPLACE_API}/api/extensions?${params.toString()}`, {
        signal: controller.signal,
      });
      clearTimeout(timeout);

      if (response.ok) {
        const data = await response.json() as any;
        if (data.extensions && data.extensions.length > 0) {
          console.log(`[Extensions] Fetched ${data.extensions.length} from Marketplace API`);
          const mapped = data.extensions.map((e: any) => ({
            id: e.id,
            name: e.name,
            displayName: e.display_name,
            description: e.description,
            author: e.profiles?.name || 'OpenClaw',
            version: e.version,
            category: e.category,
            rating: e.rating_avg,
            installs: e.install_count,
            icon: e.manifest?.icon || '📦',
            free: true,
          }));

          // Cache full listing (no query)
          if (!query) {
            this.marketplaceCache = { data: mapped, timestamp: Date.now() };
          }

          return mapped;
        }
      }
    } catch (err) {
      console.warn('[Extensions] Marketplace API unreachable, using fallback data');
    }

    // Fallback to built-in data
    let results = FALLBACK_EXTENSIONS;
    if (query) {
      const q = query.toLowerCase();
      results = results.filter(
        e =>
          e.display_name.toLowerCase().includes(q) ||
          e.description.toLowerCase().includes(q) ||
          e.category.toLowerCase().includes(q)
      );
    }

    const mapped = results.map(e => ({
      id: e.id,
      name: e.name,
      displayName: e.display_name,
      description: e.description,
      author: 'OpenClaw',
      version: e.version,
      category: e.category,
      rating: e.rating_avg,
      installs: e.install_count,
      icon: e.manifest?.icon || '📦',
      free: true,
    }));

    // Cache fallback too
    if (!query) {
      this.marketplaceCache = { data: mapped, timestamp: Date.now() };
    }

    return mapped;
  }

  /** Force refresh marketplace cache */
  clearMarketplaceCache(): void {
    this.marketplaceCache = null;
    console.log('[Extensions] Marketplace cache cleared');
  }
}

