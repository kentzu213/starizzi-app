import React, { useEffect } from 'react';
import { useAgentWorkspaceStore } from '../store/agentWorkspace';
import type { AgentTaskStatus } from '../../main/agent/types';

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

  useEffect(() => {
    void refreshTasks();
  }, [refreshTasks]);

  return (
    <div>
      <div className="page-header">
        <h1 className="page-header__title">Tasks</h1>
        <p className="page-header__subtitle">
          Agent tự lập và cập nhật kế hoạch ở đây khi làm việc — mỗi bước chạy qua Todo → In Progress → Done. Bạn theo dõi tiến độ, hoặc tự đổi trạng thái.
        </p>
      </div>

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
