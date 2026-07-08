/**
 * Social Auto Poster — Starizzi (.ocx) utility bundle
 *
 * Đăng / lên lịch bài social qua AUTO-POST TOOL (backend izzi thống nhất).
 * Agent gọi được các command bên dưới (params-based). Starizzi tự bơm cấu hình
 * (Backend URL + API key + workspace) từ phiên đăng nhập izzi — KHÔNG cần nhập tay.
 *
 * Backend mapping (Auto-Post Tool REST, mặc định http://127.0.0.1:3001; auth JWT izzi):
 *   - List accounts:   GET    /social-auth/accounts
 *   - Create/Schedule: POST   /posts        (scheduledAt tương lai = lên lịch; rỗng + có account = đăng ngay; không account = nháp)
 *   - List posts:      GET    /posts?status=...
 *   - Delete post:     DELETE /posts/:id
 *   Auth: Authorization: Bearer <JWT izzi>. Response REST thuần (200 = OK; lỗi = {statusCode,message}).
 *
 * An toàn: apiKey (JWT) do Starizzi bơm vào storage, không log, chỉ gửi tới backend đã cấu hình.
 * Bài KHÔNG có account => nháp (không đăng). Có account + không hẹn giờ => đăng ngay (hành động người dùng chủ động).
 */

let ctx = null;

const SETTING_KEYS = ['backendUrl', 'apiKey', 'workspaceId', 'channel', 'targetId', 'scheduleTimes', 'timezone'];

async function getConfig(override) {
  const cfg = {};
  for (const k of SETTING_KEYS) {
    try { cfg[k] = await ctx.storage.get('setting.' + k); } catch { cfg[k] = null; }
  }
  cfg.targetId = (override && override.targetId) || cfg.targetId || '';
  cfg.scheduleTimes = cfg.scheduleTimes || '10:00,17:00,20:00';
  cfg.timezone = cfg.timezone || 'Asia/Ho_Chi_Minh';
  if (override && override.backendUrl) cfg.backendUrl = override.backendUrl;
  if (override && override.apiKey) cfg.apiKey = override.apiKey;
  return cfg;
}

function base(cfg) {
  if (!cfg.backendUrl) {
    const e = new Error('Chưa có Backend URL của Auto-Post. Mở Starizzi, đăng nhập izzi rồi bật "Social Auto Poster".');
    e.code = 'NOT_CONFIGURED';
    throw e;
  }
  return cfg.backendUrl.replace(/\/+$/, '');
}

/** Gọi Auto-Post REST, trả về { httpStatus, ok, data, error }. */
async function call(cfg, path, method, body) {
  const url = base(cfg) + path;
  const headers = { 'Content-Type': 'application/json' };
  if (cfg.apiKey) headers['Authorization'] = 'Bearer ' + cfg.apiKey;
  const res = await ctx.net.fetch(url, {
    method: method || 'GET',
    headers,
    body: body ? JSON.stringify(body) : undefined,
    timeout: 30000,
  });
  let parsed = null;
  try { parsed = res.body ? JSON.parse(res.body) : null; } catch { parsed = null; }
  const ok = res.status >= 200 && res.status < 300;
  let error = null;
  if (!ok) {
    const m = parsed && parsed.message;
    error = Array.isArray(m) ? m.join('; ') : (m || (parsed && parsed.error) || ('HTTP ' + res.status));
  }
  return { httpStatus: res.status, ok, data: parsed, error };
}

/** "HH:MM" -> ISO instant hôm nay (giờ máy); nếu đã qua thì +addDays (mặc định +1 ngày). */
function timeToIso(hhmm, addDays) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(hhmm).trim());
  if (!m) return null;
  const now = new Date();
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate(), Number(m[1]), Number(m[2]), 0, 0);
  if (addDays) d.setDate(d.getDate() + addDays);
  else if (d.getTime() <= now.getTime()) d.setDate(d.getDate() + 1);
  return d.toISOString();
}

/** Body cho POST /posts. Không có targetId => nháp (an toàn). */
function buildPostBody(cfg, p, scheduledAtIso) {
  const media = Array.isArray(p.mediaUrls) && p.mediaUrls.length
    ? p.mediaUrls
    : (p.videoUrl ? [p.videoUrl] : undefined);
  const body = {
    workspaceId: cfg.workspaceId || undefined,
    content: p.content,
    title: p.title || undefined,
    socialAccountIds: cfg.targetId ? [cfg.targetId] : undefined,
    mediaUrls: media,
  };
  if (scheduledAtIso) body.scheduledAt = scheduledAtIso;
  if (p.contentType) body.contentType = p.contentType;
  return body;
}

function requireContent(p) {
  if (!p.content || typeof p.content !== 'string') return 'Thiếu "content" (nội dung bài đăng).';
  return null;
}

const extension = {
  async activate(context) {
    ctx = context;
    ctx.log.info('[social-auto-poster] activated (Auto-Post backend)');
    try { await ctx.ui.registerPanel('social-auto-poster.dashboard', renderPanel()); }
    catch (e) { ctx.log.warn('registerPanel failed: ' + (e && e.message)); }
  },

  deactivate() { ctx && ctx.log.info('[social-auto-poster] deactivated'); },

  commands: {
    /** Kiểm tra kết nối + xác thực. params?: { backendUrl?, apiKey? } */
    'social-auto-poster.status': async function status(params) {
      const cfg = await getConfig(params || {});
      const out = {
        configured: Boolean(cfg.backendUrl),
        backendUrl: cfg.backendUrl || null,
        hasApiKey: Boolean(cfg.apiKey),
        targetId: cfg.targetId || null,
        scheduleTimes: cfg.scheduleTimes,
      };
      if (!cfg.backendUrl) { out.connected = false; out.message = 'Chưa có Backend URL.'; return out; }
      try {
        const r = await call(cfg, '/social-auth/accounts', 'GET');
        out.connected = r.ok;
        out.authOk = r.httpStatus !== 401;
        out.accountCount = Array.isArray(r.data) ? r.data.length : undefined;
        if (!r.ok) out.message = r.error;
        return out;
      } catch (err) { out.connected = false; out.error = err.message; return out; }
    },

    /** Liệt kê tài khoản MXH đã liên kết trong Auto-Post (lấy socialAccountId). */
    'social-auto-poster.listAccounts': async function listAccounts(params) {
      const cfg = await getConfig(params || {});
      try {
        const r = await call(cfg, '/social-auth/accounts', 'GET');
        if (!r.ok) return { ok: false, error: r.error };
        const list = Array.isArray(r.data)
          ? r.data.map(a => ({ id: a.id, platform: a.platform, name: a.accountName || a.name || a.username, status: a.status }))
          : r.data;
        return { ok: true, accounts: list };
      } catch (err) { return { ok: false, error: err.message, code: err.code }; }
    },

    /** Đăng ngay. params: { content, title?, mediaUrls?, videoUrl?, targetId?, contentType? } */
    'social-auto-poster.postNow': async function postNow(params) {
      const p = params || {};
      const cfg = await getConfig(p);
      const bad = requireContent(p);
      if (bad) return { ok: false, error: bad };
      const draftOnly = !cfg.targetId;
      try {
        const r = await call(cfg, '/posts', 'POST', buildPostBody(cfg, p, null));
        await ctx.ui.showNotification(
          r.ok ? (draftOnly ? 'Đã tạo bản nháp (chưa chọn tài khoản để đăng).' : 'Đã tạo bài đăng trên Auto-Post.') : ('Lỗi: ' + r.error),
          r.ok ? 'success' : 'error',
        );
        return { ok: r.ok, httpStatus: r.httpStatus, error: r.error, result: r.data, note: draftOnly ? 'Chưa có targetId → tạo nháp. Chạy listAccounts để lấy socialAccountId.' : null };
      } catch (err) { return { ok: false, error: err.message, code: err.code }; }
    },

    /** Lên lịch. params: { content, times?, days?, targetId?, ... } — 1 bài/mốc giờ. */
    'social-auto-poster.schedule': async function schedule(params) {
      const p = params || {};
      const cfg = await getConfig(p);
      const bad = requireContent(p);
      if (bad) return { ok: false, error: bad };
      const times = (p.times || cfg.scheduleTimes || '').split(',').map(s => s.trim()).filter(Boolean);
      if (times.length === 0) return { ok: false, error: 'Thiếu khung giờ (times).' };
      const days = Math.max(1, Number(p.days) || 1);
      const created = [];
      try {
        for (let day = 0; day < days; day++) {
          for (const t of times) {
            const iso = timeToIso(t, day > 0 ? day : undefined);
            if (!iso) { created.push({ time: t, ok: false, error: 'Giờ không hợp lệ' }); continue; }
            const r = await call(cfg, '/posts', 'POST', buildPostBody(cfg, p, iso));
            created.push({ time: t, scheduledAt: iso, ok: r.ok, error: r.error, result: r.data });
          }
        }
        const okCount = created.filter(c => c.ok).length;
        await ctx.ui.showNotification('Đã lên lịch ' + okCount + '/' + created.length + ' bài.', okCount > 0 ? 'success' : 'error');
        return { ok: okCount > 0, scheduled: created, timezone: cfg.timezone, note: cfg.targetId ? null : 'Chưa có targetId → các bài là nháp.' };
      } catch (err) { return { ok: false, error: err.message, scheduled: created }; }
    },

    /** Xem bài đã lên lịch. params?: { status? } (mặc định scheduled) */
    'social-auto-poster.listScheduled': async function listScheduled(params) {
      const p = params || {};
      const cfg = await getConfig(p);
      const status = p.status || 'scheduled';
      try {
        const r = await call(cfg, '/posts?status=' + encodeURIComponent(status), 'GET');
        return { ok: r.ok, error: r.error, result: r.data };
      } catch (err) { return { ok: false, error: err.message }; }
    },

    /** Huỷ / xoá 1 bài. params: { id } */
    'social-auto-poster.cancelScheduled': async function cancelScheduled(params) {
      const p = params || {};
      if (!p.id) return { ok: false, error: 'Thiếu "id" bài cần huỷ.' };
      const cfg = await getConfig(p);
      try {
        const r = await call(cfg, '/posts/' + encodeURIComponent(p.id), 'DELETE');
        return { ok: r.ok, error: r.error, result: r.data };
      } catch (err) { return { ok: false, error: err.message }; }
    },
  },
};

function renderPanel() {
  return [
    '<div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;padding:16px;line-height:1.5">',
    '<h2 style="margin:0 0 8px">📱 Social Auto Poster</h2>',
    '<p style="color:#8a94a6;margin:0 0 12px">Đăng &amp; lên lịch bài social qua Auto-Post Tool. Dùng chung tài khoản izzi — Starizzi tự cấu hình, agent gọi trực tiếp được.</p>',
    '<ol style="margin:0 0 12px;padding-left:18px">',
    '<li>Đăng nhập izzi trong Starizzi (đã dùng cho toàn app).</li>',
    '<li>Mở dashboard Auto-Post → <b>kết nối tài khoản MXH</b> (Facebook Page / YouTube / TikTok).</li>',
    '<li>Chạy <b>listAccounts</b> để lấy <b>socialAccountId</b> → điền vào <b>ID trang/kênh</b>.</li>',
    '<li>Dùng <b>Đăng bài ngay</b> hoặc <b>Lên lịch</b> (mặc định 10:00, 17:00, 20:00).</li>',
    '</ol>',
    '<div style="background:#1f2a1f;border:1px solid #3b6b3b;border-radius:8px;padding:10px;color:#b8e6b8;font-size:13px">',
    'ℹ️ Backend URL &amp; API key được Starizzi tự điền từ phiên izzi — bạn không cần nhập tay. Bài không chọn tài khoản sẽ là <b>bản nháp</b>.',
    '</div>',
    '</div>',
  ].join('');
}

module.exports = extension;
module.exports.default = extension;
