import React, { useEffect, useMemo, useState } from 'react';
import { useAgentWorkspaceStore } from '../store/agentWorkspace';
import type { AgentMemory } from '../../main/agent/types';
import type { MemoryItemDTO } from '../../shared/graph-types';

type MemoryScope = 'all' | 'current';

export function MemoryPage() {
  const [scope, setScope] = useState<MemoryScope>('all');
  const session = useAgentWorkspaceStore((state) => state.session);
  const memories = useAgentWorkspaceStore((state) => state.memories);
  const refreshMemories = useAgentWorkspaceStore((state) => state.refreshMemories);
  const pinMemory = useAgentWorkspaceStore((state) => state.pinMemory);
  const deleteMemory = useAgentWorkspaceStore((state) => state.deleteMemory);

  const izziMemories = useAgentWorkspaceStore((state) => state.izziMemories);
  const izziMemoryState = useAgentWorkspaceStore((state) => state.izziMemoryState);
  const refreshIzziMemories = useAgentWorkspaceStore((state) => state.refreshIzziMemories);

  useEffect(() => {
    void refreshMemories();
    void refreshIzziMemories();
  }, [refreshMemories, refreshIzziMemories]);

  const scopedMemories = useMemo(() => {
    if (scope === 'current' && session?.id) {
      return memories.filter((memory) => memory.sessionId === session.id);
    }
    return memories;
  }, [memories, scope, session?.id]);

  const pinnedMemories = scopedMemories.filter((memory) => memory.pinned);
  const recentMemories = scopedMemories.filter((memory) => !memory.pinned);

  return (
    <div>
      <div className="page-header">
        <div className="page-header__split">
          <div>
            <h1 className="page-header__title">Memory</h1>
            <p className="page-header__subtitle">
              Một bộ não, hai bề mặt: bộ nhớ chung trên izzi (đồng bộ với web) và bộ nhớ cục bộ trên máy này.
            </p>
          </div>

          <div className="memory-scope-toggle">
            <button
              type="button"
              className={`memory-scope-toggle__button ${scope === 'all' ? 'memory-scope-toggle__button--active' : ''}`}
              onClick={() => setScope('all')}
            >
              All sessions
            </button>
            <button
              type="button"
              className={`memory-scope-toggle__button ${scope === 'current' ? 'memory-scope-toggle__button--active' : ''}`}
              disabled={!session?.id}
              onClick={() => setScope('current')}
            >
              Current chat
            </button>
          </div>
        </div>
      </div>

      {/* Shared brain on izzi — same memory as izziapi.com/aibase/memory (read-only, Phase 1). */}
      <section className="memory-section">
        <div className="memory-section__header">
          <h3 className="memory-section__title">Trên izzi (chung)</h3>
          <span className="memory-section__count">{izziMemoryState === 'ready' ? izziMemories.length : ''}</span>
          <button
            type="button"
            className="btn btn--ghost btn--sm"
            onClick={() => void refreshIzziMemories()}
            disabled={izziMemoryState === 'loading'}
            style={{ marginInlineStart: 'auto' }}
          >
            {izziMemoryState === 'loading' ? 'Đang tải…' : '↻ Làm mới'}
          </button>
        </div>
        <IzziMemoryList state={izziMemoryState} items={izziMemories} />
      </section>

      {/* Local device memory — what the agent captured on this machine. */}
      <section className="memory-section">
        <div className="memory-section__header">
          <h3 className="memory-section__title">Cục bộ (thiết bị này) · Pinned</h3>
          <span className="memory-section__count">{pinnedMemories.length}</span>
        </div>
        <MemoryGrid memories={pinnedMemories} onPin={pinMemory} onDelete={deleteMemory} />
      </section>

      <section className="memory-section">
        <div className="memory-section__header">
          <h3 className="memory-section__title">Cục bộ (thiết bị này) · Recent</h3>
          <span className="memory-section__count">{recentMemories.length}</span>
        </div>
        <MemoryGrid memories={recentMemories} onPin={pinMemory} onDelete={deleteMemory} />
      </section>
    </div>
  );
}

/** Read-only list of the izzi shared-brain memory, with explicit state messages. */
function IzziMemoryList({
  state,
  items,
}: {
  state: 'idle' | 'loading' | 'ready' | 'signed-out' | 'error';
  items: MemoryItemDTO[];
}) {
  if (state === 'loading' || state === 'idle') {
    return <div className="memory-section__empty">Đang tải bộ não izzi…</div>;
  }
  if (state === 'signed-out') {
    return <div className="memory-section__empty">Đăng nhập izzi để xem bộ não chung (đồng bộ với web).</div>;
  }
  if (state === 'error') {
    return <div className="memory-section__empty">Không tải được bộ não izzi — thử lại sau.</div>;
  }
  if (items.length === 0) {
    return <div className="memory-section__empty">Chưa có memory nào trên izzi.</div>;
  }

  return (
    <div className="memory-grid">
      {items.map((item) => (
        <article key={item.id} className="memory-card glass-card">
          <div className="memory-card__meta">
            <span className="memory-card__kind">{item.source || 'izzi'}</span>
            <span>{item.createdAt ? new Date(item.createdAt).toLocaleString('vi-VN') : ''}</span>
          </div>
          <div className="memory-card__content">{item.title}</div>
        </article>
      ))}
    </div>
  );
}

function MemoryGrid({
  memories,
  onPin,
  onDelete,
}: {
  memories: AgentMemory[];
  onPin: (memoryId: string, pinned: boolean) => Promise<void>;
  onDelete: (memoryId: string) => Promise<void>;
}) {
  if (memories.length === 0) {
    return <div className="memory-section__empty">Chưa có memory nào trong danh mục này.</div>;
  }

  return (
    <div className="memory-grid">
      {memories.map((memory) => (
        <article key={memory.id} className="memory-card glass-card">
          <div className="memory-card__meta">
            <span className="memory-card__kind">{memory.kind}</span>
            <span>{new Date(memory.updatedAt).toLocaleString('vi-VN')}</span>
          </div>
          <div className="memory-card__content">{memory.content}</div>
          <div className="memory-card__actions">
            <button type="button" className="btn btn--ghost btn--sm" onClick={() => void onPin(memory.id, !memory.pinned)}>
              {memory.pinned ? 'Bỏ ghim' : 'Ghim'}
            </button>
            <button type="button" className="btn btn--ghost btn--sm" onClick={() => void onDelete(memory.id)}>
              Xóa
            </button>
          </div>
        </article>
      ))}
    </div>
  );
}
