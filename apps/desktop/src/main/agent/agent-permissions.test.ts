import { describe, expect, it } from 'vitest';
import {
  AgentPermissionStore,
  isPermissionMode,
  needsApproval,
  toolsEnabled,
} from './agent-permissions';

/** In-memory stand-in for DatabaseManager's settings table. */
function makeDb() {
  const store = new Map<string, string>();
  return {
    getSetting: (k: string) => (store.has(k) ? store.get(k)! : null),
    setSetting: (k: string, v: string) => {
      store.set(k, v);
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}

describe('agent-permissions', () => {
  it('isPermissionMode accepts only the three known modes', () => {
    expect(isPermissionMode('chat')).toBe(true);
    expect(isPermissionMode('agent')).toBe(true);
    expect(isPermissionMode('agent-full')).toBe(true);
    expect(isPermissionMode('nope')).toBe(false);
    expect(isPermissionMode(undefined)).toBe(false);
    expect(isPermissionMode(null)).toBe(false);
  });

  it('toolsEnabled is true only in the agent modes', () => {
    expect(toolsEnabled('chat')).toBe(false);
    expect(toolsEnabled('agent')).toBe(true);
    expect(toolsEnabled('agent-full')).toBe(true);
  });

  it('needsApproval: full never asks; agent asks only for risky; chat fails closed', () => {
    expect(needsApproval('agent-full', 'risky')).toBe(false);
    expect(needsApproval('agent-full', 'safe')).toBe(false);
    expect(needsApproval('agent', 'risky')).toBe(true);
    expect(needsApproval('agent', 'safe')).toBe(false);
    expect(needsApproval('chat', 'safe')).toBe(true);
    expect(needsApproval('chat', 'risky')).toBe(true);
  });

  it('store defaults to chat, round-trips a valid mode, and ignores an invalid one', () => {
    const db = makeDb();
    const s = new AgentPermissionStore(db);
    expect(s.getMode()).toBe('chat');
    s.setMode('agent');
    expect(s.getMode()).toBe('agent');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    s.setMode('bogus' as any);
    expect(s.getMode()).toBe('agent'); // unchanged
    s.setMode('agent-full');
    expect(s.getMode()).toBe('agent-full');
  });
});
