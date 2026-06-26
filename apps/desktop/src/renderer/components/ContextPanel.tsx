import React, { useEffect, useState } from 'react';
import { normalizeMemoryItems, type MemoryItem } from '../types/agent-memory';

interface ContextPanelProps {
  agentId: string | null;
}

type PanelState = 'loading' | 'empty' | 'ready';

/**
 * Read-only context/memory panel for the active agent.
 *
 * Feature-detects `window.electronAPI?.memory?.list?.(agentId)`.
 * If the API is unavailable or returns no data, shows an empty state.
 * Only displays title + source (no secrets/PII — Req 10.3).
 *
 * Validates: Req 10.1, 10.2, 10.3
 */
export function ContextPanel({ agentId }: ContextPanelProps) {
  const [items, setItems] = useState<MemoryItem[]>([]);
  const [state, setState] = useState<PanelState>('loading');

  useEffect(() => {
    let cancelled = false;

    async function loadMemory() {
      setState('loading');
      setItems([]);

      if (!agentId) {
        setState('empty');
        return;
      }

      try {
        // Feature-detect: electronAPI?.memory?.list must exist and be callable
        const listFn = window.electronAPI?.memory?.list;
        if (typeof listFn !== 'function') {
          setState('empty');
          return;
        }

        const raw = await listFn(agentId);
        if (cancelled) return;

        if (!Array.isArray(raw) || raw.length === 0) {
          setState('empty');
          return;
        }

        const normalized = normalizeMemoryItems(raw);
        if (cancelled) return;

        if (normalized.length === 0) {
          setState('empty');
        } else {
          setItems(normalized);
          setState('ready');
        }
      } catch {
        // API unavailable or errored — show empty state (Req 10.2), no throw.
        if (!cancelled) {
          setState('empty');
        }
      }
    }

    void loadMemory();
    return () => {
      cancelled = true;
    };
  }, [agentId]);

  return (
    <section className="aw-context" aria-label="Ngữ cảnh agent">
      <h3 className="aw-context__title">Ngữ cảnh</h3>

      {state === 'loading' && (
        <div className="aw-context__loading" aria-busy="true">
          Đang tải…
        </div>
      )}

      {state === 'empty' && (
        <div className="aw-context__empty">
          <p>Chưa có ngữ cảnh</p>
          <p className="aw-context__empty-hint">
            Ngữ cảnh và bộ nhớ sẽ hiển thị khi agent có lịch sử làm việc.
          </p>
        </div>
      )}

      {state === 'ready' && (
        <ul className="aw-context__list">
          {items.map((item) => (
            <li key={item.id} className="aw-context__item">
              <span className="aw-context__item-title">{item.title}</span>
              <span className="aw-context__item-source">{item.source}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
