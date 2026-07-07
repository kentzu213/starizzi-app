/**
 * Social Auto Poster — Starizzi (.ocx) utility bundle
 *
 * Đăng / lên lịch bài social qua backend AITOEARN đã cài trên máy.
 * Agent gọi được các command bên dưới (params-based). Cấu hình ở Settings.
 *
 * Backend mapping (aitoearn, nginx :8080, prefix /api — extension chạy trên HOST):
 *   - List accounts:   GET  /api/account/list/all
 *   - Publish/Schedule:POST /api/plat/publish/create   (publishTime tương lai = lên lịch)
 *   - List records:    POST /api/plat/publish/getList
 *   - Cancel task:     DELETE /api/plat/publish/delete/:id
 *   Auth: Authorization: Bearer <API key aitoearn>. Envelope: { data, code, message } (code 0 = OK).
 *
 * Facebook: PAGE đăng qua API OK (accountType 'facebook'). GROUP bị Meta chặn API — cần browser automation.
 * Bảo mật: apiKey lưu cục bộ (ctx.storage), không log giá trị, chỉ gửi tới backend người dùng cấu hình.
 */

let ctx = null;

const SETTING_KEYS = ['backendUrl', 'apiKey', 'channel', 'targetId', 'scheduleTimes', 'timezone'];

// channel (UI) -> aitoearn AccountType
const CHANNEL_TO_ACCOUNT_TYPE = {
  facebook_page: 'facebook',
  facebook_group: 'facebook',
  instagram: 'instagram',
  twitter: 'twitter',
};

async function getConfig(override) {
  const cfg = {};
  for (const k of SETTING_KEYS) {
    try { cfg[k] = await ctx.storage.get('setting.' + k); } catch { cfg[k] = null; }
  }
  cfg.channel = (override && override.channel) || cfg.channel || 'facebook_page';
  cfg.targetId = (override && override.targetId) || cfg.targetId || '';
  cfg.scheduleTimes = cfg.scheduleTimes || '10:00,17:00,20:00';
  cfg.timezone = cfg.timezone || 'Asia/Ho_Chi_Minh';
  if (override && override.backendUrl) cfg.backendUrl = override.backendUrl;
  if (override && override.apiKey) cfg.apiKey = override.apiKey;
  return cfg;
}

function base(cfg) {
  if (!cfg.backendUrl) {
    const e = new Error('Chưa cấu hình Backend URL (vd http://127.0.0.1:8080/api). Mở Settings của "Social Auto Poster".');
    e.code = 'NOT_CONFIGURED';
    throw e;
  }
  return cfg.backendUrl.replace(/\/+$/, '');
}

/** Gọi backend aitoearn, trả về { httpStatus, code, message, data, raw }. */
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
  const env = parsed && typeof parsed === 'object' ? parsed : {};
  return {
    httpStatus: res.status,
    code: (env.code !== undefined ? env.code : null),
    message: env.message || null,
    data: env.data !== undefined ? env.data : parsed,
    raw: parsed,
  };
}

/** aitoearn trả HTTP 200 + envelope; code 0/200 = OK. */
function envOk(r) {
  if (r.code === 0 || r.code === 200) return true;
  if (r.code === null && r.httpStatus >= 200 && r.httpStatus < 300) return true;
  return false;
}

function groupWarning(channel) {
  if (channel === 'facebook_group') {
    return 'Facebook Group không đăng được qua API (Meta chặn). Dùng Facebook Page, hoặc backend phải hỗ trợ browser automation cho group.';
  }
  return null;
}

/** "HH:MM" -> ISO instant hôm nay (theo giờ máy); nếu đã qua thì +1 ngày. */
function timeToIso(hhmm, addDays) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(hhmm).trim());
  if (!m) return null;
  const now = new Date();
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate(), Number(m[1]), Number(m[2]), 0, 0);
  if (addDays) d.setDate(d.getDate() + addDays);
  else if (d.getTime() <= now.getTime()) d.setDate(d.getDate() + 1); // giờ đã qua -> ngày mai
  return d.toISOString();
}

function buildPublishBody(cfg, p, publishTimeIso) {
  const isVideo = Boolean(p.videoUrl) || p.type === 'video';
  const body = {
    accountId: cfg.targetId,
    accountType: CHANNEL_TO_ACCOUNT_TYPE[cfg.channel] || 'facebook',
    type: isVideo ? 'video' : 'article',
    desc: p.content,
    title: p.title || undefined,
    topics: Array.isArray(p.topics) ? p.topics : [],
    publishTime: publishTimeIso,
  };
  if (p.videoUrl) body.videoUrl = p.videoUrl;
  if (p.coverUrl) body.coverUrl = p.coverUrl;
  if (Array.isArray(p.mediaUrls) && p.mediaUrls.length) body.imgUrlList = p.mediaUrls;
  return body;
}

function requireContentAndAccount(p, cfg) {
  if (!p.content || typeof p.content !== 'string') return 'Thiếu "content" (nội dung bài đăng).';
  if (!cfg.targetId) return 'Thiếu targetId (accountId aitoearn). Chạy "listAccounts" để lấy ID trang đã kết nối.';
  return null;
}

const extension = {
  async activate(context) {
    ctx = context;
    ctx.log.info('[social-auto-poster] activated');
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
        channel: cfg.channel,
        targetId: cfg.targetId || null,
        scheduleTimes: cfg.scheduleTimes,
        note: groupWarning(cfg.channel),
      };
      if (!cfg.backendUrl) { out.connected = false; out.message = 'Chưa cấu hình Backend URL.'; return out; }
      try {
        if (cfg.apiKey) {
          const r = await call(cfg, '/account/list/all', 'GET');
          out.connected = envOk(r);
          out.authOk = r.code !== 401;
          out.accountCount = Array.isArray(r.data) ? r.data.length : undefined;
          if (!out.connected) out.message = r.message || ('code ' + r.code);
          return out;
        }
        const h = await call(cfg, '/health', 'GET');
        out.connected = h.httpStatus >= 200 && h.httpStatus < 400;
        out.message = out.connected ? 'Backend sống nhưng CHƯA có API key (chưa xác thực).' : 'Backend không phản hồi.';
        return out;
      } catch (err) { out.connected = false; out.error = err.message; return out; }
    },

    /** Liệt kê tài khoản đã kết nối trên aitoearn (lấy accountId của Page). */
    'social-auto-poster.listAccounts': async function listAccounts(params) {
      const cfg = await getConfig(params || {});
      try {
        const r = await call(cfg, '/account/list/all', 'GET');
        if (!envOk(r)) return { ok: false, code: r.code, error: r.message || 'Không lấy được danh sách tài khoản.' };
        const list = Array.isArray(r.data) ? r.data.map(a => ({ id: a.id || a._id, type: a.type, name: a.nickname || a.account || a.name, uid: a.uid })) : r.data;
        return { ok: true, accounts: list };
      } catch (err) { return { ok: false, error: err.message, code: err.code }; }
    },

    /** Đăng ngay. params: { content, title?, mediaUrls?, videoUrl?, targetId?, channel?, topics? } */
    'social-auto-poster.postNow': async function postNow(params) {
      const p = params || {};
      const cfg = await getConfig(p);
      const bad = requireContentAndAccount(p, cfg);
      if (bad) return { ok: false, error: bad };
      const warn = groupWarning(cfg.channel);
      try {
        const body = buildPublishBody(cfg, p, new Date(Date.now() + 60 * 1000).toISOString()); // +1 phút = "ngay"
        const r = await call(cfg, '/plat/publish/create', 'POST', body);
        const ok = envOk(r);
        await ctx.ui.showNotification(ok ? 'Đã tạo task đăng bài trên aitoearn.' : ('Backend lỗi: ' + (r.message || r.code)), ok ? 'success' : 'error');
        return { ok, code: r.code, httpStatus: r.httpStatus, message: r.message, result: r.data, note: warn };
      } catch (err) { return { ok: false, error: err.message, code: err.code, note: warn }; }
    },

    /**
     * Lên lịch. params: { content, times?, days?, targetId?, channel?, ... }
     * Tạo 1 task cho mỗi mốc giờ (times, mặc định từ settings) trong `days` ngày (mặc định 1 = hôm nay/mai).
     */
    'social-auto-poster.schedule': async function schedule(params) {
      const p = params || {};
      const cfg = await getConfig(p);
      const bad = requireContentAndAccount(p, cfg);
      if (bad) return { ok: false, error: bad };
      const times = (p.times || cfg.scheduleTimes || '').split(',').map(s => s.trim()).filter(Boolean);
      if (times.length === 0) return { ok: false, error: 'Thiếu khung giờ (times).' };
      const days = Math.max(1, Number(p.days) || 1);
      const warn = groupWarning(cfg.channel);
      const created = [];
      try {
        for (let day = 0; day < days; day++) {
          for (const t of times) {
            const iso = timeToIso(t, day > 0 ? day : undefined);
            if (!iso) { created.push({ time: t, ok: false, error: 'Giờ không hợp lệ' }); continue; }
            const r = await call(cfg, '/plat/publish/create', 'POST', buildPublishBody(cfg, p, iso));
            created.push({ time: t, publishTime: iso, ok: envOk(r), code: r.code, message: r.message, result: r.data });
          }
        }
        const okCount = created.filter(c => c.ok).length;
        await ctx.ui.showNotification('Đã lên lịch ' + okCount + '/' + created.length + ' task.', okCount > 0 ? 'success' : 'error');
        return { ok: okCount > 0, scheduled: created, timezone: cfg.timezone, note: warn };
      } catch (err) { return { ok: false, error: err.message, code: err.code, note: warn, scheduled: created }; }
    },

    /** Xem task đã đặt. params?: { status?, accountId? } */
    'social-auto-poster.listScheduled': async function listScheduled(params) {
      const p = params || {};
      const cfg = await getConfig(p);
      try {
        const filter = {};
        if (p.status) filter.status = p.status;
        if (p.accountId || cfg.targetId) filter.accountId = p.accountId || cfg.targetId;
        const r = await call(cfg, '/plat/publish/getList', 'POST', filter);
        return { ok: envOk(r), code: r.code, message: r.message, result: r.data };
      } catch (err) { return { ok: false, error: err.message, code: err.code }; }
    },

    /** Huỷ task. params: { id } */
    'social-auto-poster.cancelScheduled': async function cancelScheduled(params) {
      const p = params || {};
      if (!p.id) return { ok: false, error: 'Thiếu "id" task cần huỷ.' };
      const cfg = await getConfig(p);
      try {
        const r = await call(cfg, '/plat/publish/delete/' + encodeURIComponent(p.id), 'DELETE');
        return { ok: envOk(r), code: r.code, message: r.message, result: r.data };
      } catch (err) { return { ok: false, error: err.message, code: err.code }; }
    },
  },
};

function renderPanel() {
  return [
    '<div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;padding:16px;line-height:1.5">',
    '<h2 style="margin:0 0 8px">📱 Social Auto Poster</h2>',
    '<p style="color:#8a94a6;margin:0 0 12px">Đăng &amp; lên lịch bài social qua aitoearn đã cài. Agent gọi trực tiếp được.</p>',
    '<ol style="margin:0 0 12px;padding-left:18px">',
    '<li>Vào aitoearn (localhost:8080) → <b>kết nối Facebook Page</b> (OAuth).</li>',
    '<li>Tạo <b>API key</b> trong aitoearn. Mở <b>Settings</b> tiện ích: điền <b>Backend URL</b> <code>http://127.0.0.1:8080/api</code> + <b>API key</b>.</li>',
    '<li>Chạy <b>listAccounts</b> để lấy <b>accountId</b> của Page → điền vào <b>ID trang</b>.</li>',
    '<li>Dùng <b>Đăng bài ngay</b> hoặc <b>Lên lịch</b> (mặc định 10:00, 17:00, 20:00).</li>',
    '</ol>',
    '<div style="background:#2a1f1f;border:1px solid #6b3b3b;border-radius:8px;padding:10px;color:#e6b8b8;font-size:13px">',
    '⚠️ <b>Facebook Group</b>: Meta chặn đăng group qua API — hãy dùng <b>Facebook Page</b> (browser automation cho group là việc riêng).',
    '</div>',
    '</div>',
  ].join('');
}

module.exports = extension;
module.exports.default = extension;
