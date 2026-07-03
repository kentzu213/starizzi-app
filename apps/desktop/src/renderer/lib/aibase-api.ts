/**
 * Desktop bridge for the AIBase graph API — a drop-in mirror of the web
 * `izzi-web/src/lib/aibase-api.ts` so the ported KnowledgeUniverse page can call
 * the SAME function names and the SAME `{ data, error, status }` envelope while
 * routing through the Electron `window.electronAPI.graph` bridge (JWT stays in
 * main). The backend is the single source of truth for both web and desktop.
 *
 * Parity contract: every export here matches the web module's signature and
 * return shape. The desktop IPC methods return plain models (or `{ error }`),
 * which we re-wrap into the web `ApiResponse<T>` envelope.
 */

import type {
  GraphNode,
  GraphLink,
  GraphCommunity,
  GraphSearchHit,
} from '../../shared/graph-types';

// ── Web-identical types (mirror izzi-web/src/lib/aibase-api.ts) ──────────────

export type UserNode = {
  id: string;
  title: string;
  nodeType: string;
  content?: string | null;
  url?: string | null;
  metadata?: string | null;
  color: string;
  parentId?: string | null;
  topicId?: string | null;
  x?: number | null;
  y?: number | null;
  createdAt: string;
  updatedAt: string;
};

export type UserLink = {
  id: string;
  sourceId: string;
  targetId: string;
  label?: string | null;
  color?: string | null;
};

export type Community = {
  id: number;
  label: string;
  color: string;
  nodeIds: string[];
  size: number;
  centroid: { x: number; y: number } | null;
};

export type SearchHit = {
  id: string;
  title: string;
  nodeType: string;
  color: string;
  matchedField: string;
  matchSnippet: string;
  score: number;
  x: number | null;
  y: number | null;
};

/** Web-identical response envelope (mirror izzi-web/src/lib/api.ts). */
interface ApiResponse<T> {
  data: T | null;
  error: string | null;
  status?: number;
}

export const nodeTypeConfig: Record<
  string,
  { icon: string; label: string; defaultColor: string }
> = {
  note: { icon: '📝', label: 'Ghi chú', defaultColor: '#5ca7ff' },
  link: { icon: '🔗', label: 'Liên kết', defaultColor: '#a77cff' },
  github: { icon: '🐙', label: 'GitHub', defaultColor: '#45d982' },
  repo: { icon: '📦', label: 'Repository', defaultColor: '#ffb23f' },
  web: { icon: '🌐', label: 'Website', defaultColor: '#ff5f70' },
  video: { icon: '🎬', label: 'Video', defaultColor: '#ff6fb5' },
  article: { icon: '📄', label: 'Bài viết', defaultColor: '#5ca7ff' },
  'agent-session': { icon: '🧠', label: 'Phiên Agent', defaultColor: '#45d982' },
  topic: { icon: '🏷️', label: 'Chủ đề/Spec', defaultColor: '#5ca7ff' },
  'agent-memory-root': { icon: '🗂️', label: 'Bộ nhớ Agent', defaultColor: '#7c4dff' },
};

/** Graph topics — canonical aibase knowledge topics (ids match the backend). */
export const graphTopics: Array<{ id: string; title: string }> = [
  { id: 'ai-agent', title: 'AI Agent' },
  { id: 'claude', title: 'Claude' },
  { id: 'chatgpt', title: 'ChatGPT' },
  { id: 'rag', title: 'RAG' },
  { id: 'prompt', title: 'Prompt Engineering' },
  { id: 'ai-tools', title: 'AI Tools' },
];

// ── helpers ──────────────────────────────────────────────────────────────

/** The graph bridge surface (matches preload `electronAPI.graph`). */
function graph() {
  const api = (window as unknown as { electronAPI?: { graph?: Record<string, (...args: unknown[]) => Promise<unknown>> } })
    .electronAPI?.graph;
  if (!api) throw new Error('electronAPI.graph unavailable');
  return api as unknown as {
    list(): Promise<GraphNode[]>;
    links(): Promise<GraphLink[]>;
    create(input: Record<string, unknown>): Promise<GraphNode | { error: string }>;
    update(id: string, patch: Record<string, unknown>): Promise<{ ok: boolean } | { error: string }>;
    remove(id: string): Promise<{ ok: boolean; error?: string }>;
    createLink(sourceId: string, targetId: string, label?: string, color?: string): Promise<GraphLink | { error: string }>;
    updateLink(id: string, patch: { label?: string; color?: string }): Promise<GraphLink | { error: string }>;
    removeLink(id: string): Promise<{ ok: boolean; error?: string }>;
    search(query: string, limit?: number): Promise<GraphSearchHit[]>;
    communities(): Promise<GraphCommunity[]>;
    importUrl(url: string): Promise<{ title: string; description: string; nodeType: string; url: string; metadata: Record<string, unknown> } | { error: string }>;
    extractDocument(input: { url?: string; text?: string }): Promise<{
      nodes: Array<{ title: string; content: string; nodeType: string; color: string; level: number }>;
      links: Array<{ sourceIndex: number; targetIndex: number; label: string }>;
      title: string;
      isDuplicate?: boolean;
      warning?: string;
      crossLinks?: unknown[];
    } | { error: string }>;
    synthesizeTopic(input: { topic: string; rootTitle?: string; queries?: string[] }): Promise<{ ok: boolean; topic: string; rootTitle: string; milestones: number; nodesAdded: number; free?: boolean; charged?: number; balance?: number } | { error: string }>;
  };
}

function isErr(v: unknown): v is { error: string } {
  return v !== null && typeof v === 'object' && 'error' in v && typeof (v as { error: unknown }).error === 'string';
}

function ok<T>(data: T): ApiResponse<T> {
  return { data, error: null, status: 200 };
}

function fail<T>(error: string, status = 400): ApiResponse<T> {
  return { data: null, error, status };
}

/**
 * Normalize a desktop GraphNode (metadata is an object) into the web UserNode
 * (metadata is a JSON string), so the ported page's `JSON.parse(metadata)`
 * tag-extraction works unchanged.
 */
function toUserNode(n: GraphNode): UserNode {
  return {
    id: n.id,
    title: n.title,
    nodeType: n.nodeType,
    content: n.content ?? null,
    url: n.url ?? null,
    metadata: n.metadata != null ? JSON.stringify(n.metadata) : null,
    color: n.color,
    parentId: n.parentId ?? null,
    topicId: n.topicId ?? null,
    x: n.x ?? null,
    y: n.y ?? null,
    createdAt: n.createdAt,
    updatedAt: n.updatedAt,
  };
}

function toUserLink(l: GraphLink): UserLink {
  return {
    id: l.id,
    sourceId: l.sourceId,
    targetId: l.targetId,
    label: l.label ?? null,
    color: l.color ?? null,
  };
}

// ── API wrappers (web-identical signatures + envelope) ───────────────────────

/**
 * The desktop is always authenticated through main; there is no anonymous
 * graph. We surface a stable id so the page's `if (!meRes.data)` login-redirect
 * branch is effectively disabled (the desktop has its own auth gate).
 */
export async function fetchMe(): Promise<ApiResponse<{ id: string }>> {
  try {
    const user = await (window as unknown as { electronAPI?: { auth?: { getUser: () => Promise<unknown> } } })
      .electronAPI?.auth?.getUser?.();
    const id = user && typeof user === 'object' && 'id' in user ? String((user as { id: unknown }).id) : 'desktop';
    return ok({ id });
  } catch {
    // Desktop is gated by its own auth; never block the graph on this probe.
    return ok({ id: 'desktop' });
  }
}

export async function fetchNodes(): Promise<ApiResponse<{ nodes: UserNode[] }>> {
  try {
    const nodes = await graph().list();
    return ok({ nodes: nodes.map(toUserNode) });
  } catch (err) {
    return fail(err instanceof Error ? err.message : 'Lỗi tải nodes', 0);
  }
}

export async function fetchLinks(): Promise<ApiResponse<{ links: UserLink[] }>> {
  try {
    const links = await graph().links();
    return ok({ links: links.map(toUserLink) });
  } catch (err) {
    return fail(err instanceof Error ? err.message : 'Lỗi tải links', 0);
  }
}

/** Desktop has no contributions surface; return an empty stable shape. */
export async function fetchContributions(): Promise<ApiResponse<{ contributions: Array<{ status: string }> }>> {
  return ok({ contributions: [] });
}

export async function createNode(data: Record<string, unknown>): Promise<ApiResponse<{ node: { id: string } }>> {
  try {
    const res = await graph().create(data);
    if (isErr(res)) return fail(res.error);
    return ok({ node: { id: res.id } });
  } catch (err) {
    return fail(err instanceof Error ? err.message : 'Lỗi tạo node', 0);
  }
}

export async function updateNode(id: string, data: Record<string, unknown>): Promise<ApiResponse<{ node: UserNode | null }>> {
  try {
    const res = await graph().update(id, data);
    if (isErr(res)) return fail(res.error);
    return ok({ node: null });
  } catch (err) {
    return fail(err instanceof Error ? err.message : 'Lỗi cập nhật node', 0);
  }
}

export async function removeNode(id: string): Promise<ApiResponse<void>> {
  try {
    const res = await graph().remove(id);
    if (!res.ok) return fail(res.error ?? 'Lỗi xóa node');
    return ok(undefined as void);
  } catch (err) {
    return fail(err instanceof Error ? err.message : 'Lỗi xóa node', 0);
  }
}

export async function createLink(data: Record<string, unknown>): Promise<ApiResponse<{ link: UserLink }>> {
  try {
    const sourceId = String(data.sourceId ?? '');
    const targetId = String(data.targetId ?? '');
    const label = typeof data.label === 'string' ? data.label : undefined;
    const color = typeof data.color === 'string' ? data.color : undefined;
    const res = await graph().createLink(sourceId, targetId, label, color);
    if (isErr(res)) return fail(res.error);
    return ok({ link: toUserLink(res) });
  } catch (err) {
    return fail(err instanceof Error ? err.message : 'Lỗi tạo liên kết', 0);
  }
}

export async function updateLink(id: string, data: Record<string, unknown>): Promise<ApiResponse<{ link: UserLink }>> {
  try {
    const patch: { label?: string; color?: string } = {};
    if (typeof data.label === 'string') patch.label = data.label;
    if (typeof data.color === 'string') patch.color = data.color;
    const res = await graph().updateLink(id, patch);
    if (isErr(res)) return fail(res.error);
    return ok({ link: toUserLink(res) });
  } catch (err) {
    return fail(err instanceof Error ? err.message : 'Lỗi cập nhật liên kết', 0);
  }
}

export async function removeLink(id: string): Promise<ApiResponse<void>> {
  try {
    const res = await graph().removeLink(id);
    if (!res.ok) return fail(res.error ?? 'Lỗi xóa liên kết');
    return ok(undefined as void);
  } catch (err) {
    return fail(err instanceof Error ? err.message : 'Lỗi xóa liên kết', 0);
  }
}

export async function searchNodes(q: string, limit = 10): Promise<ApiResponse<{ results: SearchHit[] }>> {
  try {
    const results = await graph().search(q, limit);
    return ok({ results: results as SearchHit[] });
  } catch (err) {
    return fail(err instanceof Error ? err.message : 'Lỗi tìm kiếm', 0);
  }
}

export async function fetchCommunities(): Promise<ApiResponse<{ communities: Community[] }>> {
  try {
    const communities = await graph().communities();
    return ok({ communities: communities as Community[] });
  } catch (err) {
    return fail(err instanceof Error ? err.message : 'Lỗi tải clusters', 0);
  }
}

export async function importUrl(url: string): Promise<ApiResponse<{
  title: string;
  description: string;
  nodeType: string;
  url: string;
  metadata: Record<string, unknown>;
}>> {
  try {
    const res = await graph().importUrl(url);
    if (isErr(res)) return fail(res.error);
    return ok(res);
  } catch (err) {
    return fail(err instanceof Error ? err.message : 'Lỗi import URL', 0);
  }
}

export async function extractDocument(data: { url?: string; text?: string }): Promise<ApiResponse<{
  nodes: Array<{ title: string; content: string; nodeType: string; color: string; level: number }>;
  links: Array<{ sourceIndex: number; targetIndex: number; label: string }>;
  title: string;
  isDuplicate?: boolean;
  warning?: string;
  crossLinks?: unknown[];
}>> {
  try {
    const res = await graph().extractDocument(data);
    if (isErr(res)) return fail(res.error);
    return ok(res);
  } catch (err) {
    return fail(err instanceof Error ? err.message : 'Lỗi trích xuất', 0);
  }
}

export async function synthesizeTopic(input: { topic: string; rootTitle?: string; queries?: string[] }): Promise<ApiResponse<{
  ok: boolean;
  topic: string;
  rootTitle: string;
  milestones: number;
  nodesAdded: number;
  free?: boolean;
  charged?: number;
  balance?: number;
}>> {
  try {
    const res = await graph().synthesizeTopic(input);
    if (isErr(res)) return fail(res.error);
    return ok(res);
  } catch (err) {
    return fail(err instanceof Error ? err.message : 'Lỗi tạo lộ trình', 0);
  }
}

/**
 * PDF extraction. The desktop has no multipart PDF pipeline (no `graph:extractPdf`
 * IPC on the main bridge), so we satisfy the shared `GraphApi.extractPdf` contract
 * by throwing a friendly, localized error. MyGraphView catches this and surfaces
 * it inline, so PDF import is simply unavailable on desktop rather than broken.
 *
 * Note: this returns the RAW result (not the ApiResponse envelope) to match the
 * shared contract, which is the one method the web posts as multipart/form-data.
 */
export async function extractPdf(_file: File): Promise<{
  nodes: Array<{ title: string; content: string; nodeType: string; color: string; level: number; selected?: boolean }>;
  links: Array<{ sourceIndex: number; targetIndex: number; label: string }>;
  isDuplicate?: boolean;
  warning?: string;
  pageCount?: number;
  crossLinks?: unknown[];
}> {
  throw new Error('Import PDF chưa hỗ trợ trên bản desktop. Hãy dùng import từ URL hoặc dán văn bản.');
}
