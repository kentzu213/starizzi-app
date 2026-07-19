import { describe, it, expect } from 'vitest';
import { MODEL_PROVIDERS, TOP_AGENTS } from './agent-registry';

describe('Izzi model contract', () => {
  it('defaults to canonical izzi-smart and offers explicit Grok 4.5 High', () => {
    const izzi = MODEL_PROVIDERS.find((provider) => provider.id === 'izzi');
    expect(izzi).toBeDefined();
    expect(izzi!.models[0]).toMatchObject({ id: 'izzi-smart', checked: true });
    expect(izzi!.models).toContainEqual(
      expect.objectContaining({ id: 'grok-4.5-high', provider: 'izzi' }),
    );
  });
});

describe('izzi-native agents (Socrates, Orchestrator)', () => {
  for (const id of ['socrates', 'orchestrator']) {
    it(`${id} is registered as an izzi-native agent`, () => {
      const a = TOP_AGENTS.find((x) => x.id === id);
      expect(a).toBeDefined();
      expect(a!.runtime).toBe('izzi');
      expect(a!.setupMethod).toBe('izzi');
      expect((a!.systemPrompt ?? '').length).toBeGreaterThan(40);
      expect(a!.supportedProviders).toContain('izzi');
    });
  }

  it('izzi-native agents carry no docker image / local port (run via Izzi API)', () => {
    const izzi = TOP_AGENTS.filter((a) => a.runtime === 'izzi');
    expect(izzi.length).toBeGreaterThanOrEqual(2);
    for (const a of izzi) {
      expect(a.dockerImage).toBeUndefined();
      expect(a.defaultPort).toBe(0);
    }
  });

  it('local (Docker) agents are unaffected — still have a port', () => {
    const openclaw = TOP_AGENTS.find((a) => a.id === 'openclaw');
    expect(openclaw?.runtime ?? 'local').not.toBe('izzi');
    expect(openclaw!.defaultPort).toBeGreaterThan(0);
  });
});
