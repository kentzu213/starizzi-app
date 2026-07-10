import React, { useEffect, useState } from 'react';
import { useAgentWorkspaceStore } from '../store/agentWorkspace';
import type { AgentRunEntry, AgentTaskStatus } from '../../main/agent/types';

const TASK_COLUMNS: Array<{ status: AgentTaskStatus; label: string }> = [
  { status: 'todo', label: 'Todo' },
  { status: 'in_progress', label: 'In Progress' },
  { status: 'blocked', label: 'Blocked' },
  { status: 'done', label: 'Done' },
];

export function TasksPage() {
  const tasks = useAgentWorkspaceStore((state) => state.tasks);
  const session = useAgentWorkspaceStore((state) => state.session);
  const refreshTasks = useAgentWorkspaceStore((state) => state.refreshTasks);
  const updateTaskStatus = useAgentWorkspaceStore((state) => state.updateTaskStatus);

  const runs = useAgentWorkspaceStore((state) => state.runs);
  const refreshRuns = useAgentWorkspaceStore((state) => state.refreshRuns);
  const createRun = useAgentWorkspaceStore((state) => state.createRun);

  const [goal, setGoal] = useState('');
  const [openRunId, setOpenRunId] = useState<string | null>(null);
  const [entries, setEntries] = useState<AgentRunEntry[]>([]);

  useEffect(() => {
    void refreshTasks();
    void refreshRuns();
  }, [refreshTasks, refreshRuns]);

  const openRun = async (id: string) => {
    if (openRunId === id) {
      setOpenRunId(null);
      return;
    }
    setOpenRunId(id);
    const res = await window.electronAPI?.run?.get(id);
    setEntries(res?.entries ?? []);
  };

  const submitRun = async () => {
    const g = goal.trim();
    if (!g) return;
    await createRun(g);
    setGoal('');
  };

  return (
    <div>
      <div className="page-header">
        <h1 className="page-header__title">Tasks</h1>
        <p className="page-header__subtitle">
          Dự án AI (Run) là "bảng công việc" bền của công ty — mục tiêu, giai đoạn, và các mốc do agent ghi lại (kèm nguồn). Bên dưới là các task theo trạng thái.
        </p>
      </div>

      {/* AI-company Runs — the durable blackboard (agent-company Phase 1). */}
      <section className="glass-panel" style={{ padding: 16, marginBottom: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
          <h3 className="task-column__title" style={{ marginRight: 'auto' }}>Dự án AI (Runs)</h3>
          <input
            className="task-card__select"
            style={{ flex: '1 1 320px', minWidth: 220 }}
            placeholder="Mục tiêu dự án mới…"
            value={goal}
            onChange={(e) => setGoal(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void submitRun();
            }}
          />
          <button type="button" className="btn btn--primary btn--sm" onClick={() => void submitRun()} disabled={!goal.trim()}>
            Tạo Run
          </button>
        </div>

        {runs.length === 0 ? (
          <div className="task-column__empty">Chưa có dự án nào. Tạo một Run để agent bắt đầu ghi lại công việc.</div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {runs.map((run) => (
              <article key={run.id} className="glass-card" style={{ padding: 12 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <strong style={{ marginRight: 'auto' }}>{run.goal}</strong>
                  <span className="task-column__count">{run.stage}</span>
                  <span className="task-column__count">{run.status}</span>
                  <button type="button" className="btn btn--ghost btn--sm" onClick={() => void openRun(run.id)}>
                    {openRunId === run.id ? 'Ẩn' : 'Xem'}
                  </button>
                </div>
                <div className="task-card__meta">
                  <span>Cập nhật: {new Date(run.updatedAt).toLocaleString('vi-VN')}</span>
                </div>
                {openRunId === run.id && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 8 }}>
                    {entries.length === 0 ? (
                      <div className="task-column__empty">Chưa có mốc nào trong dự án này.</div>
                    ) : (
                      entries.map((entry) => (
                        <div key={entry.id} className="glass-card" style={{ padding: 8 }}>
                          <div className="task-card__meta">
                            <span>{entry.kind}{entry.stage ? ` · ${entry.stage}` : ''}</span>
                            <span>{entry.agentId ?? 'agent'} · {new Date(entry.createdAt).toLocaleString('vi-VN')}</span>
                          </div>
                          <div className="task-card__summary">{entry.content}</div>
                        </div>
                      ))
                    )}
                  </div>
                )}
              </article>
            ))}
          </div>
        )}
      </section>

      <div className="task-board">
        {TASK_COLUMNS.map((column) => {
          const columnTasks = tasks.filter((task) => task.status === column.status);
          return (
            <section key={column.status} className="task-column glass-panel">
              <div className="task-column__header">
                <h3 className="task-column__title">{column.label}</h3>
                <span className="task-column__count">{columnTasks.length}</span>
              </div>

              {columnTasks.length === 0 ? (
                <div className="task-column__empty">Chưa có task nào trong cột này.</div>
              ) : (
                <div className="task-column__list">
                  {columnTasks.map((task) => (
                    <article key={task.id} className="task-card glass-card">
                      <div className="task-card__title">{task.title}</div>
                      {task.summary && <p className="task-card__summary">{task.summary}</p>}
                      <div className="task-card__meta">
                        <span>{task.sessionId === session?.id ? 'Current chat' : 'Stored task'}</span>
                        <span>{new Date(task.updatedAt).toLocaleString('vi-VN')}</span>
                      </div>
                      <select
                        className="task-card__select"
                        value={task.status}
                        onChange={(event) =>
                          void updateTaskStatus(task.id, event.target.value as AgentTaskStatus)
                        }
                      >
                        {TASK_COLUMNS.map((option) => (
                          <option key={option.status} value={option.status}>
                            {option.label}
                          </option>
                        ))}
                      </select>
                    </article>
                  ))}
                </div>
              )}
            </section>
          );
        })}
      </div>
    </div>
  );
}
