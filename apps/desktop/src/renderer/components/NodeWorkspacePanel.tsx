import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useGraphWorkspaceStore } from '../store/graphWorkspace';
import { runNodeAgent, BRANCH_AUTOCREATE_THRESHOLD } from '../services/graphAgent';
import {
  nodeTypeMeta,
  nodeViewType,
  nodeSummary,
  nodeTags,
  nodeProvenance,
  isSeedNode,
  universeIdOf,
  universeTypeOf,
  parseCommand,
} from '../types/graph-workspace';
import type { GraphNode } from '../../shared/graph-types';
import type { UniverseNodeDetail } from '../../shared/universe-adapter';

/**
 * Floating, non-blocking workspace panel for the selected node: node content +
 * an AI chat scoped to the node, over the SHARED graph (decision B). Branching
 * creates real backend nodes/links. Supports /branch, /summarize, /merge and
 * auto-creates child nodes when the agent's classifier is confident. On small
 * screens it becomes a full-height drawer (see .gw-panel CSS).
 */
export function NodeWorkspacePanel() {
  const selectedNodeId = useGraphWorkspaceStore((s) => s.selectedNodeId);
  const nodes = useGraphWorkspaceStore((s) => s.nodes);
  const links = useGraphWorkspaceStore((s) => s.links);
  const messagesByNode = useGraphWorkspaceStore((s) => s.messagesByNode);
  const suggestions = useGraphWorkspaceStore((s) => s.suggestions);
  const selectNode = useGraphWorkspaceStore((s) => s.selectNode);
  const branch = useGraphWorkspaceStore((s) => s.branch);
  const appendMessage = useGraphWorkspaceStore((s) => s.appendMessage);
  const updateNodeContent = useGraphWorkspaceStore((s) => s.updateNodeContent);
  const acceptSuggestion = useGraphWorkspaceStore((s) => s.acceptSuggestion);
  const dismissSuggestion = useGraphWorkspaceStore((s) => s.dismissSuggestion);
  const adoptSeed = useGraphWorkspaceStore((s) => s.adoptSeed);

  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [adopting, setAdopting] = useState(false);
  const [pinned, setPinned] = useState(false);
  const [detail, setDetail] = useState<UniverseNodeDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const node = useMemo(
    () => nodes.find((n) => n.id === selectedNodeId) ?? null,
    [nodes, selectedNodeId],
  );

  const ancestors = useMemo(() => {
    if (!node) return [] as GraphNode[];
    const chain: GraphNode[] = [];
    const guard = new Set<string>();
    let current = nodeProvenance(node)?.parentId ?? null;
    while (current && !guard.has(current)) {
      guard.add(current);
      const parent = nodes.find((n) => n.id === current);
      if (!parent) break;
      chain.unshift(parent);
      current = nodeProvenance(parent)?.parentId ?? null;
    }
    return chain;
  }, [node, nodes]);

  // Nodes directly linked to the selected one (web "Chủ đề liên quan" parity).
  const related = useMemo(() => {
    if (!node) return [] as GraphNode[];
    const linked = new Set<string>();
    for (const l of links) {
      if (l.sourceId === node.id) linked.add(l.targetId);
      else if (l.targetId === node.id) linked.add(l.sourceId);
    }
    return nodes.filter((n) => linked.has(n.id)).slice(0, 8);
  }, [node, links, nodes]);

  // Fetch the REAL detail (content/url) for an article/community seed node from
  // the public node-detail endpoint, so the panel shows actual content not just a title.
  useEffect(() => {
    setDetail(null);
    setDetailLoading(false);
    if (!node || !isSeedNode(node)) return undefined;
    const utype = universeTypeOf(node);
    const looksArticle =
      utype === 'article' || node.id.startsWith('cnode--') || node.id.startsWith('article--');
    const api = window.electronAPI?.graph;
    if (!looksArticle || typeof api?.nodeDetail !== 'function') return undefined;
    let cancelled = false;
    setDetailLoading(true);
    void api
      .nodeDetail(universeIdOf(node) ?? node.id)
      .then((d) => {
        if (!cancelled) setDetail(d);
      })
      .catch(() => {
        if (!cancelled) setDetail(null);
      })
      .finally(() => {
        if (!cancelled) setDetailLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [node]);

  if (!node) return null;

  const type = nodeViewType(node);
  const meta = nodeTypeMeta[type];
  const summary = nodeSummary(node);
  const tags = nodeTags(node);
  const seed = isSeedNode(node);
  const messages = Object.hasOwn(messagesByNode, node.id) ? messagesByNode[node.id] : [];
  const nodeSuggestions = suggestions
    .map((s, index) => ({ s, index }))
    .filter((x) => x.s.parentNodeId === node.id);

  /**
   * The node any chat/branch action should operate on. For an OWNED node that's
   * the node itself; for a read-only SEED node we transparently adopt it into the
   * user's graph first (create one `user_node`) so the conversation + branches
   * persist. This is what makes clicking a universe/topic node "just work" —
   * chat opens and replies in context, no dead end.
   */
  async function resolveWorkingNode(): Promise<GraphNode | null> {
    if (!node) return null;
    if (!seed) return node;
    const ownedId = await adoptSeed(node.id);
    if (!ownedId) return null;
    return useGraphWorkspaceStore.getState().getNode(ownedId) ?? null;
  }

  async function handleSend() {
    if (!node || busy || adopting) return;
    const parsed = parseCommand(draft);
    const text = parsed.arg;

    // Local-only commands operate on the current node id (no adopt needed).
    if (parsed.command === 'summarize') {
      const basis = summary || node.content || messages.map((m) => m.content).slice(-4).join(' ');
      appendMessage(node.id, 'system', `📝 Tóm tắt "${node.title}": ${basis || '(chưa có nội dung)'}`);
      setDraft('');
      return;
    }
    if (parsed.command === 'merge') {
      const parentTitle = ancestors.length ? ancestors[ancestors.length - 1].title : 'node gốc';
      appendMessage(node.id, 'system', `🔀 Ghi chú merge về "${parentTitle}": ${text || node.title}`);
      setDraft('');
      return;
    }

    if (parsed.command === 'branch') {
      if (!text) return;
      setDraft('');
      setBusy(true);
      try {
        const target = await resolveWorkingNode();
        if (!target) {
          appendMessage(node.id, 'system', '⚠️ Không tạo được nhánh (cần đăng nhập / kết nối).');
          return;
        }
        const id = await branch(target.id, { title: text, nodeType: 'question', agent: 'manual' });
        if (id) appendMessage(target.id, 'system', `🌿 Đã tạo nhánh: ${text}`);
        else appendMessage(target.id, 'system', '⚠️ Không tạo được nhánh (cần đăng nhập / kết nối).');
      } finally {
        setBusy(false);
      }
      return;
    }

    // Normal chat turn — adopt the seed first so the reply + any branch persist.
    if (!text) return;
    setDraft('');
    setBusy(true);
    try {
      const target = await resolveWorkingNode();
      if (!target) {
        appendMessage(node.id, 'system', '⚠️ Cần đăng nhập để chat với node này.');
        return;
      }
      const userMsg = appendMessage(target.id, 'user', text);
      const targetAncestors = seed ? [] : ancestors;
      const result = await runNodeAgent(target, targetAncestors, text);
      appendMessage(target.id, 'assistant', result.reply);
      const c = result.classification;
      if (c?.shouldCreateBranch) {
        if (c.confidence >= BRANCH_AUTOCREATE_THRESHOLD) {
          const id = await branch(target.id, {
            title: c.title,
            summary: c.summary,
            nodeType: c.nodeType,
            tags: c.tags,
            sourceMessageId: userMsg?.id ?? null,
            agent: 'izzi',
          });
          if (id) appendMessage(target.id, 'system', `🌿 Tự tạo nhánh (${c.nodeType}): ${c.title}`);
        } else {
          useGraphWorkspaceStore.getState().addSuggestion(c);
        }
      }
    } finally {
      setBusy(false);
    }
  }

  function startManualBranch() {
    setDraft('/branch ');
    inputRef.current?.focus();
  }

  async function handleAdopt() {
    if (!node || adopting) return;
    setAdopting(true);
    try {
      await adoptSeed(node.id);
    } finally {
      setAdopting(false);
    }
  }

  function focusChat() {
    inputRef.current?.focus();
  }

  function openExternal(url: string) {
    const fn = window.electronAPI?.shell?.openExternal;
    if (typeof fn === 'function') void fn(url);
    else window.open(url, '_blank', 'noopener');
  }

  function handleOpenDocs() {
    openExternal(detail?.url || 'https://izziapi.com/aibase/graph');
  }

  return (
    <aside
      className={`gw-panel ${seed ? 'gw-panel--seed' : ''} ${pinned ? 'gw-panel--pinned' : ''}`}
      aria-label="Workspace của node"
    >
      <header className="gw-panel__head">
        <span className={`gw-panel__badge gw-node--${type}`}>
          <span aria-hidden="true">{meta.icon}</span> {meta.label}
          {seed && <span className="gw-panel__seed-tag">· Vũ trụ tri thức</span>}
        </span>
        <div className="gw-panel__head-actions">
          <button
            type="button"
            className="gw-panel__icon-btn"
            aria-pressed={pinned}
            title={pinned ? 'Bỏ ghim' : 'Ghim'}
            onClick={() => setPinned((v) => !v)}
          >
            📌
          </button>
          <button type="button" className="gw-panel__icon-btn" title="Đóng" onClick={() => selectNode(null)}>
            ✕
          </button>
        </div>
      </header>

      <div className="gw-panel__content">
        {seed ? (
          <h3 className="gw-panel__seed-title">{node.title}</h3>
        ) : (
          <input
            className="gw-panel__title-input"
            value={node.title}
            onChange={(e) => updateNodeContent(node.id, { title: e.target.value })}
            aria-label="Tiêu đề node"
          />
        )}
        {summary && <p className="gw-panel__summary">{summary}</p>}
        {!seed && (
          <textarea
            className="gw-panel__body"
            value={node.content ?? ''}
            placeholder="Ghi chú / nội dung node…"
            onChange={(e) => updateNodeContent(node.id, { body: e.target.value })}
            rows={3}
          />
        )}
        {tags.length > 0 && (
          <div className="gw-panel__tags">
            {tags.map((tag) => (
              <span key={tag} className="gw-panel__tag">#{tag}</span>
            ))}
          </div>
        )}
        {related.length > 0 && (
          <div className="gw-panel__related">
            <h4 className="gw-panel__related-title">Liên quan</h4>
            {related.map((r) => (
              <button
                key={r.id}
                type="button"
                className="gw-panel__related-row"
                onClick={() => selectNode(r.id)}
                title={r.title}
              >
                <span aria-hidden="true">{nodeTypeMeta[nodeViewType(r)].icon}</span>
                <span className="gw-panel__related-name">{r.title}</span>
              </button>
            ))}
          </div>
        )}
        {seed && (
          <>
            {detailLoading && <p className="gw-panel__summary">Đang tải nội dung…</p>}
            {detail?.content && <p className="gw-panel__detail">{detail.content}</p>}
            {detail?.access === 'preview' && (
              <p className="gw-panel__seed-note">🔒 Node trả phí — mở trên web để xem đầy đủ.</p>
            )}
            <div className="gw-panel__actions">
              <button type="button" className="gw-panel__action" onClick={focusChat}>
                💬 Mở chat
              </button>
              <button type="button" className="gw-panel__action" onClick={handleOpenDocs}>
                📄 Xem tài liệu
              </button>
            </div>
            <p className="gw-panel__seed-note">
              Node từ vũ trụ tri thức cộng đồng. Chat ngay bên dưới để khám phá — node sẽ tự thành
              của bạn, hoặc bấm để tạo node làm việc.
            </p>
            <button
              type="button"
              className="gw-panel__btn gw-panel__btn--accent gw-panel__adopt"
              disabled={adopting || busy}
              onClick={() => void handleAdopt()}
            >
              {adopting ? 'Đang tạo…' : '🚀 Bắt đầu làm việc từ node này'}
            </button>
          </>
        )}
      </div>

      {!seed && nodeSuggestions.length > 0 && (
        <div className="gw-panel__suggestions">
          {nodeSuggestions.map(({ s, index }) => (
            <div key={index} className="gw-suggestion">
              <span className="gw-suggestion__text">
                Đề xuất nhánh ({s.nodeType}): <strong>{s.title}</strong>
              </span>
              <div className="gw-suggestion__actions">
                <button type="button" className="gw-panel__btn gw-panel__btn--accent" onClick={() => void acceptSuggestion(index)}>
                  Tạo
                </button>
                <button type="button" className="gw-panel__btn" onClick={() => dismissSuggestion(index)}>
                  Bỏ
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="gw-panel__chat">
        {messages.length === 0 ? (
          <div className="gw-panel__chat-empty">
            {seed
              ? 'Chat để khám phá node này. AI trả lời trong ngữ cảnh node; node sẽ tự thành của bạn.'
              : 'Chat trong ngữ cảnh node này. Gõ /branch, /summarize, /merge.'}
          </div>
        ) : (
          messages.map((m) => (
            <div key={m.id} className={`gw-msg gw-msg--${m.role}`}>
              {m.content}
            </div>
          ))
        )}
      </div>

      <footer className="gw-panel__footer">
        <button type="button" className="gw-panel__btn" onClick={startManualBranch} title="Tạo nhánh thủ công">
          + Nhánh
        </button>
        <input
          ref={inputRef}
          className="gw-panel__input"
          value={draft}
          disabled={busy || adopting}
          placeholder={busy || adopting ? 'Đang xử lý…' : 'Nhắn cho agent… (/branch, /summarize)'}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              void handleSend();
            }
          }}
        />
        <button
          type="button"
          className="gw-panel__btn gw-panel__btn--accent"
          disabled={busy || adopting || !draft.trim()}
          onClick={() => void handleSend()}
        >
          Gửi
        </button>
      </footer>
    </aside>
  );
}
