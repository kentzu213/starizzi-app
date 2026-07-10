import { describe, it, expect } from 'vitest';
import { buildSelfInstallPrompt } from './agent-self-install-prompt';

describe('buildSelfInstallPrompt', () => {
  it('addresses a tool as an extension and mentions its local backend', () => {
    const p = buildSelfInstallPrompt({ kind: 'tool', id: 'ext-social-auto-poster', displayName: 'Social Auto Poster' });
    expect(p).toContain('tiện ích (extension) "Social Auto Poster"');
    expect(p).toContain('backend cục bộ');
    expect(p).toContain('CÀI ĐẶT');
  });

  it('addresses an agent as an agent', () => {
    const p = buildSelfInstallPrompt({ kind: 'agent', id: 'hermes', displayName: 'Hermes Agent', runtime: 'local' });
    expect(p).toContain('agent "Hermes Agent"');
    expect(p).toContain('Docker');
  });

  it('notes that izzi-runtime agents are always ready (no install)', () => {
    const p = buildSelfInstallPrompt({ kind: 'agent', id: 'socrates', displayName: 'Socrates', runtime: 'izzi' });
    expect(p).toContain('Izzi API');
    expect(p).not.toContain('pull/run Docker');
  });

  it('always includes the loop steps (assess → act → verify → retry)', () => {
    const p = buildSelfInstallPrompt({ kind: 'agent', id: 'x', displayName: 'X' });
    expect(p).toContain('assess → act → verify → retry');
    expect(p).toMatch(/1\./);
    expect(p).toMatch(/Xác minh/);
    expect(p).toContain('vòng lặp');
  });

  it('appends a context hint when provided', () => {
    const p = buildSelfInstallPrompt({ kind: 'agent', id: 'x', displayName: 'X', setupHint: 'Cần token Telegram + Zalo OA' });
    expect(p).toContain('Gợi ý bối cảnh: Cần token Telegram + Zalo OA');
  });

  it('is deterministic (same target → same prompt)', () => {
    const t = { kind: 'tool' as const, id: 'a', displayName: 'A' };
    expect(buildSelfInstallPrompt(t)).toBe(buildSelfInstallPrompt(t));
  });

  it('falls back to a safe name when displayName is empty', () => {
    const p = buildSelfInstallPrompt({ kind: 'agent', id: 'x', displayName: '' });
    expect(p).toContain('mục tiêu');
  });
});
