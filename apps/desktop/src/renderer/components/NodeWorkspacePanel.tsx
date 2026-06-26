import React, { useMemo, useRef, useState } from 'react';
import { useGraphWorkspaceStore } from '../store/graphWorkspace';
import { runNodeAgent, BRANCH_AUTOCREATE_THRESHOLD } from '../services/graphAgent';
import { nodeTypeMeta, parseCommand, type WorkspaceNode } from '../types/graph-workspace';

/**
 * Floating, non-blocking workspace panel for the selected node: node content +
 * an AI chat scoped to the node. Supports /branch, /summarize, /merge and
 * auto-creates child nodes when the agent's branch classifier is confident.
 * On small screens it becomes a full-height drawer (see .gw-panel CSS).
 */
export function NodeWorkspacePanel() {
  const selectedNodeId = useGraphWorkspaceStore((s) => s.selectedNodeId);
  const nodes = useGraphWorkspaceStore((s) => s.nodes);
  const messagesByNode = useGraphWorkspaceStore((s) => s.messagesByNode);
  const suggestions = useGraphWorkspaceStore((s) => s.suggestions);
  const selectNode = useGraphWorkspaceStore((s) => s.selectNode);
  const addBranch = useGraphWorkspaceStore((s) => s.addBranch);
  const appendMessage = useGraphWorkspaceStore((s) => s.appendMessage);
  const updateNode = useGraphWorkspaceStore((s) => s.updateNode);
  const acceptSuggestion = useGraphWorkspaceStore((s) => s.acceptSuggestion);
  const dismissSuggestion = useGraphWorkspaceStore((s) => s.dismissSuggestion);

  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [pinned, setPinned] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const node = useMemo(
    () => nodes.find((n) => n.id === selectedNodeId) ?? null,
    [nodes, selectedNodeId],
  );

  const ancestors = useMemo(() => {
    if (!node) return [] as WorkspaceNode[];
    const chain: WorkspaceNode[] = [];
    let current = node.parentId;
    const guard = new Set<string>();
    while (current && !guard.has(current)) {
      guard.add(current);
      const parent = nodes.find((n) => n.id === current);
      if (!parent) break;
      chain.unshift(parent);
      current = parent.parentId;
    }
    return chain;
  }, [node, nodes]);

  if (!node) return null;

  const meta = nodeTypeMeta[node.type];
  const messages = Object.hasOwn(messagesByNode, node.id) ? messagesByNode[node.id] : [];
  const nodeSuggestions = suggestions
    .map((s, index) => ({ s, index }))
    .filter((x) => x.s.parentNodeId === node.id);

  async function handleSend() {
    if (!node || busy) return;
    const parsed = parseCommand(draft);
    const text = parsed.arg;

    if (parsed.command === 'branch') {
      if (text) {
        addBranch(node.id, { title: text, nodeType: 'question', agent: 'manual', sourceMessageId: null });
        appendMessage(node.id, 'system', `🌿 Đã tạo nhánh: ${text}`);
      }
      setDraft('');
      return;
    }
    if (parsed.command === 'summarize') {
      const basis = node.summary || node.body || messages.map((m) => m.content).slice(-4).join(' ');
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

    // Normal chat turn.
    if (!text) return;
    appendMessage(node.id, 'user', text);
    setDraft('');
    setBusy(true);
    try {
      const result = await runNodeAgent(node, ancestors, text);
      appendMessage(node.id, 'assistant', result.reply);
      const c = result.classification;
      if (c?.shouldCreateBranch) {
        if (c.confidence >= BRANCH_AUTOCREATE_THRESHOLD) {
          addBranch(node.id, {
            title: c.title,
            summary: c.summary,
            nodeType: c.nodeType,
            tags: c.tags,
            agent: 'izzi',
          });
          appendMessage(node.id, 'system', `🌿 Tự tạo nhánh (${c.nodeType}): ${c.title}`);
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

  return (
    <aside className={`gw-panel ${pinned ? 'gw-panel--pinned' : ''}`} aria-label="Workspace của node">
      <header className="gw-panel__head">
        <span className={`gw-panel__badge gw-node--${node.type}`}>
          <span aria-hidden="true">{meta.icon}</span> {meta.label}
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
          <button
            type="button"
            className="gw-panel__icon-btn"
            title="Đóng"
            onClick={() => selectNode(null)}
          >
            ✕
          </button>
        </div>
      </header>

      <div className="gw-panel__content">
        <input
          className="gw-panel__title-input"
          value={node.title}
          onChange={(e) => updateNode(node.id, { title: e.target.value })}
          aria-label="Tiêu đề node"
        />
        {node.summary && <p className="gw-panel__summary">{node.summary}</p>}
        <textarea
          className="gw-panel__body"
          value={node.body}
          placeholder="Ghi chú / nội dung node…"
          onChange={(e) => updateNode(node.id, { body: e.target.value })}
          rows={3}
        />
        {node.tags.length > 0 && (
          <div className="gw-panel__tags">
            {node.tags.map((tag) => (
              <span key={tag} className="gw-panel__tag">#{tag}</span>
            ))}
          </div>
        )}
      </div>

      {nodeSuggestions.length > 0 && (
        <div className="gw-panel__suggestions">
          {nodeSuggestions.map(({ s, index }) => (
            <div key={index} className="gw-suggestion">
              <span className="gw-suggestion__text">
                Đề xuất nhánh ({s.nodeType}): <strong>{s.title}</strong>
              </span>
              <div className="gw-suggestion__actions">
                <button type="button" className="gw-panel__btn gw-panel__btn--accent" onClick={() => acceptSuggestion(index)}>
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
          <div className="gw-panel__chat-empty">Chat trong ngữ cảnh node này. Gõ /branch, /summarize, /merge.</div>
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
          disabled={busy}
          placeholder={busy ? 'Đang xử lý…' : 'Nhắn cho agent… (/branch, /summarize)'}
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
          disabled={busy || !draft.trim()}
          onClick={() => void handleSend()}
        >
          Gửi
        </button>
      </footer>
    </aside>
  );
}
