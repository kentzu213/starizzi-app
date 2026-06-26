import { afterEach, describe, expect, it, vi } from 'vitest';
import { GraphClient } from './graph-client';
import type { AuthManager } from '../auth/auth-manager';
import type { DatabaseManager } from '../db/database';

/**
 * Feature: desktop-graph-backend-sync — GraphClient HTTP layer (Phase 1).
 * Validates: Requirements 1.4, 1.5, 2.1, 2.2, 2.3, 2.6, 6.4, 7.3, 9.2, 9.5
 *
 * `fetch` is stubbed; AuthManager and DatabaseManager are faked. No network.
 */

const TOKEN = 'test-jwt-SUPERSECRET-do-not-leak-abc123';

/** Fake AuthManager whose `getAccessToken()` resolves to the given token. */
function fakeAuth(token: string | null): AuthManager {
  return { getAccessToken: vi.fn().mockResolvedValue(token) } as unknown as AuthManager;
}

type FakeDb = DatabaseManager & { appendDiagnosticEvent: ReturnType<typeof vi.fn> };

/** Fake DatabaseManager exposing a spy on `appendDiagnosticEvent`. */
function fakeDb(): FakeDb {
  return { appendDiagnosticEvent: vi.fn() } as unknown as FakeDb;
}

/** Build a minimal fetch-Response-like object. */
function jsonResponse(status: number, body: unknown) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  };
}

/** A backend node shape that maps to a non-null GraphNode. */
function backendNode(overrides: Record<string, unknown> = {}) {
  return {
    id: 'n1',
    title: 'Hello',
    nodeType: 'note',
    color: '#5ca7ff',
    createdAt: '2025-01-01T00:00:00Z',
    updatedAt: '2025-01-01T00:00:00Z',
    ...overrides,
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('GraphClient', () => {
  // ── No token: fail-closed (Req 1.4, 9.5) ──────────────────────────────

  it('listNodes returns [] and does NOT call the backend when there is no token (Req 1.4)', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const client = new GraphClient(fakeAuth(null), fakeDb());
    const result = await client.listNodes();

    expect(result).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('createNode fails closed with { error } and no backend call when there is no token (Req 9.5)', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const client = new GraphClient(fakeAuth(null), fakeDb());
    const result = await client.createNode({ title: 'Hello' });

    expect(result).toHaveProperty('error');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  // ── 401: fail-closed, no anonymous retry (Req 9.5) ────────────────────

  it('createNode returns { error: "unauthorized" } on 401 without retrying (Req 9.5)', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(401, { error: 'Unauthorized' }));
    vi.stubGlobal('fetch', fetchMock);

    const client = new GraphClient(fakeAuth(TOKEN), fakeDb());
    const result = await client.createNode({ title: 'Hello' });

    expect(result).toEqual({ error: 'unauthorized' });
    expect(fetchMock).toHaveBeenCalledTimes(1); // no anonymous retry
  });

  it('updateNode returns { error: "unauthorized" } on 401 (Req 9.5)', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(401, { error: 'Unauthorized' }));
    vi.stubGlobal('fetch', fetchMock);

    const client = new GraphClient(fakeAuth(TOKEN), fakeDb());
    const result = await client.updateNode('n1', { title: 'x' });

    expect(result).toEqual({ error: 'unauthorized' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  // ── Network error: [] + token-free diagnostic (Req 1.5, 9.2) ──────────

  it('listNodes returns [] and logs a diagnostic with NO token on network error (Req 1.5, 9.2)', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error('network down'));
    vi.stubGlobal('fetch', fetchMock);

    const db = fakeDb();
    const client = new GraphClient(fakeAuth(TOKEN), db);
    const result = await client.listNodes();

    expect(result).toEqual([]);
    expect(db.appendDiagnosticEvent).toHaveBeenCalledTimes(1);

    const event = db.appendDiagnosticEvent.mock.calls[0][0];
    // The entire diagnostic payload must never contain the token (Req 9.2).
    expect(JSON.stringify(event)).not.toContain(TOKEN);
  });

  // ── Empty title guard (Req 2.2) ───────────────────────────────────────

  it('createNode rejects an empty / whitespace title before any backend call (Req 2.2)', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const client = new GraphClient(fakeAuth(TOKEN), fakeDb());
    const result = await client.createNode({ title: '   ' });

    expect(result).toHaveProperty('error');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  // ── Success path: token only in the Authorization header (Req 6.4, 7.3) ─

  it('sends Authorization: Bearer over an https base and never leaks the token elsewhere (Req 6.4, 7.3)', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { node: backendNode() }));
    vi.stubGlobal('fetch', fetchMock);

    const client = new GraphClient(fakeAuth(TOKEN), fakeDb());
    const result = await client.createNode({ title: 'Hello', nodeType: 'note', color: '#5ca7ff' });

    expect(result).toEqual(backendNode());

    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toMatch(/^https:\/\//);
    expect((init.headers as Record<string, string>).Authorization).toBe(`Bearer ${TOKEN}`);
    // The token must appear ONLY in the header — never in the URL or body.
    expect(String(url)).not.toContain(TOKEN);
    expect(String(init.body ?? '')).not.toContain(TOKEN);
  });

  // ── Write bodies contain only whitelist fields (Req 2.1, 2.3) ─────────

  it('POST body contains only create-whitelist fields and drops server-owned keys (Req 2.1)', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { node: backendNode() }));
    vi.stubGlobal('fetch', fetchMock);

    const client = new GraphClient(fakeAuth(TOKEN), fakeDb());
    await client.createNode({
      title: 'T',
      nodeType: 'note',
      color: '#fff',
      content: 'c',
      url: 'https://example.com',
      topicId: 'top',
      x: 1,
      y: 2,
      metadata: { a: 1 },
      // server-owned — must be dropped:
      id: 'should-drop',
      parentId: 'should-drop',
      createdAt: 'should-drop',
      updatedAt: 'should-drop',
    });

    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(Object.keys(body).sort()).toEqual(
      ['color', 'content', 'metadata', 'nodeType', 'title', 'topicId', 'url', 'x', 'y'].sort(),
    );
    for (const serverOwned of ['id', 'parentId', 'createdAt', 'updatedAt']) {
      expect(body).not.toHaveProperty(serverOwned);
    }
  });

  it('PATCH body contains only patch-whitelist fields (Req 2.3)', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { ok: true }));
    vi.stubGlobal('fetch', fetchMock);

    const client = new GraphClient(fakeAuth(TOKEN), fakeDb());
    const result = await client.updateNode('n1', {
      title: 'New title',
      isPublic: true,
      // server-owned — must be dropped:
      id: 'should-drop',
      createdAt: 'should-drop',
      updatedAt: 'should-drop',
    });

    expect(result).toEqual({ ok: true });
    const [, init] = fetchMock.mock.calls[0];
    expect(init.method).toBe('PATCH');
    expect(JSON.parse(init.body)).toEqual({ title: 'New title', isPublic: true });
  });

  // ── Permission rejection passes through (Req 2.6) ─────────────────────

  it('passes a backend permission rejection (403) through to the caller (Req 2.6)', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(403, { error: 'Forbidden: not your node' }));
    vi.stubGlobal('fetch', fetchMock);

    const client = new GraphClient(fakeAuth(TOKEN), fakeDb());
    const result = await client.updateNode('n1', { title: 'x' });

    expect(result).toEqual({ error: 'Forbidden: not your node' });
  });
});
