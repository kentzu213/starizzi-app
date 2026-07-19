import { afterEach, describe, expect, it, vi } from 'vitest';
import { GraphAgent } from './graph-agent';

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('GraphAgent SmartRouter model', () => {
  it('uses canonical izzi-smart by default', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ choices: [{ message: { content: 'reply' } }] }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ choices: [{ message: { content: '{}' } }] }),
      });
    vi.stubGlobal('fetch', fetchMock);
    const agent = new GraphAgent({ getApiKey: () => 'test-only-izzi-key' } as never);

    await agent.chat({
      node: { id: 'node-1', title: 'Root', type: 'topic' } as never,
      ancestors: [],
      message: 'hello',
    });

    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.model).toBe('izzi-smart');
  });
});
