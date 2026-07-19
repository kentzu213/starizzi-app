import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ExtensionToolHost } from './extension-tools';

const toolHost: ExtensionToolHost = {
  getAllExtensions: () => [
    {
      id: 'extension-fixture',
      state: 'running',
      manifest: {
        displayName: 'Fixture',
        contributes: { commands: [{ id: 'fixture.run', title: 'Run' }] },
      },
    },
  ],
  executeCommand: vi.fn(async () => ({ ok: true })),
};

function successFetch(content = 'OK') {
  return vi.fn(async () => ({
    ok: true,
    json: async () => ({ choices: [{ message: { content } }] }),
  })) as any;
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe('IzziAgent production credential and model capability', () => {
  it('mints/reuses a desktop API key before consulting a profile key', async () => {
    vi.stubEnv('OPENAI_API_KEY', '');
    vi.stubEnv('OPENAI_BASE_URL', 'https://api.izziapi.com/v1');
    const { IzziAgent } = await import('./izzi-agent');
    const ensureDesktopApiKey = vi.fn(async () => 'desktop-key-fixture');
    const getApiKey = vi.fn(() => 'profile-key-fixture');
    const fetchMock = successFetch();
    vi.stubGlobal('fetch', fetchMock);
    const agent = new IzziAgent({ ensureDesktopApiKey, getApiKey } as any, toolHost);

    const result = await agent.chat({ systemPrompt: 's', message: 'hi' });

    expect(result.reply).toBe('OK');
    expect(ensureDesktopApiKey).toHaveBeenCalledOnce();
    expect(getApiKey).not.toHaveBeenCalled();
    expect(fetchMock.mock.calls[0][1].headers.Authorization).toBe('Bearer desktop-key-fixture');
  });

  it('passes direct Sol through but omits unsupported tools and attributes the Izzi call', async () => {
    vi.stubEnv('OPENAI_API_KEY', '');
    vi.stubEnv('OPENAI_BASE_URL', 'https://api.izziapi.com/v1');
    const { IzziAgent } = await import('./izzi-agent');
    const fetchMock = successFetch('SOL_OK');
    vi.stubGlobal('fetch', fetchMock);
    const agent = new IzziAgent(
      { ensureDesktopApiKey: async () => 'desktop-key-fixture', getApiKey: () => null } as any,
      toolHost,
    );

    await agent.chat({
      systemPrompt: 's',
      message: 'hi',
      model: 'gpt-5.6-sol',
      enableTools: true,
    });

    const request = fetchMock.mock.calls[0][1];
    const body = JSON.parse(request.body);
    expect(body.model).toBe('gpt-5.6-sol');
    expect(body.tools).toBeUndefined();
    expect(body.tool_choice).toBeUndefined();
    expect(request.headers['X-Source-Platform']).toBe('starizzi');
  });

  it('keeps tools enabled for direct Grok', async () => {
    vi.stubEnv('OPENAI_API_KEY', '');
    vi.stubEnv('OPENAI_BASE_URL', 'https://api.izziapi.com/v1');
    const { IzziAgent } = await import('./izzi-agent');
    const fetchMock = successFetch('GROK_OK');
    vi.stubGlobal('fetch', fetchMock);
    const agent = new IzziAgent(
      { ensureDesktopApiKey: async () => 'desktop-key-fixture', getApiKey: () => null } as any,
      toolHost,
    );

    await agent.chat({ systemPrompt: 's', message: 'hi', model: 'grok-4.5-high', enableTools: true });

    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.model).toBe('grok-4.5-high');
    expect(Array.isArray(body.tools)).toBe(true);
    expect(body.tool_choice).toBe('auto');
  });
});
