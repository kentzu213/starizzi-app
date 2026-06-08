import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// ─────────────────────────────────────────────────────────────────────────────
// Mocks: axios (no real network) + electron safeStorage (both branches).
// ─────────────────────────────────────────────────────────────────────────────

const axiosRequest = vi.fn();
vi.mock('axios', () => ({
  default: { request: (...args: any[]) => axiosRequest(...args) },
}));

let encryptionAvailable = true;
vi.mock('electron', () => ({
  safeStorage: {
    isEncryptionAvailable: () => encryptionAvailable,
    encryptString: (s: string) => Buffer.from(`enc:${s}`, 'utf8'),
    decryptString: (b: Buffer) => b.toString('utf8').replace(/^enc:/, ''),
  },
}));

import { CustomOpenAIProvider } from './custom-openai-provider';
import { ProviderResolver } from './provider-resolver';
import { SecretStore } from './secret-store';
import {
  ALLOWED_MODELS,
  ProviderSettingsStore,
  validateCustomConfig,
  type CustomProviderConfig,
} from './provider-settings-store';
import type { ManagedProviderStreamChunk } from './types';

const FAKE_KEY = 'cpa_fake_key_abcd1234';
const HTTPS_URL = 'https://cpab.example.dev/v1';

const VALID_CONFIG: CustomProviderConfig = {
  baseUrl: HTTPS_URL,
  authType: 'bearer',
  selectedModel: 'gpt-5.4',
};

/** In-memory stand-in for DatabaseManager's settings table. */
function createFakeDb() {
  const settings = new Map<string, string>();
  const diagnostics: Array<{ type: string; status: string; detail: string }> = [];
  return {
    getSetting: (k: string) => (settings.has(k) ? settings.get(k)! : null),
    setSetting: (k: string, v: string) => void settings.set(k, v),
    deleteSetting: (k: string) => void settings.delete(k),
    appendDiagnosticEvent: (e: any) => void diagnostics.push(e),
    __settings: settings,
    __diagnostics: diagnostics,
  } as any;
}

/** Build an async iterable that mimics an axios responseType:'stream' body. */
function fakeStream(chunks: string[]): NodeJS.ReadableStream {
  return (async function* () {
    for (const chunk of chunks) {
      yield Buffer.from(chunk, 'utf8');
    }
  })() as unknown as NodeJS.ReadableStream;
}

async function collect(gen: AsyncGenerator<ManagedProviderStreamChunk>): Promise<ManagedProviderStreamChunk[]> {
  const out: ManagedProviderStreamChunk[] = [];
  for await (const ev of gen) out.push(ev);
  return out;
}

beforeEach(() => {
  encryptionAvailable = true;
  axiosRequest.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

// 1. Auth-header builder ──────────────────────────────────────────────────────
describe('CustomOpenAIProvider.buildHeaders (via streamChat)', () => {
  async function captureHeaders(authType: 'bearer' | 'x-api-key') {
    axiosRequest.mockResolvedValue({
      status: 200,
      headers: { 'content-type': 'text/event-stream' },
      data: fakeStream(['data: [DONE]\n']),
    });
    const provider = new CustomOpenAIProvider({ ...VALID_CONFIG, authType }, FAKE_KEY);
    await collect(provider.streamChat({ sessionId: 's', message: 'hi', history: [] }));
    return axiosRequest.mock.calls[0][0].headers as Record<string, string>;
  }

  it('bearer ⇒ Authorization only, no x-api-key', async () => {
    const headers = await captureHeaders('bearer');
    expect(headers['Authorization']).toBe(`Bearer ${FAKE_KEY}`);
    expect(headers['x-api-key']).toBeUndefined();
  });

  it('x-api-key ⇒ x-api-key only, no Authorization', async () => {
    const headers = await captureHeaders('x-api-key');
    expect(headers['x-api-key']).toBe(FAKE_KEY);
    expect(headers['Authorization']).toBeUndefined();
  });
});

// 2. Config validation ────────────────────────────────────────────────────────
describe('validateCustomConfig', () => {
  it('accepts a valid https + allowed-model + known authType config', () => {
    expect(validateCustomConfig(VALID_CONFIG).ok).toBe(true);
  });

  it('rejects a model outside ALLOWED_MODELS', () => {
    const res = validateCustomConfig({ ...VALID_CONFIG, selectedModel: 'gpt-4o' as any });
    expect(res.ok).toBe(false);
  });

  it('rejects a non-https base URL', () => {
    const res = validateCustomConfig({ ...VALID_CONFIG, baseUrl: 'http://insecure.dev/v1' });
    expect(res.ok).toBe(false);
  });

  it('rejects an unparseable base URL', () => {
    const res = validateCustomConfig({ ...VALID_CONFIG, baseUrl: 'not a url' });
    expect(res.ok).toBe(false);
  });

  it('rejects an unknown authType', () => {
    const res = validateCustomConfig({ ...VALID_CONFIG, authType: 'basic' as any });
    expect(res.ok).toBe(false);
  });

  it('every ALLOWED_MODELS entry validates', () => {
    for (const model of ALLOWED_MODELS) {
      expect(validateCustomConfig({ ...VALID_CONFIG, selectedModel: model }).ok).toBe(true);
    }
  });
});

// 3. Provider resolver (XOR + guard) ────────────────────────────────────────────
describe('ProviderResolver.resolve', () => {
  function setup(opts: { enabled: boolean; config?: CustomProviderConfig | null; key?: string | null }) {
    const db = createFakeDb();
    const settings = new ProviderSettingsStore(db);
    const secrets = new SecretStore(db);
    if (opts.config) settings.saveConfig(opts.config);
    settings.setEnabled(opts.enabled);
    if (opts.key) secrets.setKey(opts.key);
    const managed = { __managed: true } as any;
    return { resolver: new ProviderResolver(settings, secrets, managed), managed };
  }

  it('enabled=false ⇒ returns the managed provider instance (R8)', () => {
    const { resolver, managed } = setup({ enabled: false, config: VALID_CONFIG, key: FAKE_KEY });
    expect(resolver.resolve()).toBe(managed);
  });

  it('enabled=true + valid config + key ⇒ CustomOpenAIProvider', () => {
    const { resolver } = setup({ enabled: true, config: VALID_CONFIG, key: FAKE_KEY });
    expect(resolver.resolve()).toBeInstanceOf(CustomOpenAIProvider);
  });

  it('enabled=true but missing key ⇒ falls back to managed', () => {
    const { resolver, managed } = setup({ enabled: true, config: VALID_CONFIG, key: null });
    expect(resolver.resolve()).toBe(managed);
  });

  it('enabled=true but invalid config ⇒ falls back to managed', () => {
    const { resolver, managed } = setup({
      enabled: true,
      config: { ...VALID_CONFIG, baseUrl: 'http://insecure.dev' },
      key: FAKE_KEY,
    });
    expect(resolver.resolve()).toBe(managed);
  });
});

// 4. getChatUrl (no double path) ────────────────────────────────────────────────
describe('CustomOpenAIProvider.getChatUrl (via request URL)', () => {
  async function captureUrl(baseUrl: string) {
    axiosRequest.mockResolvedValue({
      status: 200,
      headers: { 'content-type': 'text/event-stream' },
      data: fakeStream(['data: [DONE]\n']),
    });
    const provider = new CustomOpenAIProvider({ ...VALID_CONFIG, baseUrl }, FAKE_KEY);
    await collect(provider.streamChat({ sessionId: 's', message: 'hi', history: [] }));
    return axiosRequest.mock.calls[0][0].url as string;
  }

  it('baseUrl ending with /v1 ⇒ appends /chat/completions', async () => {
    expect(await captureUrl('https://x.dev/v1')).toBe('https://x.dev/v1/chat/completions');
  });

  it('baseUrl ending with /chat/completions ⇒ unchanged', async () => {
    expect(await captureUrl('https://x.dev/v1/chat/completions')).toBe('https://x.dev/v1/chat/completions');
  });

  it('bare baseUrl ⇒ appends /v1/chat/completions', async () => {
    expect(await captureUrl('https://x.dev')).toBe('https://x.dev/v1/chat/completions');
  });

  it('trailing slash is normalized (no double path)', async () => {
    expect(await captureUrl('https://x.dev/v1/')).toBe('https://x.dev/v1/chat/completions');
  });
});

// 5. Shared SSE parser ──────────────────────────────────────────────────────────
describe('shared SSE parsing (streamOpenAISse via CustomOpenAIProvider)', () => {
  it('yields assistant_delta chunks then assistant_done on [DONE]', async () => {
    axiosRequest.mockResolvedValue({
      status: 200,
      headers: { 'content-type': 'text/event-stream' },
      data: fakeStream([
        'data: {"choices":[{"delta":{"content":"Hello"}}]}\n',
        'data: {"choices":[{"delta":{"content":" world"}}]}\n',
        'data: [DONE]\n',
      ]),
    });
    const provider = new CustomOpenAIProvider(VALID_CONFIG, FAKE_KEY);
    const events = await collect(provider.streamChat({ sessionId: 's', message: 'hi', history: [] }));

    expect(events[0]).toMatchObject({ type: 'status', state: 'running' });
    expect(events[1]).toMatchObject({ type: 'assistant_start' });
    const deltas = events.filter((e) => e.type === 'assistant_delta').map((e) => e.delta);
    expect(deltas).toEqual(['Hello', ' world']);
    expect(events.at(-1)).toMatchObject({ type: 'assistant_done' });
  });

  it('honors finish_reason:stop', async () => {
    axiosRequest.mockResolvedValue({
      status: 200,
      headers: { 'content-type': 'text/event-stream' },
      data: fakeStream([
        'data: {"choices":[{"delta":{"content":"hi"}}]}\n',
        'data: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n',
      ]),
    });
    const provider = new CustomOpenAIProvider(VALID_CONFIG, FAKE_KEY);
    const events = await collect(provider.streamChat({ sessionId: 's', message: 'hi', history: [] }));
    expect(events.at(-1)).toMatchObject({ type: 'assistant_done' });
  });
});

// 6. Secret redaction + masked hint ─────────────────────────────────────────────
describe('SecretStore redaction + masking', () => {
  it('redact() removes the stored key from a string', () => {
    const db = createFakeDb();
    const secrets = new SecretStore(db);
    secrets.setKey(FAKE_KEY);
    const message = `request failed using key ${FAKE_KEY} at endpoint`;
    const redacted = secrets.redact(message);
    expect(redacted).not.toContain(FAKE_KEY);
    expect(redacted).toContain('••••');
  });

  it('redact() also scrubs an extra (unsaved) key', () => {
    const db = createFakeDb();
    const secrets = new SecretStore(db);
    const transient = 'cpa_unsaved_zzzz9999';
    const redacted = secrets.redact(`oops ${transient}`, transient);
    expect(redacted).not.toContain(transient);
  });

  it('maskedHint() exposes only the last 4 characters', () => {
    const db = createFakeDb();
    const secrets = new SecretStore(db);
    secrets.setKey(FAKE_KEY);
    const hint = secrets.maskedHint();
    expect(hint).toBe('••••' + FAKE_KEY.slice(-4));
    expect(hint).not.toContain(FAKE_KEY);
  });
});

// 7. Error mapping (HTTP 401) ───────────────────────────────────────────────────
describe('CustomOpenAIProvider error mapping', () => {
  it('HTTP 401 ⇒ concise message, no raw body and no key', async () => {
    axiosRequest.mockResolvedValue({
      status: 401,
      headers: { 'content-type': 'application/json' },
      data: fakeStream([`{"error":"invalid key ${FAKE_KEY}","stack":"secret-trace"}`]),
    });
    const provider = new CustomOpenAIProvider(VALID_CONFIG, FAKE_KEY, (t) => t.split(FAKE_KEY).join('••••'));
    let caught: Error | null = null;
    try {
      await collect(provider.streamChat({ sessionId: 's', message: 'hi', history: [] }));
    } catch (err) {
      caught = err as Error;
    }
    expect(caught).toBeInstanceOf(Error);
    expect(caught!.message).toContain('HTTP 401');
    expect(caught!.message).not.toContain(FAKE_KEY);
    expect(caught!.message).not.toContain('secret-trace');
  });

  it('testConnection returns ok:true on 2xx', async () => {
    axiosRequest.mockResolvedValue({ status: 200, headers: {}, data: { ok: true } });
    const provider = new CustomOpenAIProvider(VALID_CONFIG, FAKE_KEY);
    const result = await provider.testConnection();
    expect(result.ok).toBe(true);
    expect(result.model).toBe('gpt-5.4');
  });

  it('testConnection redacts the key on 4xx', async () => {
    axiosRequest.mockResolvedValue({
      status: 403,
      headers: {},
      data: { error: `bad ${FAKE_KEY}` },
    });
    const provider = new CustomOpenAIProvider(VALID_CONFIG, FAKE_KEY, (t) => t.split(FAKE_KEY).join('••••'));
    const result = await provider.testConnection();
    expect(result.ok).toBe(false);
    expect(result.message).toContain('HTTP 403');
    expect(result.message).not.toContain(FAKE_KEY);
  });
});

// 8. Store smoke + safeStorage branches ─────────────────────────────────────────
describe('ProviderSettingsStore + SecretStore smoke (in-memory db)', () => {
  it('set→get→delete config and enabled flag', () => {
    const db = createFakeDb();
    const settings = new ProviderSettingsStore(db);

    expect(settings.getConfig()).toBeNull();
    expect(settings.isCustomEnabled()).toBe(false);

    settings.saveConfig(VALID_CONFIG);
    expect(settings.getConfig()).toEqual(VALID_CONFIG);

    settings.setEnabled(true);
    expect(settings.isCustomEnabled()).toBe(true);

    settings.clearConfig();
    expect(settings.getConfig()).toBeNull();
  });

  it('key set ⇒ hasKey true and get returns fake value; delete ⇒ hasKey false', () => {
    const db = createFakeDb();
    const secrets = new SecretStore(db);

    expect(secrets.hasKey()).toBe(false);
    secrets.setKey(FAKE_KEY);
    expect(secrets.hasKey()).toBe(true);
    expect(secrets.getKey()).toBe(FAKE_KEY);

    secrets.deleteKey();
    expect(secrets.hasKey()).toBe(false);
    expect(secrets.getKey()).toBeNull();
  });

  it('does not persist the raw key in plaintext when encryption is available', () => {
    const db = createFakeDb();
    const secrets = new SecretStore(db);
    secrets.setKey(FAKE_KEY);
    const stored = db.getSetting('custom_provider_api_key');
    expect(stored).not.toBe(FAKE_KEY);
    // stored is base64(encryptString(...)); decode to confirm the mock-encryption marker
    expect(Buffer.from(stored, 'base64').toString('utf8')).toContain('enc:');
  });

  it('safeStorage unavailable ⇒ still stores + logs a diagnostic without the key value', () => {
    encryptionAvailable = false;
    const db = createFakeDb();
    const secrets = new SecretStore(db);
    secrets.setKey(FAKE_KEY);

    expect(secrets.getKey()).toBe(FAKE_KEY);
    expect(db.__diagnostics.length).toBe(1);
    expect(JSON.stringify(db.__diagnostics)).not.toContain(FAKE_KEY);
  });
});
