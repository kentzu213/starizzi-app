/**
 * Graph Workspace store (Zustand) — state for the AI Branching Graph Workspace.
 *
 * Holds the node/edge graph, the selected node, and per-node chat transcripts.
 * Branch creation/positioning uses the PURE helpers in types/graph-workspace so
 * the logic stays testable. Seeded with a small starter tree so the canvas is
 * never empty on first view.
 */
import { create } from 'zustand';
import {
  createBranchNode,
  createBranchEdge,
  createNodeId,
  type BranchIntent,
  type BranchClassification,
  type WorkspaceEdge,
  type WorkspaceMessage,
  type WorkspaceNode,
} from '../types/graph-workspace';

interface GraphWorkspaceState {
  nodes: WorkspaceNode[];
  edges: WorkspaceEdge[];
  selectedNodeId: string | null;
  messagesByNode: Record<string, WorkspaceMessage[]>;
  /** Below-threshold branch suggestions awaiting user confirmation. */
  suggestions: BranchClassification[];

  selectNode: (id: string | null) => void;
  setNodePosition: (id: string, x: number, y: number) => void;
  updateNode: (id: string, patch: Partial<Pick<WorkspaceNode, 'title' | 'summary' | 'body' | 'tags'>>) => void;
  addBranch: (parentId: string, intent: BranchIntent) => string | null;
  appendMessage: (nodeId: string, role: WorkspaceMessage['role'], content: string) => WorkspaceMessage | null;
  getMessages: (nodeId: string) => WorkspaceMessage[];
  addSuggestion: (s: BranchClassification) => void;
  dismissSuggestion: (index: number) => void;
  acceptSuggestion: (index: number) => void;
  getNode: (id: string) => WorkspaceNode | undefined;
}

function nowIso() {
  return new Date().toISOString();
}

/** Build the seeded starter tree (a root + a few classified branches). */
function seed(): { nodes: WorkspaceNode[]; edges: WorkspaceEdge[]; messages: Record<string, WorkspaceMessage[]> } {
  const t = nowIso();
  const root: WorkspaceNode = {
    id: 'node-root',
    type: 'root',
    title: 'Khởi đầu khám phá',
    summary: 'Node gốc của không gian tri thức. Chat để đào sâu, AI sẽ tự tách nhánh khi xuất hiện chủ đề mới.',
    body: 'Chọn một node để mở workspace. Gõ /branch <ý tưởng> để tạo nhánh thủ công, hoặc cứ chat — agent sẽ đề xuất nhánh.',
    tags: ['seed'],
    parentId: null,
    x: 0,
    y: 0,
    provenance: { parentId: null, sourceMessageId: null, agent: null, createdAt: t },
    createdAt: t,
    updatedAt: t,
  };

  const children: Array<BranchIntent & { id: string }> = [
    { id: 'node-s1', title: 'Phiên: Lên ý tưởng', nodeType: 'session', summary: 'Phiên làm việc đầu tiên.', tags: ['session'] },
    { id: 'node-q1', title: 'Câu hỏi: Bắt đầu từ đâu?', nodeType: 'question', summary: 'Hướng đào sâu mở.', tags: ['question'] },
    { id: 'node-i1', title: 'Insight: Cây tri thức phân nhánh', nodeType: 'insight', summary: 'Mỗi nhánh giữ ngữ cảnh từ tổ tiên.', tags: ['insight'] },
  ];

  const nodes: WorkspaceNode[] = [root];
  const edges: WorkspaceEdge[] = [];
  children.forEach((c, i) => {
    const child = createBranchNode(root, c, i, t);
    child.id = c.id; // stable seed ids
    nodes.push(child);
    edges.push(createBranchEdge(root.id, child.id));
  });

  const messages: Record<string, WorkspaceMessage[]> = {
    'node-root': [
      {
        id: createNodeId('msg'),
        nodeId: 'node-root',
        role: 'assistant',
        content: 'Đây là node gốc. Hỏi bất cứ điều gì để bắt đầu — khi xuất hiện chủ đề con, mình sẽ tạo nhánh mới.',
        createdAt: t,
      },
    ],
  };

  return { nodes, edges, messages };
}

const seeded = seed();

export const useGraphWorkspaceStore = create<GraphWorkspaceState>((set, get) => ({
  nodes: seeded.nodes,
  edges: seeded.edges,
  selectedNodeId: 'node-root',
  messagesByNode: seeded.messages,
  suggestions: [],

  selectNode: (id) => set({ selectedNodeId: id }),

  setNodePosition: (id, x, y) =>
    set((state) => ({
      nodes: state.nodes.map((n) => (n.id === id ? { ...n, x, y, updatedAt: nowIso() } : n)),
    })),

  updateNode: (id, patch) =>
    set((state) => ({
      nodes: state.nodes.map((n) => (n.id === id ? { ...n, ...patch, updatedAt: nowIso() } : n)),
    })),

  addBranch: (parentId, intent) => {
    const parent = get().nodes.find((n) => n.id === parentId);
    if (!parent) return null;
    const siblingCount = get().edges.filter((e) => e.sourceId === parentId).length;
    const child = createBranchNode(parent, intent, siblingCount);
    const edge = createBranchEdge(parentId, child.id);
    set((state) => ({
      nodes: [...state.nodes, child],
      edges: [...state.edges, edge],
      selectedNodeId: child.id,
    }));
    return child.id;
  },

  appendMessage: (nodeId, role, content) => {
    const text = content.trim();
    if (!text) return null;
    const msg: WorkspaceMessage = {
      id: createNodeId('msg'),
      nodeId,
      role,
      content: text,
      createdAt: nowIso(),
    };
    set((state) => {
      const prev = Object.hasOwn(state.messagesByNode, nodeId) ? state.messagesByNode[nodeId] : [];
      return { messagesByNode: { ...state.messagesByNode, [nodeId]: [...prev, msg] } };
    });
    return msg;
  },

  getMessages: (nodeId) => {
    const map = get().messagesByNode;
    return Object.hasOwn(map, nodeId) ? map[nodeId] : [];
  },

  addSuggestion: (s) => set((state) => ({ suggestions: [...state.suggestions, s] })),

  dismissSuggestion: (index) =>
    set((state) => ({ suggestions: state.suggestions.filter((_, i) => i !== index) })),

  acceptSuggestion: (index) => {
    const s = get().suggestions[index];
    if (!s) return;
    get().addBranch(s.parentNodeId, {
      title: s.title,
      summary: s.summary,
      nodeType: s.nodeType,
      tags: s.tags,
    });
    set((state) => ({ suggestions: state.suggestions.filter((_, i) => i !== index) }));
  },

  getNode: (id) => get().nodes.find((n) => n.id === id),
}));
