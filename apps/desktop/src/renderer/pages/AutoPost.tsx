/**
 * Auto-Post — the in-app social publishing surface (autopost-unification, Phase 4).
 *
 * A NATIVE page over the Auto-Post Tool REST bridge (not an embedded web view):
 * it reuses the same `autopost:*` IPC + izzi JWT the agent and the Social Auto
 * Poster extension use, so there is ONE identity and ONE backend. The full web
 * dashboard (campaigns / approvals / analytics) opens externally on demand.
 *
 * Safety: the JWT never leaves main; this page only ever handles plain data.
 * Composing here creates a DRAFT (never publishes) — publishing/scheduling stays
 * in the agent/extension flow which is approval-gated.
 */
import React, { useCallback, useEffect, useState } from 'react';
import '../styles/autopost.css';

interface AutopostStatus {
  enabled: boolean;
  connected: boolean;
  backendUrl: string;
  workspaceId: string | null;
  accounts: number | null;
}

interface Account {
  id: string;
  platform: string;
  name: string;
  status?: string;
}

interface Post {
  id: string;
  title: string;
  status: string;
  scheduledAt?: string;
}

/** Read a string field from an unknown record, trying several key aliases. */
function str(obj: unknown, ...keys: string[]): string {
  if (!obj || typeof obj !== 'object') return '';
  const rec = obj as Record<string, unknown>;
  for (const k of keys) {
    const v = rec[k];
    if (typeof v === 'string' && v) return v;
  }
  return '';
}

function toAccount(raw: unknown): Account {
  return {
    id: str(raw, 'id', 'accountId'),
    platform: str(raw, 'platform', 'provider') || 'social',
    name: str(raw, 'accountName', 'name', 'username', 'displayName') || 'Tài khoản',
    status: str(raw, 'status') || undefined,
  };
}

function toPost(raw: unknown): Post {
  return {
    id: str(raw, 'id'),
    title: str(raw, 'title', 'content') || '(không tiêu đề)',
    status: str(raw, 'status') || 'draft',
    scheduledAt: str(raw, 'scheduledAt', 'scheduled_at') || undefined,
  };
}

const PLATFORM_ICON: Record<string, string> = {
  facebook: '📘',
  youtube: '▶️',
  tiktok: '🎵',
  instagram: '📸',
  x: '𝕏',
  twitter: '𝕏',
  threads: '@',
};

function platformIcon(platform: string): string {
  return PLATFORM_ICON[platform.toLowerCase()] ?? '🌐';
}

function statusBadgeClass(status: string): string {
  const s = status.toLowerCase();
  if (s === 'published' || s === 'publishing' || s === 'live') return 'ap-badge ap-badge--live';
  if (s === 'scheduled') return 'ap-badge ap-badge--scheduled';
  return 'ap-badge';
}

export function AutoPostPage() {
  const api = window.electronAPI?.autopost;

  const [status, setStatus] = useState<AutopostStatus | null>(null);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [posts, setPosts] = useState<Post[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<{ text: string; error?: boolean } | null>(null);

  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');

  const refresh = useCallback(async () => {
    if (!api) {
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const s = await api.getStatus();
      setStatus(s);
      if (s.connected) {
        const [accRes, postRes] = await Promise.all([api.listAccounts(), api.listPosts()]);
        setAccounts(accRes.ok && accRes.accounts ? accRes.accounts.map(toAccount) : []);
        setPosts(postRes.ok && postRes.posts ? postRes.posts.map(toPost) : []);
      } else {
        setAccounts([]);
        setPosts([]);
      }
    } catch {
      /* status is best-effort */
    } finally {
      setLoading(false);
    }
  }, [api]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const setEnabled = useCallback(
    async (enabled: boolean) => {
      if (!api) return;
      setBusy(true);
      try {
        await api.setEnabled(enabled);
        await refresh();
      } finally {
        setBusy(false);
      }
    },
    [api, refresh],
  );

  const submitDraft = useCallback(async () => {
    if (!api || !content.trim()) return;
    setBusy(true);
    setToast(null);
    try {
      const r = await api.createDraft({ content: content.trim(), title: title.trim() || undefined });
      if (r.ok) {
        setTitle('');
        setContent('');
        setToast({ text: 'Đã lưu bản nháp trên Auto-Post.' });
        await refresh();
      } else {
        setToast({ text: r.error || 'Không tạo được bản nháp.', error: true });
      }
    } finally {
      setBusy(false);
    }
  }, [api, content, title, refresh]);

  const openWeb = useCallback(() => {
    void api?.openWeb();
  }, [api]);

  if (!api) {
    return (
      <div className="ap-page">
        <p className="ap-note ap-note--warn">Trang Auto-Post cần chạy trong ứng dụng Starizzi (Electron).</p>
      </div>
    );
  }

  const connected = !!status?.connected;
  const enabled = !!status?.enabled;

  return (
    <div className="ap-page">
      <header className="ap-header">
        <div className="ap-header__titles">
          <h1 className="ap-header__title">Auto-Post</h1>
          <p className="ap-header__subtitle">
            Đăng và lên lịch bài social qua Auto-Post Tool — dùng chung tài khoản izzi, không cần đăng
            nhập lại. Agent và extension đăng bài qua cùng backend này.
          </p>
        </div>
        <div className="ap-header__actions">
          <button type="button" className="ap-btn ap-btn--ghost" onClick={() => void refresh()} disabled={loading || busy}>
            ↻ Làm mới
          </button>
          <button type="button" className="ap-btn" onClick={openWeb}>
            🔗 Bảng điều khiển đầy đủ
          </button>
        </div>
      </header>

      <section className={`ap-status ${connected ? 'ap-status--on' : ''}`} aria-label="Trạng thái kết nối">
        <span className={`ap-status__dot ${connected ? 'ap-status__dot--live' : ''}`} aria-hidden="true" />
        <div className="ap-status__main">
          <span className="ap-status__label">
            {loading ? 'Đang kiểm tra…' : connected ? 'Đã kết nối' : enabled ? 'Đã bật, chưa xác thực' : 'Chưa kết nối'}
          </span>
          <span className="ap-status__meta">
            {connected
              ? `${status?.backendUrl}${status?.workspaceId ? ` · workspace ${status.workspaceId}` : ''}`
              : enabled
                ? 'Hãy đăng nhập izzi trong Starizzi để cấp quyền cho Auto-Post.'
                : 'Bật để agent và extension đăng bài qua Auto-Post Tool.'}
          </span>
        </div>
        {connected && (
          <div className="ap-status__metrics">
            <div className="ap-metric">
              <span className="ap-metric__value">{accounts.length}</span>
              <span className="ap-metric__caption">tài khoản</span>
            </div>
            <div className="ap-metric">
              <span className="ap-metric__value">{posts.length}</span>
              <span className="ap-metric__caption">bài đăng</span>
            </div>
          </div>
        )}
        {enabled ? (
          <button type="button" className="ap-btn ap-btn--ghost" onClick={() => void setEnabled(false)} disabled={busy}>
            Ngắt
          </button>
        ) : (
          <button type="button" className="ap-btn ap-btn--accent" onClick={() => void setEnabled(true)} disabled={busy}>
            Kết nối Auto-Post
          </button>
        )}
      </section>

      {!connected ? null : (
        <div className="ap-grid">
          <section className="ap-section" aria-label="Tài khoản đã kết nối">
            <div className="ap-section__head">
              <h2 className="ap-section__title">Tài khoản mạng xã hội</h2>
              <button type="button" className="ap-btn ap-btn--ghost" onClick={openWeb}>
                + Kết nối
              </button>
            </div>
            {accounts.length === 0 ? (
              <p className="ap-empty">Chưa có tài khoản nào. Mở bảng điều khiển đầy đủ để liên kết Facebook / YouTube / TikTok.</p>
            ) : (
              <div className="ap-list">
                {accounts.map((a) => (
                  <div key={a.id || a.name} className="ap-row">
                    <span className="ap-row__icon" aria-hidden="true">{platformIcon(a.platform)}</span>
                    <div className="ap-row__body">
                      <span className="ap-row__name">{a.name}</span>
                      <span className="ap-row__meta">{a.platform}</span>
                    </div>
                    {a.status && <span className={statusBadgeClass(a.status)}>{a.status}</span>}
                  </div>
                ))}
              </div>
            )}
          </section>

          <section className="ap-section" aria-label="Soạn bản nháp">
            <div className="ap-section__head">
              <h2 className="ap-section__title">Soạn nhanh (bản nháp)</h2>
            </div>
            <div className="ap-compose">
              <input
                className="ap-input"
                type="text"
                placeholder="Tiêu đề (tuỳ chọn)"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                disabled={busy}
              />
              <textarea
                className="ap-textarea"
                placeholder="Nội dung bài đăng…"
                value={content}
                onChange={(e) => setContent(e.target.value)}
                disabled={busy}
              />
              <div className="ap-compose__foot">
                <span className="ap-compose__hint">Lưu thành bản nháp — không tự đăng.</span>
                <button
                  type="button"
                  className="ap-btn ap-btn--accent"
                  onClick={() => void submitDraft()}
                  disabled={busy || !content.trim()}
                >
                  Lưu nháp
                </button>
              </div>
              {toast && <span className={`ap-toast ${toast.error ? 'ap-toast--error' : ''}`}>{toast.text}</span>}
            </div>
          </section>

          <section className="ap-section" aria-label="Bài đăng gần đây">
            <div className="ap-section__head">
              <h2 className="ap-section__title">Bài đăng gần đây</h2>
            </div>
            {posts.length === 0 ? (
              <p className="ap-empty">Chưa có bài nào. Soạn bản nháp bên cạnh, hoặc để agent tạo bài giúp bạn.</p>
            ) : (
              <div className="ap-list">
                {posts.slice(0, 12).map((p) => (
                  <div key={p.id} className="ap-row">
                    <span className="ap-row__icon" aria-hidden="true">📝</span>
                    <div className="ap-row__body">
                      <span className="ap-row__name">{p.title}</span>
                      {p.scheduledAt && (
                        <span className="ap-row__meta">Hẹn: {new Date(p.scheduledAt).toLocaleString('vi-VN')}</span>
                      )}
                    </div>
                    <span className={statusBadgeClass(p.status)}>{p.status}</span>
                  </div>
                ))}
              </div>
            )}
          </section>
        </div>
      )}
    </div>
  );
}

export default AutoPostPage;
