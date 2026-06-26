import React, { useEffect, useState } from 'react';
import type { GraphNode } from '../../shared/graph-types';

/**
 * Read-only display row projected from the backend GraphNode. We copy only the
 * own properties we render (id, title, nodeType) — using the backend field
 * names and never following the prototype chain (Req 1.6, 9.3).
 */
type KnowledgeNodeRow = Pick<GraphNode, 'id' | 'title'> & { nodeType?: string };

type PageState = 'loading' | 'empty' | 'ready';

/**
 * Knowledge/Graph page — read-only shell.
 *
 * Feature-detects graph data via `window.electronAPI?.graph?.list?.()`.
 * If available: displays a read-only list of graph nodes (title + type).
 * If unavailable: shows empty state + CTA to open izziapi.com/aibase/graph.
 *
 * Token-only styling (Req 11.4). No write surface without auth (Req 11.3).
 *
 * Validates: Req 11.3, 11.4
 */
export function KnowledgePage() {
  const [nodes, setNodes] = useState<KnowledgeNodeRow[]>([]);
  const [state, setState] = useState<PageState>('loading');

  useEffect(() => {
    let cancelled = false;

    async function loadGraph() {
      setState('loading');
      setNodes([]);

      try {
        // Feature-detect: electronAPI?.graph?.list must exist and be callable
        const listFn = window.electronAPI?.graph?.list;
        if (typeof listFn !== 'function') {
          setState('empty');
          return;
        }

        const raw = await listFn();
        if (cancelled) return;

        if (!Array.isArray(raw) || raw.length === 0) {
          setState('empty');
          return;
        }

        // Own-property access only — no prototype-chain traversal
        const safe: KnowledgeNodeRow[] = [];
        for (const item of raw) {
          if (item != null && typeof item === 'object' && Object.hasOwn(item, 'id') && Object.hasOwn(item, 'title')) {
            safe.push({
              id: String(item.id),
              title: String(item.title),
              nodeType: Object.hasOwn(item, 'nodeType') ? String(item.nodeType) : undefined,
            });
          }
        }

        if (cancelled) return;

        if (safe.length === 0) {
          setState('empty');
        } else {
          setNodes(safe);
          setState('ready');
        }
      } catch {
        // API unavailable or errored — show empty state, no throw.
        if (!cancelled) {
          setState('empty');
        }
      }
    }

    void loadGraph();
    return () => {
      cancelled = true;
    };
  }, []);

  function handleOpenGraph() {
    const openExternal = window.electronAPI?.system?.openExternal;
    if (typeof openExternal === 'function') {
      openExternal('https://izziapi.com/aibase/graph');
    } else {
      window.open('https://izziapi.com/aibase/graph', '_blank', 'noopener');
    }
  }

  return (
    <div className="knowledge-page">
      <div className="page-header">
        <h1 className="page-header__title">Knowledge Graph</h1>
        <p className="page-header__subtitle">
          Tri thức và đồ thị kết nối — đọc từ izziapi.com.
        </p>
      </div>

      {state === 'loading' && (
        <div className="knowledge-page__loading" aria-busy="true">
          Đang tải…
        </div>
      )}

      {state === 'empty' && (
        <div className="knowledge-page__empty">
          <p className="knowledge-page__empty-text">
            Xem tri thức và đồ thị tại izziapi.com
          </p>
          <button
            type="button"
            className="knowledge-page__cta"
            onClick={handleOpenGraph}
          >
            Mở Knowledge Graph
          </button>
        </div>
      )}

      {state === 'ready' && (
        <ul className="knowledge-page__list">
          {nodes.map((node) => (
            <li key={node.id} className="knowledge-page__node">
              <span className="knowledge-page__node-title">{node.title}</span>
              {node.nodeType && (
                <span className="knowledge-page__node-type">{node.nodeType}</span>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
