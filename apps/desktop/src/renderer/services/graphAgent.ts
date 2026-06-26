/**
 * Graph agent service — runs one exploration turn for a node and decides whether
 * a child branch should be created. Operates on the shared `GraphNode` model.
 *
 * Two concerns are kept separate (per spec):
 *  1. the chat reply shown to the user, and
 *  2. an internal branch-intent classification (JSON).
 *
 * If the Izzi provider is wired (via `window.electronAPI.graphAgent`, next
 * increment), this delegates to the main process (token stays in main). Until
 * then it falls back to a transparent local heuristic so the UI is functional.
 */
import {
  BRANCH_AUTOCREATE_THRESHOLD,
  type BranchClassification,
  type WorkspaceNodeType,
} from '../types/graph-workspace';
import type { GraphNode } from '../../shared/graph-types';

export interface AgentTurnResult {
  reply: string;
  classification: BranchClassification | null;
}

interface GraphAgentBridge {
  chat?: (payload: {
    node: GraphNode;
    ancestors: GraphNode[];
    message: string;
  }) => Promise<{ reply?: string; classification?: BranchClassification | null }>;
}

function bridge(): GraphAgentBridge | undefined {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (window as any).electronAPI?.graphAgent;
}

/** Whether the real Izzi-backed agent bridge is available. */
export function isAgentConfigured(): boolean {
  return typeof bridge()?.chat === 'function';
}

export async function runNodeAgent(
  node: GraphNode,
  ancestors: GraphNode[],
  userText: string,
): Promise<AgentTurnResult> {
  const api = bridge();
  if (typeof api?.chat === 'function') {
    try {
      const res = await api.chat({ node, ancestors, message: userText });
      if (res && typeof res.reply === 'string' && res.reply.length > 0) {
        return { reply: res.reply, classification: res.classification ?? null };
      }
    } catch {
      // fall through to the local heuristic — never throw to the UI
    }
  }
  return localTurn(node, userText);
}

/**
 * Local, transparent fallback when Izzi isn't configured. Echoes the input and
 * runs a lightweight keyword heuristic to demonstrate branching. NOT a substitute
 * for the LLM — clearly labelled so the user knows to configure Izzi.
 */
function localTurn(node: GraphNode, userText: string): AgentTurnResult {
  const reply =
    `Chưa cấu hình Izzi API nên đây là phản hồi cục bộ. Ghi nhận trong ngữ cảnh "${node.title}": ` +
    `${userText}\n\n(Đặt OPENAI_BASE_URL=https://api.izziapi.com/v1 + OPENAI_API_KEY=izzi-... để bật chat AI thật.)`;
  return { reply, classification: heuristicClassify(node, userText) };
}

/** Keyword heuristic → a branch classification (stand-in for the LLM classifier). */
export function heuristicClassify(node: GraphNode, text: string): BranchClassification | null {
  const t = text.trim();
  if (t.length < 8) return null;
  const lower = t.toLowerCase();

  let nodeType: Exclude<WorkspaceNodeType, 'root'> | null = null;
  if (t.includes('?') || /\b(tại sao|làm sao|thế nào|why|how|what)\b/.test(lower)) nodeType = 'question';
  else if (/\b(task|todo|cần làm|việc cần|action)\b/.test(lower)) nodeType = 'task';
  else if (/\b(ý tưởng|insight|nhận ra|hoá ra|key point)\b/.test(lower)) nodeType = 'insight';
  else if (/\b(file|tài liệu|artifact|bản|document|code)\b/.test(lower)) nodeType = 'artifact';

  if (!nodeType) return null;

  const title = t.length > 48 ? `${t.slice(0, 45)}…` : t;
  return {
    shouldCreateBranch: true,
    parentNodeId: node.id,
    title,
    summary: t.length > 160 ? `${t.slice(0, 157)}…` : t,
    nodeType,
    reason: `Heuristic phát hiện chủ đề dạng "${nodeType}".`,
    tags: [nodeType],
    confidence: nodeType === 'question' || nodeType === 'task' ? 0.7 : 0.6,
  };
}

export { BRANCH_AUTOCREATE_THRESHOLD };
