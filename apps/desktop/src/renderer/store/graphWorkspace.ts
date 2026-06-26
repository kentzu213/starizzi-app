/**
 * Graph Workspace store (Zustand) — backed by the SHARED /api/aibase graph
 * (decision B). Nodes/links/positions persist to the backend via the
 * `electronAPI.graph` bridge (token stays in main); the workspace is just a
 * native editor/visualiser over the same second-brain graph the web renders.
 *
 * Node/link writes go to the backend. Per-node chat transcripts + pending branch
 * suggestions are local UI state (the backend has no message endpoint, and we add
 * none — decision B). Branch provenance/summary/tags ride in `GraphNode.metadata`.
 *
 * When the bridge is absent (browser dev / not in Electron), a small demo graph
 * is seeded so the canvas renders; demo writes stay local. In Electron with auth,
 * the real graph loads and every branch is a real `user_node` + `user_link`.
 */
import { create } from 'zustand';
import type { GraphNode, GraphLink } from '../../shared/graph-types';
import {
  branchCreateInput,
  NODE_TYPE_COLORS,
  type BranchClassification,
  type BranchIntent,
  type WorkspaceMessage,
} from '../types/graph-workspace';

type Status = 'idle' | 'loading' | 'ready' | 'empty' | 'error';

interface GraphWorkspaceState {
  nodes: GraphNode[];
  links: GraphLink[];
  status: Status;
  /** True once a real backend bridge has served data; false in demo mode. */
  bridge: boolean;
  selectedNodeId: string | null;
  messagesByNode: Record<string, WorkspaceMessage[]>;
  suggestions: BranchClassification[];

  refresh: () => Promise<void>;
  selectNode: (id: string | null) => void;
  setNodePosition: (id: string, x: number, y: number) => void;
  updateNodeContent: (
    id: string,
    patch: { title?: string; summary?: string; body?: string; tags?: string[] },
  ) => void;
  branch: (parentId: string, intent: BranchIntent) => Promise<string | null>;
  appendMessage: (nodeId: string, role: WorkspaceMessage['role'], content: string) => WorkspaceMessage | null;
  getMessages: (nodeId: string) => WorkspaceMessage[];
  getNode: (id: string) => GraphNode | undefined;
  addSuggestion: (s: BranchClassification) => void;
  dismissSuggestion: (index: number) => void;
  acceptSuggestion: (index: number) => Promise<void>;
}

function nowIso() {
  return new Date().toISOString();
}

function newId(prefix: string) {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `${prefix}-${crypto.randomUUID()}`;
  }
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

// ── Debounced backend persistence (avoids hammering SQLite/HTTP on drag/typing) ──
const persistTimers = new Map<string, ReturnType<typeof setTimeout>>();
function debouncePersist(key: string, fn: () => void, ms = 600) {
  const existing = persistTimers.get(key);
  if (existing) clearTimeout(existing);
  persistTimers.set(key, setTimeout(fn, ms));
}

/** Own-property metadata clone (no prototype-chain) for safe merge. */
function metaClone(node: GraphNode): Record<string, unknown> {
  const m = node.metadata;
  if (m === null || typeof m !== 'object' || Array.isArray(m)) return {};
  const out: Record<string, unknown> = {};
  for (const k of Object.keys(m)) if (Object.hasOwn(m, k)) out[k] = (m as Record<string, unknown>)[k];
  return out;
}

/** Demo graph (bridge absent): a root + a few classified branches. */
function seedDemo(): { nodes: GraphNode[]; links: GraphLink[]; messages: Record<string, WorkspaceMessage[]> } {
  const t = nowIso();
  const mk = (
    id: string,
    title: string,
    type: keyof typeof NODE_TYPE_COLORS,
    x: number,
    y: number,
    summary: string,
    parentId: string | null,
  ): GraphNode => ({
    id,
    title,
    nodeType: type,
    color: NODE_TYPE_COLORS[type],
    content: '',
    x,
    y,
    metadata: {
      summary,
      tags: [type],
      provenance: { parentId, sourceMessageId: null, agent: null, createdAt: t },
    },
    createdAt: t,
    updatedAt: t,
  });

  const nodes: GraphNode[] = [
    mk('demo-root', 'Khởi đầu khám phá', 'root', 0, 0, 'Node gốc — chat để đào sâu, AI sẽ tách nhánh.', null),
    mk('demo-s1', 'Phiên: Lên ý tưởng', 'session', 280, -96, 'Phiên làm việc đầu tiên.', 'demo-root'),
    mk('demo-q1', 'Câu hỏi: Bắt đầu từ đâu?', 'question', 280, 0, 'Hướng đào sâu mở.', 'demo-root'),
    mk('demo-i1', 'Insight: Cây tri thức phân nhánh', 'insight', 280, 96, 'Nhánh con kế thừa ngữ cảnh tổ tiên.', 'demo-root'),
  ];
  const links: GraphLink[] = [
    { id: 'demo-l1', sourceId: 'demo-root', targetId: 'demo-s1', type: 'branch' } as GraphLink,
    { id: 'demo-l2', sourceId: 'demo-root', targetId: 'demo-q1', type: 'branch' } as GraphLink,
    { id: 'demo-l3', sourceId: 'demo-root', targetId: 'demo-i1', type: 'branch' } as GraphLink,
  ];
  const messages: Record<string, WorkspaceMessage[]> = {
    'demo-root': [
      {
        id: newId('msg'),
        nodeId: 'demo-root',
        role: 'assistant',
        content: 'Đây là node gốc (chế độ demo — chưa đăng nhập). Đăng nhập trong app để dùng graph thật của bạn.',
        createdAt: t,
      },
    ],
  };
  return { nodes, links, messages };
}

export const useGraphWorkspaceStore = create<GraphWorkspaceState>((set, get) => ({
  nodes: [],
  links: [],
  status: 'idle',
  bridge: false,
  selectedNodeId: null,
  messagesByNode: {},
  suggestions: [],

  refresh: async () => {
    const graph = window.electronAPI?.graph;
    if (!graph) {
      const demo = seedDemo();
      const current = get().selectedNodeId;
      set({
        nodes: demo.nodes,
        links: demo.links,
        messagesByNode: { ...demo.messages, ...get().messagesByNode },
        bridge: false,
        status: 'ready',
        selectedNodeId: current && demo.nodes.some((n) => n.id === current) ? current : demo.nodes[0]?.id ?? null,
      });
      return;
    }

    set({ status: 'loading', bridge: true });
    try {
      const [nodes, links] = await Promise.all([graph.list(), graph.links()]);
      const safeNodes = Array.isArray(nodes) ? nodes : [];
      const safeLinks = Array.isArray(links) ? links : [];
      const current = get().selectedNodeId;
      set({
        nodes: safeNodes,
        links: safeLinks,
        status: safeNodes.length > 0 ? 'ready' : 'empty',
        selectedNodeId:
          current && safeNodes.some((n) => n.id === current) ? current : safeNodes[0]?.id ?? null,
      });
    } catch {
      set({ status: 'error' });
    }
  },

  selectNode: (id) => set({ selectedNodeId: id }),

  setNodePosition: (id, x, y) => {
    set((s) => ({ nodes: s.nodes.map((n) => (n.id === id ? { ...n, x, y } : n)) }));
    const graph = window.electronAPI?.graph;
    if (!graph) return;
    debouncePersist(`pos-${id}`, () => {
      void graph.update(id, { x, y });
    });
  },

  updateNodeContent: (id, patch) => {
    const node = get().nodes.find((n) => n.id === id);
    if (!node) return;
    const meta = metaClone(node);
    if (patch.summary !== undefined) meta.summary = patch.summary;
    if (patch.tags !== undefined) meta.tags = patch.tags;
    const nextLocal: GraphNode = {
      ...node,
      ...(patch.title !== undefined ? { title: patch.title } : {}),
      ...(patch.body !== undefined ? { content: patch.body } : {}),
      metadata: meta,
      updatedAt: nowIso(),
    };
    set((s) => ({ nodes: s.nodes.map((n) => (n.id === id ? nextLocal : n)) }));

    const graph = window.electronAPI?.graph;
    if (!graph) return;
    const gpatch: Partial<GraphNode> = { metadata: meta };
    if (patch.title !== undefined) gpatch.title = patch.title;
    if (patch.body !== undefined) gpatch.content = patch.body;
    debouncePersist(`upd-${id}`, () => {
      void graph.update(id, gpatch);
    });
  },

  branch: async (parentId, intent) => {
    const parent = get().nodes.find((n) => n.id === parentId);
    if (!parent) return null;
    const siblingCount = get().links.filter((l) => l.sourceId === parentId).length;
    const payload = branchCreateInput(parent, intent, siblingCount);
    const graph = window.electronAPI?.graph;

    if (!graph) {
      // Demo mode: add locally (no backend).
      const id = newId('demo-node');
      const child: GraphNode = {
        id,
        title: payload.title,
        nodeType: payload.nodeType,
        color: payload.color,
        content: payload.content ?? '',
        x: payload.x,
        y: payload.y,
        metadata: payload.metadata,
        createdAt: nowIso(),
        updatedAt: nowIso(),
      };
      const link = { id: newId('demo-link'), sourceId: parentId, targetId: id, type: 'branch' } as GraphLink;
      set((s) => ({ nodes: [...s.nodes, child], links: [...s.links, link], selectedNodeId: id }));
      return id;
    }

    const created = await graph.create({
      title: payload.title,
      nodeType: payload.nodeType,
      color: payload.color,
      content: payload.content,
      x: payload.x,
      y: payload.y,
      metadata: payload.metadata,
    });
    if (!created || 'error' in created) return null;
    await graph.createLink(parentId, created.id, intent.nodeType ?? 'branch');
    await get().refresh();
    set({ selectedNodeId: created.id });
    return created.id;
  },

  appendMessage: (nodeId, role, content) => {
    const text = content.trim();
    if (!text) return null;
    const msg: WorkspaceMessage = { id: newId('msg'), nodeId, role, content: text, createdAt: nowIso() };
    set((s) => {
      const prev = Object.hasOwn(s.messagesByNode, nodeId) ? s.messagesByNode[nodeId] : [];
      return { messagesByNode: { ...s.messagesByNode, [nodeId]: [...prev, msg] } };
    });
    return msg;
  },

  getMessages: (nodeId) => {
    const map = get().messagesByNode;
    return Object.hasOwn(map, nodeId) ? map[nodeId] : [];
  },

  getNode: (id) => get().nodes.find((n) => n.id === id),

  addSuggestion: (s) => set((state) => ({ suggestions: [...state.suggestions, s] })),

  dismissSuggestion: (index) =>
    set((state) => ({ suggestions: state.suggestions.filter((_, i) => i !== index) })),

  acceptSuggestion: async (index) => {
    const s = get().suggestions[index];
    if (!s) return;
    set((state) => ({ suggestions: state.suggestions.filter((_, i) => i !== index) }));
    await get().branch(s.parentNodeId, {
      title: s.title,
      summary: s.summary,
      nodeType: s.nodeType,
      tags: s.tags,
      agent: 'izzi',
    });
  },
}));
