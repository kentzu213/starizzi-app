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
    description: 'Lên lịch & tự động đăng bài Facebook / YouTube / TikTok qua Auto-Post Tool (backend izzi thống nhất). Cài xong agent gọi trực tiếp — dùng chung tài khoản izzi.',
    version: '0.2.0',
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

