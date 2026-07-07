import { afterEach, describe, expect, it, vi } from 'vitest';

describe('ManagedAgentProvider mock mode', () => {
  afterEach(() => {
    delete process.env.STARIZZI_MOCK_AGENT_MODE;
    vi.resetModules();
  });

  it('streams assistant text plus task and memory artifacts', async () => {
    process.env.STARIZZI_MOCK_AGENT_MODE = 'true';
    const { ManagedAgentProvider } = await import('./managed-agent-provider');

    const provider = new ManagedAgentProvider({
      getAccessToken: async () => 'mock-token',
    });

    const events = [];
    for await (const event of provider.streamChat({
      sessionId: 'session-1',
      message: 'Hoan tat smoke validation',
      history: [],
    })) {
      events.push(event);
    }

    expect(events.some((event) => event.type === 'assistant_delta')).toBe(true);
    expect(events.some((event) => event.type === 'task_upsert')).toBe(true);
    expect(events.some((event) => event.type === 'memory_upsert')).toBe(true);
    expect(events.at(-1)).toMatchObject({ type: 'assistant_done' });
    // The cold dynamic import() after vi.resetModules() can exceed vitest's 5s
    // default under parallel-test / CI load (module transform cost), causing a
    // spurious timeout. The mock path itself is fast — just give it headroom.
  }, 20000);
});
