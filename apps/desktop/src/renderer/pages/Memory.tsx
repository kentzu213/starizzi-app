import React, { useEffect, useMemo, useState } from 'react';
import { useAgentWorkspaceStore } from '../store/agentWorkspace';
import type { AgentMemory } from '../../main/agent/types';

type MemoryScope = 'all' | 'current';

export function MemoryPage() {
  const [scope, setScope] = useState<MemoryScope>('all');
  const session = useAgentWorkspaceStore((state) => state.session);
  const memories = useAgentWorkspaceStore((state) => state.memories);
  const refreshMemories = useAgentWorkspaceStore((state) => state.refreshMemories);
  const pinMemory = useAgentWorkspaceStore((state) => state.pinMemory);
  const deleteMemory = useAgentWorkspaceStore((state) => state.deleteMemory);

  useEffect(() => {
    void refreshMemories();
  }, [refreshMemories]);

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
              Agent đưa fact, preference, constraint và resource vào bộ nhớ local. Bạn có thể ghim hoặc xóa.
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

      <section className="memory-section">
        <div className="memory-section__header">
          <h3 className="memory-section__title">Pinned</h3>
          <span className="memory-section__count">{pinnedMemories.length}</span>
        </div>
        <MemoryGrid memories={pinnedMemories} onPin={pinMemory} onDelete={deleteMemory} />
      </section>

      <section className="memory-section">
        <div className="memory-section__header">
          <h3 className="memory-section__title">Recent</h3>
          <span className="memory-section__count">{recentMemories.length}</span>
        </div>
        <MemoryGrid memories={recentMemories} onPin={pinMemory} onDelete={deleteMemory} />
      </section>
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
