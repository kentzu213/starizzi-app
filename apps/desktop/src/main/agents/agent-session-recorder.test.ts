import { describe, it, expect } from 'vitest';
import { buildSessionTask } from './agent-session-recorder';

const base = {
  agentId: 'hermes',
  agentName: 'Hermes',
  request: 'Đăng bài\ndòng 2',
  reply: 'Đã xong',
  startedAt: '2026-01-01T00:00:00Z',
  finishedAt: '2026-01-01T00:01:00Z',
  turnId: 'gw-assistant-42',
};

describe('buildSessionTask', () => {
  it('marks the task done with a stable id from turnId, unbound from chat_sessions (FK safety)', () => {
    const t = buildSessionTask(base);
    expect(t.id).toBe('agent-session--gw-assistant-42');
    expect(t.status).toBe('done');
    expect(t.title).toContain('Hermes');
    expect(t.title).toContain('Đăng bài');
    expect(t.summary).toContain('Đã xong');
    expect(t.sourceMessageId).toBe('gw-assistant-42');
    expect(t.sessionId).toBeUndefined();
    expect(t.createdAt).toBe(base.startedAt);
    expect(t.updatedAt).toBe(base.finishedAt);
  });

  it('falls back to an agent+time id when turnId is missing', () => {
    const t = buildSessionTask({ ...base, turnId: undefined });
    expect(t.id).toBe('agent-session--hermes-2026-01-01T00:01:00Z');
    expect(t.sourceMessageId).toBeUndefined();
  });

  it('clips a long title and summary', () => {
    const t = buildSessionTask({ ...base, request: 'x'.repeat(200), reply: 'y'.repeat(500) });
    expect(t.title.length).toBeLessThanOrEqual(81);
    expect((t.summary ?? '').length).toBeLessThanOrEqual(241);
  });
});
