'use strict';
/**
 * Voice Studio extension — thin client over the local VieNeu-TTS backend booted
 * by Starizzi's LocalServiceManager. Talks to it over loopback via ctx.net.fetch.
 * The host injects `backendUrl` into storage when the service is up.
 */
var ctx = null;
var DEFAULT_BACKEND = 'http://127.0.0.1:5111';

async function backendUrl() {
  try {
    var v = await ctx.storage.get('backendUrl');
    if (typeof v === 'string' && v) return v.replace(/\/+$/, '');
  } catch (e) { /* fall through to default */ }
  return DEFAULT_BACKEND;
}

async function getJson(path) {
  var base = await backendUrl();
  var res = await ctx.net.fetch(base + path, { method: 'GET', timeout: 15000 });
  var data = null;
  try { data = res && res.body ? JSON.parse(res.body) : null; } catch (e) { data = res ? res.body : null; }
  return { status: res ? res.status : 0, data: data };
}

module.exports = {
  activate: function (context) {
    ctx = context;
    if (ctx.log && ctx.log.info) ctx.log.info('Voice Studio activated');
  },
  deactivate: function () { ctx = null; },
  commands: {
    // Kiểm tra backend đã sẵn sàng (model đã load) chưa.
    'voice-studio.status': async function () {
      var base = await backendUrl();
      try {
        var r = await getJson('/health/ready');
        return { ok: r.status >= 200 && r.status < 300, status: r.status, backendUrl: base };
      } catch (e) {
        return { ok: false, error: (e && e.message) || 'not-connected', backendUrl: base };
      }
    },
    // Liệt kê giọng mặc định.
    'voice-studio.listVoices': async function () {
      var r = await getJson('/voices');
      if (r.status < 200 || r.status >= 300) return { ok: false, error: 'http ' + r.status };
      return { ok: true, voices: (r.data && r.data.voices) || [] };
    },
    // Đọc văn bản thành giọng. args: { text, voice?, refAudioB64? }
    // refAudioB64 = clone giọng — chỉ dùng khi có sự đồng ý của người nói.
    'voice-studio.tts': async function (args) {
      var input = args || {};
      if (!input.text) return { ok: false, error: 'Thiếu text' };
      var base = await backendUrl();
      var res = await ctx.net.fetch(base + '/tts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: input.text, voice: input.voice, ref_audio_b64: input.refAudioB64 }),
        timeout: 120000,
      });
      if (res.status < 200 || res.status >= 300) {
        return { ok: false, error: 'http ' + res.status };
      }
      var data = null;
      try { data = res.body ? JSON.parse(res.body) : null; } catch (e) { data = null; }
      if (!data || !data.ok) return { ok: false, error: (data && data.error) || 'tts failed' };
      return { ok: true, format: data.format || 'wav', audioB64: data.audio_b64 };
    },
  },
};
