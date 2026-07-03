/**
 * AffiliateClient — HTTP layer for the desktop Affiliate surface. Lives in the
 * Electron MAIN process; the JWT never leaves main (same contract as GraphClient).
 *
 * Mirrors the izziapi.com web dashboard (`/dashboard/affiliate`), hitting the
 * shared backend `/api/affiliate/*` at IZZI_API_BASE. This is a MONEY flow
 * (commissions + withdrawals), so every call is fail-closed:
 *   - no token            → safe empty result, no backend call
 *   - 401 / non-OK / throw → safe empty result, never throws to the renderer
 *   - diagnostics log ONLY the op type + HTTP status, never the token or amounts
 */

import type { AuthManager } from '../auth/auth-manager';
import { IZZI_API_BASE, IZZI_WEB_BASE } from '../config/public-config';

// ── Public DTOs (mirrored from the web dashboard) ──────────────────────────

export interface AffiliateStats {
  code: string;
  referralLink: string;
  totalReferrals: number;
  pendingVnd: number;
  availableVnd: number;
  paidVnd: number;
  totalEarningsVnd: number;
}

export interface AffiliateCommission {
  id: string;
  referred_email: string;
  amount_vnd: number;
  commission_vnd: number;
  status: string;
  available_at: string;
  created_at: string;
}

export interface AffiliateWithdrawal {
  id: string;
  amount_vnd: number;
  method: string;
  status: string;
  created_at: string;
  admin_note?: string;
}

export interface WithdrawInput {
  amount: number;
  method: 'bank_transfer' | 'credit_convert';
  bankInfo?: { bank: string; accountNo: string; accountName: string };
}

export type MutationResult =
  | { success: true; creditsAdded?: number }
  | { success: false; error: string };

/** Minimum withdrawal, matching the web dashboard (500,000 VND). */
export const MIN_WITHDRAW_VND = 500000;

// ── Helpers (no prototype-chain reads; token-free diagnostics) ─────────────

function ownValue(raw: unknown, key: string): unknown {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
  const obj = raw as Record<string, unknown>;
  return Object.hasOwn(obj, key) ? obj[key] : undefined;
}

function ownArray(raw: unknown, key: string): unknown[] {
  const value = ownValue(raw, key);
  return Array.isArray(value) ? value : [];
}

function num(raw: unknown, key: string): number {
  const v = ownValue(raw, key);
  return typeof v === 'number' && Number.isFinite(v) ? v : 0;
}

function str(raw: unknown, key: string): string {
  const v = ownValue(raw, key);
  return typeof v === 'string' ? v : '';
}

function shortError(err: unknown): string {
  if (err instanceof Error) return (err.message || err.name || 'error').slice(0, 200);
  return 'error';
}

export class AffiliateClient {
  constructor(private readonly auth: AuthManager) {}

  // ── Reads ────────────────────────────────────────────────────────────────

  /**
   * GET /api/affiliate/code + /stats → merged AffiliateStats.
   * Returns null on no-auth / error (renderer shows the empty state).
   */
  async getStats(): Promise<AffiliateStats | null> {
    const token = await this.auth.getAccessToken();
    if (token == null) return null;

    try {
      const [codeRaw, statsRaw] = await Promise.all([
        this.get(token, '/api/affiliate/code'),
        this.get(token, '/api/affiliate/stats'),
      ]);
      if (codeRaw == null || statsRaw == null) return null;
      if (ownValue(codeRaw, 'success') !== true || ownValue(statsRaw, 'success') !== true) return null;

      return {
        code: str(codeRaw, 'code'),
        referralLink: str(codeRaw, 'referralLink'),
        totalReferrals: num(statsRaw, 'totalReferrals'),
        pendingVnd: num(statsRaw, 'pendingVnd'),
        availableVnd: num(statsRaw, 'availableVnd'),
        paidVnd: num(statsRaw, 'paidVnd'),
        totalEarningsVnd: num(statsRaw, 'totalEarningsVnd'),
      };
    } catch (err) {
      this.logFailure('affiliate.getStats', undefined, shortError(err));
      return null;
    }
  }

  /** GET /api/affiliate/commissions → AffiliateCommission[] (empty on no-auth / error). */
  async listCommissions(): Promise<AffiliateCommission[]> {
    const token = await this.auth.getAccessToken();
    if (token == null) return [];

    try {
      const raw = await this.get(token, '/api/affiliate/commissions');
      return ownArray(raw, 'commissions').map((c) => ({
        id: str(c, 'id'),
        referred_email: str(c, 'referred_email'),
        amount_vnd: num(c, 'amount_vnd'),
        commission_vnd: num(c, 'commission_vnd'),
        status: str(c, 'status'),
        available_at: str(c, 'available_at'),
        created_at: str(c, 'created_at'),
      }));
    } catch (err) {
      this.logFailure('affiliate.listCommissions', undefined, shortError(err));
      return [];
    }
  }

  /** GET /api/affiliate/withdrawals → AffiliateWithdrawal[] (empty on no-auth / error). */
  async listWithdrawals(): Promise<AffiliateWithdrawal[]> {
    const token = await this.auth.getAccessToken();
    if (token == null) return [];

    try {
      const raw = await this.get(token, '/api/affiliate/withdrawals');
      return ownArray(raw, 'withdrawals').map((w) => ({
        id: str(w, 'id'),
        amount_vnd: num(w, 'amount_vnd'),
        method: str(w, 'method'),
        status: str(w, 'status'),
        created_at: str(w, 'created_at'),
        admin_note: str(w, 'admin_note') || undefined,
      }));
    } catch (err) {
      this.logFailure('affiliate.listWithdrawals', undefined, shortError(err));
      return [];
    }
  }

  // ── Writes (money flow — fail-closed, never throw) ─────────────────────────

  /** POST /api/affiliate/withdraw. Enforces the min amount before calling. */
  async withdraw(input: WithdrawInput): Promise<MutationResult> {
    if (!Number.isFinite(input.amount) || input.amount < MIN_WITHDRAW_VND) {
      return { success: false, error: `Tối thiểu ${MIN_WITHDRAW_VND.toLocaleString('vi-VN')} VND` };
    }
    const token = await this.auth.getAccessToken();
    if (token == null) return { success: false, error: 'Chưa đăng nhập' };

    try {
      const body: Record<string, unknown> = { amount: input.amount, method: input.method };
      if (input.method === 'bank_transfer' && input.bankInfo) body.bankInfo = input.bankInfo;
      const raw = await this.post(token, '/api/affiliate/withdraw', body);
      return this.toMutationResult(raw);
    } catch (err) {
      this.logFailure('affiliate.withdraw', undefined, shortError(err));
      return { success: false, error: 'Yêu cầu thất bại' };
    }
  }

  /** POST /api/affiliate/convert-credit. Converts available VND to API credits. */
  async convertCredit(amount: number): Promise<MutationResult> {
    if (!Number.isFinite(amount) || amount < MIN_WITHDRAW_VND) {
      return { success: false, error: `Tối thiểu ${MIN_WITHDRAW_VND.toLocaleString('vi-VN')} VND` };
    }
    const token = await this.auth.getAccessToken();
    if (token == null) return { success: false, error: 'Chưa đăng nhập' };

    try {
      const raw = await this.post(token, '/api/affiliate/convert-credit', { amount });
      const result = this.toMutationResult(raw);
      if (result.success) {
        const added = ownValue(raw, 'creditsAdded');
        if (typeof added === 'number') result.creditsAdded = added;
      }
      return result;
    } catch (err) {
      this.logFailure('affiliate.convertCredit', undefined, shortError(err));
      return { success: false, error: 'Yêu cầu thất bại' };
    }
  }

  /** Open the full affiliate dashboard on the web (same account/data) in the browser. */
  affiliateWebUrl(): string {
    return `${IZZI_WEB_BASE}/dashboard/affiliate`;
  }

  // ── Internals ──────────────────────────────────────────────────────────────

  private async get(token: string, path: string): Promise<unknown> {
    const res = await fetch(`${IZZI_API_BASE}${path}`, { headers: this.authHeaders(token) });
    if (res.status === 401) return null; // fail-closed, no anonymous retry
    if (!res.ok) {
      this.logFailure(`GET ${path}`, res.status);
      return null;
    }
    return res.json();
  }

  private async post(token: string, path: string, body: unknown): Promise<unknown> {
    const res = await fetch(`${IZZI_API_BASE}${path}`, {
      method: 'POST',
      headers: this.authHeaders(token),
      body: JSON.stringify(body),
    });
    // For writes we still read the body: the backend returns {success:false,error} with a 4xx.
    let raw: unknown = null;
    try {
      raw = await res.json();
    } catch {
      raw = null;
    }
    if (!res.ok && ownValue(raw, 'error') === undefined) {
      this.logFailure(`POST ${path}`, res.status);
    }
    return raw;
  }

  private toMutationResult(raw: unknown): MutationResult {
    if (ownValue(raw, 'success') === true) return { success: true };
    const err = ownValue(raw, 'error');
    return { success: false, error: typeof err === 'string' && err ? err : 'Yêu cầu thất bại' };
  }

  /** Build request headers. The token lives only here, never crosses IPC. */
  private authHeaders(token: string): Record<string, string> {
    return { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` };
  }

  /** Record a diagnostic — op type + HTTP status only, never token / amounts. */
  private logFailure(type: string, status?: number, message?: string): void {
    const detail = status !== undefined ? `request failed (status ${status})` : message ?? 'request failed';
    console.warn(`[AffiliateClient] ${type}: ${detail}`);
  }
}
