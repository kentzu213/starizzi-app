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
import { buildUniverseSeed } from '../../shared/universe-adapter';
import {
  branchCreateInput,
  isSeedNode,
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
  /** Status of the "Nạp Vũ trụ tri thức" seed overlay load. */
  universeStatus: 'idle' | 'loading' | 'error' | 'ready';
  /** Number of read-only universe seed nodes currently overlaid. */
  seedCount: number;
  selectedNodeId: string | null;
  messagesByNode: Record<string, WorkspaceMessage[]>;
  suggestions: BranchClassification[];

  refresh: () => Promise<void>;
  loadUniverse: () => Promise<void>;
  adoptSeed: (seedId: string) => Promise<string | null>;
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

/**
 * Demo universe (bridge absent / browser dev) — a small community graph run
 * through the REAL adapter so the "Nạp Vũ trụ tri thức" button works in dev
 * smoke tests exactly as it does in Electron.
 */
function demoUniverse(): { nodes: GraphNode[]; links: GraphLink[] } {
  return buildUniverseSeed({
    success: true,
    data: {
      nodes: [
        { id: 'core', name: 'AI Knowledge', color: '#7c4dff', type: 'core', group: 'core' },
        { id: 'ai-agent', name: 'AI Agent', color: '#5ca7ff', type: 'topic', group: 'ai-agent', topicId: 'ai-agent' },
        { id: 'prompt', name: 'Prompt Engineering', color: '#22dcc2', type: 'topic', group: 'prompt', topicId: 'prompt' },
        { id: 'rag', name: 'RAG', color: '#ffc45c', type: 'topic', group: 'rag', topicId: 'rag' },
        { id: 'ai-agent--multi', name: 'Multi-Agent', type: 'child', group: 'ai-agent', topicId: 'ai-agent' },
        { id: 'ai-agent--memory', name: 'Memory & Context', type: 'child', group: 'ai-agent', topicId: 'ai-agent' },
        { id: 'prompt--cot', name: 'Chain of Thought', type: 'child', group: 'prompt', topicId: 'prompt' },
        { id: 'rag--vector', name: 'Vector Search', type: 'child', group: 'rag', topicId: 'rag' },
        { id: 'cnode--a1', name: 'Bài: Agentic workflow', type: 'article', group: 'ai-agent', topicId: 'ai-agent' },
        { id: 'cnode--a2', name: 'Bài: RAG nâng cao', type: 'article', group: 'rag', topicId: 'rag' },
      ],
      links: [
        { source: 'core', target: 'ai-agent' },
        { source: 'core', target: 'prompt' },
        { source: 'core', target: 'rag' },
        { source: 'ai-agent', target: 'ai-agent--multi' },
        { source: 'ai-agent', target: 'ai-agent--memory' },
        { source: 'prompt', target: 'prompt--cot' },
        { source: 'rag', target: 'rag--vector' },
        { source: 'ai-agent', target: 'cnode--a1' },
        { source: 'rag', target: 'cnode--a2' },
      ],
    },
  });
}

export const useGraphWorkspaceStore = create<GraphWorkspaceState>((set, get) => ({
  nodes: [],
  links: [],
  status: 'idle',
  bridge: false,
  universeStatus: 'idle',
  seedCount: 0,
  selectedNodeId: null,
  messagesByNode: {},
  suggestions: [],

  refresh: async () => {
    const graph = window.electronAPI?.graph;
    if (!graph) {
      const seeds = get().nodes.filter(isSeedNode);
      const seedLinks = get().links.filter((l) => l.id.startsWith('useed-'));
      const demo = seedDemo();
      const current = get().selectedNodeId;
      const nodes = [...demo.nodes, ...seeds];
      set({
        nodes,
        links: [...demo.links, ...seedLinks],
        messagesByNode: { ...demo.messages, ...get().messagesByNode },
        bridge: false,
        status: 'ready',
        selectedNodeId: current && nodes.some((n) => n.id === current) ? current : demo.nodes[0]?.id ?? null,
      });
      return;
    }

    set({ status: 'loading', bridge: true });
    try {
      const [nodes, links] = await Promise.all([graph.list(), graph.links()]);
      const safeNodes = Array.isArray(nodes) ? nodes : [];
      const safeLinks = Array.isArray(links) ? links : [];
      // Preserve any loaded universe seed overlay across a refresh.
      const seeds = get().nodes.filter(isSeedNode);
      const seedLinks = get().links.filter((l) => l.id.startsWith('useed-'));
      const merged = [...safeNodes, ...seeds];
      const current = get().selectedNodeId;
      set({
        nodes: merged,
        links: [...safeLinks, ...seedLinks],
        status: merged.length > 0 ? 'ready' : 'empty',
        selectedNodeId:
          current && merged.some((n) => n.id === current) ? current : safeNodes[0]?.id ?? null,
      });
    } catch {
      set({ status: 'error' });
    }
  },

  loadUniverse: async () => {
    set({ universeStatus: 'loading' });
    const graph = window.electronAPI?.graph;
    let seed: { nodes: GraphNode[]; links: GraphLink[] };
    try {
      seed = graph?.universe ? await graph.universe() : demoUniverse();
    } catch {
      set({ universeStatus: 'error' });
      return;
    }
    const safe = seed && Array.isArray(seed.nodes) ? seed : { nodes: [], links: [] };
    if (safe.nodes.length === 0) {
      set({ universeStatus: 'error' });
      return;
    }
    // Replace any prior seed overlay; keep the user's OWNED nodes/links.
    set((s) => {
      const owned = s.nodes.filter((n) => !isSeedNode(n));
      const ownedLinks = s.links.filter((l) => !l.id.startsWith('useed-'));
      return {
        nodes: [...owned, ...safe.nodes],
        links: [...ownedLinks, ...safe.links],
        status: 'ready',
        universeStatus: 'ready',
        seedCount: safe.nodes.length,
      };
    });
  },

  /**
   * "Adopt" a read-only seed into the user's OWNED graph so they can work on it.
   * Creates exactly one `user_node` (carrying the universe origin in metadata),
   * replaces the seed in-place, and selects it. The rest of the seed overlay
   * stays. No bulk copy; the existing branch/chat flow then runs on this owned node.
   */
  adoptSeed: async (seedId) => {
    const seed = get().nodes.find((n) => n.id === seedId);
    if (!seed || !isSeedNode(seed)) return null;
    const meta = metaClone(seed);
    const adoptMeta: Record<string, unknown> = {
      summary: typeof meta.summary === 'string' ? meta.summary : '',
      tags: Array.isArray(meta.tags) ? meta.tags.filter((t) => typeof t === 'string') : [],
      source: 'universe',
      universeId: typeof meta.universeId === 'string' ? meta.universeId : seedId,
      provenance: { parentId: null, sourceMessageId: null, agent: 'universe', createdAt: nowIso() },
    };
    const x = (seed.x ?? 0) + 40;
    const y = (seed.y ?? 0) + 40;
    const ownedLocal = (id: string): GraphNode => ({
      id,
      title: seed.title,
      nodeType: 'session',
      color: NODE_TYPE_COLORS.session,
      content: '',
      x,
      y,
      metadata: adoptMeta,
      createdAt: nowIso(),
      updatedAt: nowIso(),
    });
    const replaceSeedWith = (owned: GraphNode) => {
      set((s) => ({
        nodes: [...s.nodes.filter((n) => n.id !== seedId), owned],
        links: s.links.filter((l) => l.sourceId !== seedId && l.targetId !== seedId),
        selectedNodeId: owned.id,
        status: 'ready',
      }));
    };

    const graph = window.electronAPI?.graph;
    if (!graph) {
      const owned = ownedLocal(newId('demo-node'));
      replaceSeedWith(owned);
      return owned.id;
    }

    const created = await graph.create({
      title: seed.title,
      nodeType: 'session',
      color: NODE_TYPE_COLORS.session,
      content: '',
      x,
      y,
      metadata: adoptMeta,
    });
    if (!created || 'error' in created) return null;
    replaceSeedWith(ownedLocal(created.id));
    return created.id;
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
