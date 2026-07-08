/**
 * Auto-Post auth bridge (autopost-unification, Phase 1).
 *
 * Mints a local Auto-Post Tool JWT from the user's EXISTING izzi/Supabase session
 * (already unified with izziapi.com), so the Starizzi agent and the Social Auto
 * Poster extension use Auto-Post with NO separate login — the "1-click → works"
 * requirement.
 *
 * Flow (contract verified against the Auto-Post Tool auth.service):
 *   AuthManager.getAccessToken() (Supabase token) + getCurrentUser() (email, name)
 *     → POST {backend}/auth/supabase-sync { email, name, supabaseToken }
 *     → { accessToken }  (a local JWT whose payload carries `workspaceId`, which the
 *        Auto-Post MCP server + REST require)
 *
 * The JWT is cached in memory only — it is always re-mintable from the live
 * session, so there is nothing sensitive to persist. Security-baseline B: token is
 * referenced by value only in the Authorization header, never logged; fail-closed
 * (returns null) when the user is not signed in or the backend is unreachable.
 *
 * @module main/autopost/autopost-auth
 */
import type { AuthManager } from '../auth/auth-manager';

/** Default local Auto-Post Tool API; override via env for a hosted (izziapi.com) backend. */
export const DEFAULT_AUTOPOST_BACKEND = (process.env.AUTOPOST_BACKEND_URL || 'http://127.0.0.1:3001').trim();

/** Refresh a little before actual expiry so an in-flight request never uses a dead token. */
const REFRESH_MARGIN_MS = 60_000;

/** Decode a JWT's `exp` (seconds) → milliseconds, or 0 when absent/unparseable. Pure. */
export function jwtExpiryMs(jwt: string): number {
  const parts = jwt.split('.');
  if (parts.length < 2) return 0;
  try {
    const payload = JSON.parse(Buffer.from(parts[1], 'base64').toString('utf8')) as { exp?: unknown };
    return typeof payload.exp === 'number' ? payload.exp * 1000 : 0;
  } catch {
    return 0;
  }
}

interface AutopostSyncResponse {
  accessToken?: string;
  user?: { id?: string; email?: string; name?: string };
  defaultWorkspace?: { id?: string; name?: string; role?: string } | null;
}

/**
 * Mints + caches the Auto-Post JWT. Injected with the desktop AuthManager (the
 * source of the izzi/Supabase session) and the Auto-Post backend base URL.
 */
export class AutopostAuth {
  private token: string | null = null;
  private tokenExpMs = 0;

  constructor(
    private readonly auth: AuthManager,
    private readonly backendUrl: string = DEFAULT_AUTOPOST_BACKEND,
  ) {}

  /** Normalized backend base (no trailing slash). */
  get baseUrl(): string {
    return this.backendUrl.replace(/\/+$/, '');
  }

  /**
   * Return a valid Auto-Post JWT, minting it from the current izzi/Supabase
   * session when missing/expired. Returns null (fail-closed, never throws) when
   * the user is not signed in or the backend is unreachable.
   */
  async getJwt(force = false): Promise<string | null> {
    if (!force && this.token && this.tokenExpMs - REFRESH_MARGIN_MS > Date.now()) {
      return this.token;
    }
    const supabaseToken = await this.auth.getAccessToken().catch(() => null);
    const user = this.auth.getCurrentUser();
    if (!supabaseToken || !user?.email) return null;
    try {
      const res = await fetch(`${this.baseUrl}/auth/supabase-sync`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: user.email, name: user.name || user.email, supabaseToken }),
      });
      if (!res.ok) return null;
      const data = (await res.json()) as AutopostSyncResponse;
      const token = typeof data.accessToken === 'string' && data.accessToken ? data.accessToken : null;
      if (!token) return null;
      this.token = token;
      this.tokenExpMs = jwtExpiryMs(token) || Date.now() + 30 * 60 * 1000;
      return token;
    } catch {
      return null;
    }
  }

  /** Drop the cached token (on sign-out or after a 401). */
  clear(): void {
    this.token = null;
    this.tokenExpMs = 0;
  }
}
