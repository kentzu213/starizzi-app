/**
 * Auto-Post Tool REST client (autopost-unification, Phase 2).
 *
 * A thin, JWT-authed client over the Auto-Post Tool's verified REST API. All calls
 * carry the Bearer JWT from `AutopostAuth` (minted from the izzi/Supabase session);
 * the workspace is derived server-side from that token, so this client never sends
 * a client-chosen workspace as authority (it only fills the DTO's required
 * `workspaceId` field with the token's own workspace to pass validation).
 *
 * Safety (verified against posts.service.create): a post with NO accounts and NO
 * schedule is created as a `draft` (never published); accounts + no schedule would
 * publish immediately. So `createDraft` sends content only → always a safe draft;
 * publishing/scheduling is the separate, approval-gated `schedulePost`.
 *
 * @module main/autopost/autopost-client
 */
import type { AutopostAuth } from './autopost-auth';

export interface AutopostResult {
  ok: boolean;
  status?: number;
  data?: unknown;
  error?: string;
}

/** Pull a concise message out of a NestJS-style error body. */
function extractError(data: unknown): string | null {
  if (!data || typeof data !== 'object') return typeof data === 'string' ? data : null;
  const m = (data as { message?: unknown }).message;
  if (Array.isArray(m)) return m.join('; ');
  if (typeof m === 'string') return m;
  const e = (data as { error?: unknown }).error;
  return typeof e === 'string' ? e : null;
}

export class AutopostClient {
  constructor(private readonly auth: AutopostAuth) {}

  private async request(path: string, method: string, body?: unknown): Promise<AutopostResult> {
    const jwt = await this.auth.getJwt();
    if (!jwt) return { ok: false, error: 'not-connected' };
    try {
      const res = await fetch(`${this.auth.baseUrl}${path}`, {
        method,
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${jwt}` },
        body: body ? JSON.stringify(body) : undefined,
      });
      const text = await res.text().catch(() => '');
      let data: unknown = null;
      try {
        data = text ? JSON.parse(text) : null;
      } catch {
        data = text;
      }
      if (!res.ok) {
        // A stale token → clear so the next call re-mints.
        if (res.status === 401) this.auth.clear();
        return { ok: false, status: res.status, error: extractError(data) || `http ${res.status}` };
      }
      return { ok: true, status: res.status, data };
    } catch (err) {
      return { ok: false, error: (err as Error).message };
    }
  }

  /** GET /social-auth/accounts — connected FB/YT/TikTok accounts in the workspace. */
  listAccounts(): Promise<AutopostResult> {
    return this.request('/social-auth/accounts', 'GET');
  }

  /** GET /posts — posts in the workspace, optionally filtered by status. */
  listPosts(status?: string): Promise<AutopostResult> {
    const q = status ? `?status=${encodeURIComponent(status)}` : '';
    return this.request(`/posts${q}`, 'GET');
  }

  /** POST /posts with content only → a `draft` (never published). */
  async createDraft(input: { content: string; title?: string }): Promise<AutopostResult> {
    // Ensure the token (and thus workspaceId) is minted before building the body.
    const jwt = await this.auth.getJwt();
    if (!jwt) return { ok: false, error: 'not-connected' };
    const workspaceId = this.auth.getWorkspaceId();
    return this.request('/posts', 'POST', {
      workspaceId,
      content: input.content,
      title: input.title,
    });
  }

  /** PATCH /posts/:id — set a future schedule (and optionally target accounts). Publishes at that time. */
  schedulePost(input: {
    postId: string;
    scheduledAt: string;
    socialAccountIds?: string[];
  }): Promise<AutopostResult> {
    return this.request(`/posts/${encodeURIComponent(input.postId)}`, 'PATCH', {
      scheduledAt: input.scheduledAt,
      socialAccountIds: input.socialAccountIds,
    });
  }
}
