import { describe, it, expect } from 'vitest';
import { sanitizeStoredSessions, capForPersist, pickActiveId } from './gatewayPersist';

const msg = (over: Record<string, unknown> = {}) => ({
  id: 'm1',
  sessionId: 's1',
  agentId: 'hermes',
  role: 'user',
  content: 'hi',
  state: 'done',
  createdAt: '2026-01-01T00:00:00Z',
  ...over,
});

const sess = (over: Record<string, unknown> = {}) => ({
  id: 's1',
  agentId: 'hermes',
  agentName: 'Hermes',
  agentIcon: '⚡',
  messages: [msg()],
  model: 'gpt-5.5',
  provider: 'custom',
  createdAt: '2026-01-01T00:00:00Z',
  isActive: true,
  ...over,
});

describe('sanitizeStoredSessions', () => {
  it('restores a valid session with its messages', () => {
    const out = sanitizeStoredSessions([sess()]);
    expect(out).toHaveLength(1);
    expect(out[0].id).toBe('s1');
    expect(out[0].messages).toHaveLength(1);
  });

  it('drops non-objects and sessions missing id or agentId', () => {
    expect(sanitizeStoredSessions([null, 42, {}, { id: 'x' }, { agentId: 'y' }])).toEqual([]);
  });

  it('normalizes an interrupted streaming/pending message to done', () => {
    const out = sanitizeStoredSessions([
      sess({ messages: [msg({ state: 'streaming' }), msg({ id: 'm2', state: 'pending' })] }),
    ]);
    expect(out[0].messages.map((m) => m.state)).toEqual(['done', 'done']);
  });

  it('keeps reasoning + valid steps, drops malformed steps', () => {
    const out = sanitizeStoredSessions([
      sess({
        messages: [
          msg({
            role: 'assistant',
            reasoning: 'think',
            steps: [{ id: 'a', label: 'tool', status: 'done' }, { bad: true }],
          }),
        ],
      }),
    ]);
    expect(out[0].messages[0].reasoning).toBe('think');
    expect(out[0].messages[0].steps).toHaveLength(1);
  });

  it('returns [] for non-array input', () => {
    expect(sanitizeStoredSessions(null)).toEqual([]);
    expect(sanitizeStoredSessions({})).toEqual([]);
  });
});

describe('capForPersist', () => {
  it('caps messages per session to the newest 200', () => {
    const many = Array.from({ length: 250 }, (_, i) => msg({ id: `m${i}` }));
    const out = capForPersist([sess({ messages: many }) as never]);
    expect(out[0].messages).toHaveLength(200);
    expect(out[0].messages[0].id).toBe('m50');
  });
});

describe('pickActiveId', () => {
  it('returns the last active session id', () => {
    const out = sanitizeStoredSessions([sess({ id: 'a', isActive: false }), sess({ id: 'b', isActive: true, createdAt: '2026-01-02T00:00:00Z' })]);
    expect(pickActiveId(out)).toBe('b');
  });

  it('falls back to the newest when none active', () => {
    const out = sanitizeStoredSessions([
      sess({ id: 'a', isActive: false }),
      sess({ id: 'b', isActive: false, createdAt: '2026-01-02T00:00:00Z' }),
    ]);
    expect(pickActiveId(out)).toBe('b');
  });

  it('returns null for empty', () => {
    expect(pickActiveId([])).toBeNull();
  });
});
