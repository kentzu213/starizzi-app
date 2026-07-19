/**
 * AuthManager — Supabase Auth Integration
 * Tích hợp cùng hệ thống auth với izziapi.com
 * - Supabase signInWithPassword / signInWithOAuth
 * - Bearer JWT → izzi-backend /api/auth/me
 * - Token storage via electron safeStorage
 */

import { createClient, SupabaseClient, Session } from '@supabase/supabase-js';
import { safeStorage, shell, BrowserWindow } from 'electron';
import { DatabaseManager } from '../db/database';
import { scryptSync, randomBytes, timingSafeEqual } from 'crypto';
import { IZZI_API_BASE, IZZI_WEB_BASE, SUPABASE_URL, SUPABASE_ANON_KEY } from '../config/public-config';

// Demo password hashing helpers (Node.js built-in crypto — zero new deps)
function hashPassword(password: string): string {
  const salt = randomBytes(16).toString('hex');
  const derived = scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${derived}`;
}

function verifyPassword(password: string, stored: string): boolean {
  // Support legacy plaintext passwords (pre-hash migration)
  if (!stored.includes(':') || stored.length < 145) {
    return password === stored;
  }
  const [salt, key] = stored.split(':');
  const derived = scryptSync(password, salt, 64);
  return timingSafeEqual(Buffer.from(key, 'hex'), derived);
}

export interface User {
  id: string;
  email: string;
  name: string;
  avatar?: string;
  apiKey?: string;
  plan?: string;
  balance?: number;
  role?: string;
  activeKeys?: number;
  createdAt?: string;
}

interface StoredSession {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  user: User;
}

interface DemoRegisteredUser {
  id: string;
  email: string;
  password: string;
  name: string;
  createdAt: string;
}

export class AuthManager {
  private session: StoredSession | null = null;
  private supabase: SupabaseClient | null = null;
  private db: DatabaseManager;
  /** Minted izzi- key for this desktop (bound to a user id), cached in memory. Never logged. */
  private desktopKeyCache: { userId: string; key: string } | null = null;

  constructor(db: DatabaseManager) {
    this.db = db;
    this.initSupabase();
    this.loadSession();
  }

  private initSupabase() {
    if (SUPABASE_URL && SUPABASE_ANON_KEY) {
      this.supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
        auth: {
          autoRefreshToken: true,
          persistSession: false, // We handle persistence ourselves via safeStorage
          flowType: 'implicit', // Electron popup reads access/refresh tokens from the redirect hash.
        },
      });
      console.log('[Auth] Supabase client initialized');
    } else {
      console.warn('[Auth] Supabase credentials not configured — running in demo mode');
    }
  }

  private loadSession() {
    try {
      const stored = this.db.getSetting('auth_session');
      if (stored) {
        const decrypted = safeStorage.isEncryptionAvailable()
          ? safeStorage.decryptString(Buffer.from(stored, 'base64'))
          : stored;
        this.session = JSON.parse(decrypted);

        // If Supabase is now configured but session is a demo token,
        // clear it to force real authentication
        if (this.supabase && this.session?.accessToken?.startsWith('demo-token-')) {
          console.log('[Auth] Clearing stale demo session — Supabase is now configured, requiring real login');
          this.clearSession();
          return;
        }

        // Check if session is expired
        if (this.session && this.session.expiresAt < Date.now()) {
          console.log('[Auth] Stored session expired, will refresh');
          this.refreshAccessToken();
        }
      }
    } catch (err) {
      console.error('[Auth] Failed to load session:', err);
      this.session = null;
    }
  }

  private saveSession(session: StoredSession) {
    this.session = session;
    try {
      const serialized = JSON.stringify(session);
      const encrypted = safeStorage.isEncryptionAvailable()
        ? safeStorage.encryptString(serialized).toString('base64')
        : serialized;
      this.db.setSetting('auth_session', encrypted);
    } catch (err) {
      console.error('[Auth] Failed to save session:', err);
    }
  }

  private clearSession() {
    this.session = null;
    this.desktopKeyCache = null;
    this.db.deleteSetting('auth_session');
    this.db.deleteSetting('izzi_desktop_key');
  }

  private getDemoUsers(): DemoRegisteredUser[] {
    try {
      const raw = this.db.getSetting('demo_users');
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  private saveDemoUsers(users: DemoRegisteredUser[]) {
    this.db.setSetting('demo_users', JSON.stringify(users));
  }

  /**
   * Fetch user profile from izzi-backend /api/auth/me
   * Same as izzi-web-v2/src/context/AuthContext.tsx fetchProfile()
   */
  private async fetchProfile(accessToken: string): Promise<User | null> {
    try {
      const res = await fetch(`${IZZI_API_BASE}/api/auth/me`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      if (!res.ok) return null;
      const data = await res.json() as any;
      return {
        id: data.id,
        email: data.email,
        name: data.name || data.email?.split('@')[0] || '',
        avatar: (data.name || data.email || 'U')[0].toUpperCase(),
        plan: data.plan ?? 'free',
        balance: data.balance ?? 0,
        role: data.role ?? 'user',
        activeKeys: data.activeKeys ?? 0,
        createdAt: data.createdAt || new Date().toISOString(),
      };
    } catch (err) {
      console.error('[Auth] Failed to fetch profile:', err);
      return null;
    }
  }

  /**
   * Login with email + password via Supabase Auth
   * Same flow as izzi-web-v2/src/context/AuthContext.tsx login()
   */
  async login(email: string, password: string): Promise<{ success: boolean; user?: User; error?: string }> {
    // Demo mode fallback — still requires prior signup
    if (!this.supabase) {
      const registered = this.getDemoUsers().find(
        (user) => user.email.toLowerCase() === email.toLowerCase(),
      );

      if (!registered) {
        return { success: false, error: 'Tài khoản chưa tồn tại. Vui lòng đăng ký trước để sử dụng desktop app.' };
      }

      if (!verifyPassword(password, registered.password)) {
        return { success: false, error: 'Sai mật khẩu.' };
      }

      const demoUser: User = {
        id: registered.id,
        email: registered.email,
        name: registered.name,
        avatar: registered.name[0]?.toUpperCase() || registered.email[0]?.toUpperCase() || 'U',
        plan: 'trial',
        balance: 0,
        role: 'user',
        activeKeys: 0,
        createdAt: registered.createdAt,
      };
      this.saveSession({
        accessToken: `demo-token-${registered.id}`,
        refreshToken: `demo-refresh-${registered.id}`,
        expiresAt: Date.now() + 24 * 60 * 60 * 1000,
        user: demoUser,
      });
      this.db.appendDiagnosticEvent({ type: 'auth.login', status: 'success', detail: `Demo login: ${email}` });
      console.log('[Auth] Demo login:', email);
      return { success: true, user: demoUser };
    }

    try {
      const { data, error } = await this.supabase.auth.signInWithPassword({ email, password });

      if (error) {
        console.error('[Auth] Supabase login error:', error.message);
        this.db.appendDiagnosticEvent({ type: 'auth.login', status: 'error', detail: error.message, meta: { email } });

        // Translate common Supabase errors to helpful Vietnamese messages
        let userMessage = error.message;
        if (error.message === 'Invalid login credentials') {
          userMessage = 'Email hoặc mật khẩu không đúng. Nếu chưa có tài khoản, vui lòng bấm "Đăng ký miễn phí" hoặc "Đăng nhập với Google".';
        } else if (error.message.includes('Email not confirmed')) {
          userMessage = 'Email chưa được xác nhận. Vui lòng kiểm tra hộp thư để xác nhận tài khoản.';
        } else if (error.message.includes('Too many requests')) {
          userMessage = 'Quá nhiều lần thử. Vui lòng đợi vài phút rồi thử lại.';
        }

        return { success: false, error: userMessage };
      }

      if (!data.session) {
        return { success: false, error: 'No session returned' };
      }

      // Fetch full profile from izzi-backend
      const profile = await this.fetchProfile(data.session.access_token);
      const user: User = profile || {
        id: data.user.id,
        email: data.user.email || email,
        name: data.user.user_metadata?.name || email.split('@')[0],
        plan: 'free',
      };

      this.saveSession({
        accessToken: data.session.access_token,
        refreshToken: data.session.refresh_token,
        expiresAt: (data.session.expires_at || 0) * 1000,
        user,
      });

      this.db.appendDiagnosticEvent({ type: 'auth.login', status: 'success', detail: `Supabase login: ${user.email}` });
      console.log('[Auth] Login successful:', user.email);
      return { success: true, user };
    } catch (err: any) {
      const message = err.message || 'Login failed';
      console.error('[Auth] Login error:', message);
      this.db.appendDiagnosticEvent({ type: 'auth.login', status: 'error', detail: message, meta: { email } });
      return { success: false, error: message };
    }
  }

  /**
   * Login with Google OAuth via Supabase
   * Opens system browser for OAuth flow
   */
  async loginWithGoogle(): Promise<{ success: boolean; user?: User; error?: string }> {
    if (!this.supabase) {
      return { success: false, error: 'Supabase not configured' };
    }

    try {
      // Use the web app as the final redirect target. Supabase's callback
      // endpoint is an internal hop; pointing redirectTo back at it can produce
      // a PKCE code without the verifier stored in this Electron process.
      const redirectUrl = `${IZZI_WEB_BASE}/auth/callback`;

      const { data, error } = await this.supabase.auth.signInWithOAuth({
        provider: 'google',
        options: {
          redirectTo: redirectUrl,
          skipBrowserRedirect: true,
        },
      });

      if (error) {
        return { success: false, error: error.message };
      }

      if (!data.url) {
        return { success: false, error: 'No OAuth URL returned' };
      }

      // Open OAuth in a BrowserWindow popup (much more reliable than custom protocol)
      return await this.openOAuthPopup(data.url);
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  }

  /**
   * Open OAuth flow in a BrowserWindow and intercept the callback
   * This is the standard Electron approach — much more reliable than custom:// protocols
   */
  private openOAuthPopup(authUrl: string): Promise<{ success: boolean; user?: User; error?: string }> {
    return new Promise((resolve) => {
      const popup = new BrowserWindow({
        width: 500,
        height: 700,
        show: true,
        autoHideMenuBar: true,
        title: 'Đăng nhập với Google',
        webPreferences: {
          nodeIntegration: false,
          contextIsolation: true,
        },
      });

      let resolved = false;
      const finish = (result: { success: boolean; user?: User; error?: string }) => {
        if (resolved) return;
        resolved = true;
        try { popup.close(); } catch { /* already closed */ }
        resolve(result);
      };

      // Intercept navigation to detect the callback URL with tokens
      popup.webContents.on('will-redirect', async (_event, url) => {
        await this.tryExtractOAuthTokens(url, finish);
      });

      popup.webContents.on('will-navigate', async (_event, url) => {
        await this.tryExtractOAuthTokens(url, finish);
      });

      // Also handle page title changes (some OAuth flows land on a page with tokens in the URL)
      popup.webContents.on('did-navigate', async (_event, url) => {
        await this.tryExtractOAuthTokens(url, finish);
      });

      popup.on('closed', () => {
        finish({ success: false, error: 'Cửa sổ đăng nhập đã bị đóng' });
      });

      popup.loadURL(authUrl);
    });
  }

  /**
   * Try to extract OAuth tokens from a URL (hash fragment or query params)
   */
  private async tryExtractOAuthTokens(
    url: string,
    finish: (result: { success: boolean; user?: User; error?: string }) => void,
  ) {
    try {
      const parsed = new URL(url);

      // Supabase puts tokens in the hash fragment: #access_token=...&refresh_token=...
      let accessToken: string | null = null;
      let refreshToken: string | null = null;

      // Check hash fragment first (most common for Supabase OAuth)
      if (parsed.hash && parsed.hash.length > 1) {
        const hashParams = new URLSearchParams(parsed.hash.substring(1));
        accessToken = hashParams.get('access_token');
        refreshToken = hashParams.get('refresh_token');
      }

      // Fallback: check query params
      if (!accessToken) {
        accessToken = parsed.searchParams.get('access_token');
        refreshToken = parsed.searchParams.get('refresh_token');
      }

      if (accessToken && refreshToken) {
        console.log('[Auth] Got OAuth tokens from URL');
        const result = await this.setSessionFromTokens(accessToken, refreshToken);
        finish(result);
      }
      // If no tokens were found, let navigation continue (user is still in OAuth flow).
      // Do NOT call exchangeCodeForSession here: this popup flow intentionally uses
      // implicit tokens, and exchanging a stray PKCE code without a verifier produces
      // "both auth code and code verifier should be non-empty".
    } catch {
      // URL parse errors are expected for non-callback URLs — ignore them
    }
  }

  /**
   * Set session from access_token + refresh_token (from OAuth hash fragment)
   */
  private async setSessionFromTokens(accessToken: string, refreshToken: string): Promise<{ success: boolean; user?: User; error?: string }> {
    if (!this.supabase) return { success: false, error: 'Supabase not configured' };

    try {
      const { data, error } = await this.supabase.auth.setSession({
        access_token: accessToken,
        refresh_token: refreshToken,
      });

      if (error || !data.session) {
        return { success: false, error: error?.message || 'Failed to set session' };
      }

      const profile = await this.fetchProfile(data.session.access_token);
      const user: User = profile || {
        id: data.user?.id || '',
        email: data.user?.email || '',
        name: data.user?.user_metadata?.full_name || data.user?.user_metadata?.name || data.user?.email?.split('@')[0] || '',
        plan: 'free',
      };

      this.saveSession({
        accessToken: data.session.access_token,
        refreshToken: data.session.refresh_token,
        expiresAt: (data.session.expires_at || 0) * 1000,
        user,
      });

      this.db.appendDiagnosticEvent({ type: 'auth.login', status: 'success', detail: `Google OAuth: ${user.email}` });
      console.log('[Auth] Google OAuth login successful:', user.email);
      return { success: true, user };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  }

  /**
   * Handle OAuth callback (legacy — kept for custom protocol handler compatibility)
   */
  async handleOAuthCallback(url: string): Promise<{ success: boolean; user?: User; error?: string }> {
    if (!this.supabase) {
      return { success: false, error: 'Supabase not configured' };
    }

    try {
      const parsed = new URL(url);

      // Check hash fragment first
      let accessToken: string | null = null;
      let refreshToken: string | null = null;

      if (parsed.hash && parsed.hash.length > 1) {
        const hashParams = new URLSearchParams(parsed.hash.substring(1));
        accessToken = hashParams.get('access_token');
        refreshToken = hashParams.get('refresh_token');
      }

      // Fallback: query params
      if (!accessToken) {
        accessToken = parsed.searchParams.get('access_token');
        refreshToken = parsed.searchParams.get('refresh_token');
      }

      if (accessToken && refreshToken) {
        return await this.setSessionFromTokens(accessToken, refreshToken);
      }

      return { success: false, error: 'No OAuth tokens in callback URL' };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  }

  /**
   * Signup new user via Supabase Auth
   * After successful signup, auto-login the user
   */
  async signup(email: string, password: string, name: string): Promise<{ success: boolean; needsConfirmation?: boolean; error?: string }> {
    if (!this.supabase) {
      const users = this.getDemoUsers();
      const exists = users.some((user) => user.email.toLowerCase() === email.toLowerCase());

      if (exists) {
        return { success: false, error: 'Email đã được đăng ký trong bản chạy thử.' };
      }

      users.push({
        id: `demo-${Date.now()}`,
        email,
        password: hashPassword(password),
        name,
        createdAt: new Date().toISOString(),
      });
      this.saveDemoUsers(users);
      this.db.appendDiagnosticEvent({ type: 'auth.signup', status: 'success', detail: `Demo signup: ${email}` });
      return { success: true };
    }

    try {
      const { data, error } = await this.supabase.auth.signUp({
        email,
        password,
        options: { data: { name, full_name: name } },
      });

      if (error) {
        this.db.appendDiagnosticEvent({ type: 'auth.signup', status: 'error', detail: error.message, meta: { email } });

        // Translate common errors
        let msg = error.message;
        if (error.message.includes('already registered') || error.message.includes('already been registered')) {
          msg = 'Email đã được đăng ký. Vui lòng dùng "Đăng nhập" hoặc "Đăng nhập với Google".';
        } else if (error.message.includes('password')) {
          msg = 'Mật khẩu phải có ít nhất 6 ký tự.';
        }

        return { success: false, error: msg };
      }

      this.db.appendDiagnosticEvent({ type: 'auth.signup', status: 'success', detail: `Supabase signup: ${email}` });

      // If Supabase returned a session (email confirmation disabled), auto-login
      if (data.session) {
        const profile = await this.fetchProfile(data.session.access_token);
        const user: User = profile || {
          id: data.user?.id || '',
          email: data.user?.email || email,
          name: data.user?.user_metadata?.name || name,
          plan: 'free',
        };

        this.saveSession({
          accessToken: data.session.access_token,
          refreshToken: data.session.refresh_token,
          expiresAt: (data.session.expires_at || 0) * 1000,
          user,
        });

        console.log('[Auth] Signup + auto-login successful:', email);
        return { success: true };
      }

      // If no session, user needs to confirm email first
      console.log('[Auth] Signup successful, awaiting email confirmation:', email);
      return { success: true, needsConfirmation: true };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  }

  async logout(): Promise<void> {
    try {
      if (this.supabase) {
        await this.supabase.auth.signOut();
      }
    } catch {
      // Ignore logout API errors
    }
    this.clearSession();
    this.db.appendDiagnosticEvent({ type: 'auth.logout', status: 'info', detail: 'User logged out' });
    console.log('[Auth] Logged out');
  }

  async refreshAccessToken(): Promise<boolean> {
    if (!this.session?.refreshToken || !this.supabase) return false;

    try {
      const { data, error } = await this.supabase.auth.refreshSession({
        refresh_token: this.session.refreshToken,
      });

      if (error || !data.session) {
        console.error('[Auth] Token refresh failed:', error?.message);
        this.clearSession();
        return false;
      }

      // Refresh profile data
      const profile = await this.fetchProfile(data.session.access_token);
      const user = profile || this.session.user;

      this.saveSession({
        accessToken: data.session.access_token,
        refreshToken: data.session.refresh_token,
        expiresAt: (data.session.expires_at || 0) * 1000,
        user,
      });

      return true;
    } catch {
      console.error('[Auth] Token refresh error');
      return false;
    }
  }

  async getAccessToken(): Promise<string | null> {
    if (!this.session) return null;

    // Refresh 5 minutes before expiry
    if (this.session.expiresAt - Date.now() < 5 * 60 * 1000) {
      const refreshed = await this.refreshAccessToken();
      if (!refreshed) return null;
    }

    return this.session.accessToken;
  }

  isAuthenticated(): boolean {
    return this.session !== null;
  }

  getCurrentUser(): User | null {
    return this.session?.user || null;
  }

  getApiKey(): string | null {
    return this.session?.user?.apiKey || null;
  }

  /**
   * Ensure a durable izzi- API key exists for this desktop install and return it.
   *
   * Why: the dashboard profile (/api/auth/me) does not expose a usable key, and
   * izzi's /v1 endpoint reliably accepts izzi- keys (server-side api_keys lookup)
   * but not the raw Supabase JWT. So on first need we mint a dedicated key via
   * POST /api/keys (authenticated with the user's JWT — a dashboard route that
   * DOES accept the JWT), persist it encrypted and bound to the user id (so an
   * account switch re-mints), and reuse it thereafter. The key is a secret: it is
   * never logged and never crosses the IPC bridge. Returns null when not
   * authenticated or minting fails (the caller then falls back to the JWT).
   */
  async ensureDesktopApiKey(): Promise<string | null> {
    const userId = this.session?.user?.id;
    if (!userId) return null;

    // 1. In-memory cache (only valid for the signed-in user).
    if (this.desktopKeyCache?.userId === userId) return this.desktopKeyCache.key;

    // 2. Persisted key — reuse only if it belongs to the signed-in user.
    const stored = this.loadDesktopKey();
    if (stored && stored.userId === userId && stored.key) {
      this.desktopKeyCache = stored;
      return stored.key;
    }

    // 3. Mint a new key via the dashboard API (JWT-authenticated).
    const token = await this.getAccessToken();
    if (!token) return null;
    try {
      const res = await fetch(`${IZZI_API_BASE}/api/keys`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Izzi OpenClaw Desktop' }),
      });
      if (!res.ok) return null;
      const data = (await res.json()) as { key?: unknown };
      const rawKey = typeof data.key === 'string' ? data.key.trim() : '';
      if (!rawKey.startsWith('izzi-')) return null;
      this.saveDesktopKey({ userId, key: rawKey });
      this.desktopKeyCache = { userId, key: rawKey };
      return rawKey;
    } catch (err) {
      console.error('[Auth] Failed to mint desktop API key:', err instanceof Error ? err.message : 'unknown');
      return null;
    }
  }

  /** Load the persisted desktop key ({ userId, key }), decrypted. */
  private loadDesktopKey(): { userId: string; key: string } | null {
    try {
      const stored = this.db.getSetting('izzi_desktop_key');
      if (!stored) return null;
      const decrypted = safeStorage.isEncryptionAvailable()
        ? safeStorage.decryptString(Buffer.from(stored, 'base64'))
        : stored;
      const parsed = JSON.parse(decrypted);
      if (parsed && typeof parsed.userId === 'string' && typeof parsed.key === 'string') {
        return { userId: parsed.userId, key: parsed.key };
      }
    } catch {
      // treat as absent — a new key will be minted
    }
    return null;
  }

  /** Persist the desktop key encrypted (safeStorage), like the session. */
  private saveDesktopKey(data: { userId: string; key: string }): void {
    try {
      const serialized = JSON.stringify(data);
      const encrypted = safeStorage.isEncryptionAvailable()
        ? safeStorage.encryptString(serialized).toString('base64')
        : serialized;
      this.db.setSetting('izzi_desktop_key', encrypted);
    } catch (err) {
      console.error('[Auth] Failed to save desktop key:', err instanceof Error ? err.message : 'unknown');
    }
  }

  /**
   * Refresh user profile from backend (e.g., after balance change)
   */
  async refreshProfile(): Promise<User | null> {
    const token = await this.getAccessToken();
    if (!token) return null;

    const profile = await this.fetchProfile(token);
    if (profile && this.session) {
      this.session.user = profile;
      this.saveSession(this.session);
    }
    return profile;
  }
}
