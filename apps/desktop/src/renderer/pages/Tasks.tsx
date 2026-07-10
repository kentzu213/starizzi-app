import React, { useEffect, useState } from 'react';
import { useAgentWorkspaceStore } from '../store/agentWorkspace';
import type { AgentRun, AgentRunEntry, AgentTaskStatus } from '../../main/agent/types';
import { PIPELINE, nextStage, stageMeta, transitionNeedsApproval } from '../types/run-pipeline';

const TASK_COLUMNS: Array<{ status: AgentTaskStatus; label: string }> = [
  { status: 'todo', label: 'Todo' },
  { status: 'in_progress', label: 'In Progress' },
  { status: 'blocked', label: 'Blocked' },
  { status: 'done', label: 'Done' },
];

// On-demand advisory council (agent-company Phase 4). Advice only — never executes.
const COUNCIL_PROMPT = [
  'Bạn là Hội đồng cố vấn của một công ty AI. Với quyết định được nêu, đưa 4 lăng kính NGẮN, độc lập:',
  '- Architect: cấu trúc dài hạn, hệ quả bậc hai.',
  '- Red-team: cách nó hỏng/bị lạm dụng, rủi ro bảo mật.',
  '- Pragmatist: cách nhỏ nhất chạy được ngay, chi phí/thời gian.',
  '- Verifier: cách chứng minh nó chạy (test/kiểm chứng).',
  'Nêu chỗ các lăng kính BẤT ĐỒNG, rồi CHỐT 1 phương án + rủi ro lớn nhất + cách kiểm chứng khử rủi ro đó.',
  'KHÔNG tự duyệt deploy production hay lệnh phá hủy — chỉ đề xuất; quyết định cuối là của người dùng.',
  'Trả lời súc tích, bằng ngôn ngữ của người dùng.',
].join('\n');

// Orchestrator auto-identifies + splits the goal into routed steps (agent-company Phase 2).
const PLAN_PROMPT = [
  'Bạn là Orchestrator của công ty AI. Từ MỤC TIÊU, hãy XÁC ĐỊNH + CHIA việc:',
  '- Liệt kê 3–7 bước ngắn, theo thứ tự; mỗi bước ghi rõ PHÒNG phụ trách (Kỹ thuật/Thiết kế/Thị trường) và tiêu chí DONE.',
  '- Nêu rõ bước nào rủi ro cao (deploy/tiền/dữ liệu khách) cần người duyệt.',
  'Súc tích, đánh số, bằng ngôn ngữ của người dùng.',
].join('\n');

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
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void refreshTasks();
    void refreshRuns();
  }, [refreshTasks, refreshRuns]);

  const loadEntries = async (id: string) => {
    const res = await window.electronAPI?.run?.get(id);
    setEntries(res?.entries ?? []);
  };

  const openRun = async (id: string) => {
    if (openRunId === id) {
      setOpenRunId(null);
      return;
    }
    setOpenRunId(id);
    await loadEntries(id);
  };

  const submitRun = async () => {
    const g = goal.trim();
    if (!g) return;
    await createRun(g);
    setGoal('');
  };

  const advanceRun = async (run: AgentRun) => {
    const to = nextStage(run.stage);
    if (!to) return;
    const meta = stageMeta(to);
    if (transitionNeedsApproval(to) && !window.confirm(`Chuyển sang "${meta?.label}" — giai đoạn rủi ro cao 🔴. Xác nhận?`)) {
      return;
    }
    await window.electronAPI?.run?.update(run.id, { stage: to });
    await window.electronAPI?.run?.appendEntry({
      runId: run.id,
      kind: 'handoff',
      stage: to,
      agentId: 'orchestrator',
      content: `Chuyển sang "${meta?.label}" → giao ${meta?.department}/${meta?.agentId} (nhiệm vụ ${meta?.missionId}).`,
    });
    await refreshRuns();
    await loadEntries(run.id);
  };

  // Shared flow: call an izzi persona (advice only, no execution) → append as a Run entry.
  const askPersona = async (run: AgentRun, systemPrompt: string, message: string, agentId: string) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const api = (window as any).electronAPI?.izziAgent;
    if (!api?.chat) return;
    setBusy(true);
    try {
      const r = await api.chat({ systemPrompt, message });
      const text = typeof r?.reply === 'string' && r.reply.trim() ? r.reply.trim() : null;
      await window.electronAPI?.run?.appendEntry({
        runId: run.id,
        kind: 'note',
        stage: run.stage,
        agentId,
        content: text ?? '(Chưa có phản hồi — hãy đăng nhập izzi rồi thử lại.)',
      });
      await refreshRuns();
      await loadEntries(run.id);
    } finally {
      setBusy(false);
    }
  };

  const planRun = (run: AgentRun) =>
    askPersona(run, PLAN_PROMPT, `Mục tiêu dự án: "${run.goal}". Xác định + chia việc theo phòng ban.`, 'orchestrator');

  const runCouncil = (run: AgentRun) =>
    askPersona(
      run,
      COUNCIL_PROMPT,
      `Quyết định cần bàn cho dự án "${run.goal}" (giai đoạn: ${run.stage}). Cho 4 lăng kính rồi chốt 1 phương án.`,
      'council',
    );

  return (
    <div>
      <div className="page-header">
        <h1 className="page-header__title">Tasks</h1>
        <p className="page-header__subtitle">
          Dự án AI (Run) là "bảng công việc" bền của công ty — mục tiêu, giai đoạn theo phòng ban, và các mốc do agent ghi (kèm nguồn). Bên dưới là task theo trạng thái.
        </p>
      </div>

      {/* AI-company Runs — durable blackboard + pipeline routing + council (Phase 1–4). */}
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
          <div className="task-column__empty">Chưa có dự án nào. Tạo một Run để công ty AI bắt đầu ghi lại công việc.</div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {runs.map((run) => {
              const meta = stageMeta(run.stage);
              const to = nextStage(run.stage);
              const toMeta = to ? stageMeta(to) : undefined;
              return (
                <article key={run.id} className="glass-card" style={{ padding: 12 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <strong style={{ marginRight: 'auto' }}>{run.goal}</strong>
                    <span className="task-column__count">{meta?.label ?? run.stage}</span>
                    <span className="task-column__count">{run.status}</span>
                    <button type="button" className="btn btn--ghost btn--sm" onClick={() => void openRun(run.id)}>
                      {openRunId === run.id ? 'Ẩn' : 'Xem'}
                    </button>
                  </div>
                  <div className="task-card__meta">
                    <span>Phụ trách: {meta?.department ?? '—'} · {meta?.agentId ?? '—'}</span>
                    <span>Cập nhật: {new Date(run.updatedAt).toLocaleString('vi-VN')}</span>
                  </div>

                  {openRunId === run.id && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 8 }}>
                      {/* Pipeline strip (org lifecycle) */}
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center' }}>
                        {PIPELINE.map((s) => (
                          <span
                            key={s.stage}
                            className="task-column__count"
                            style={{ opacity: s.stage === run.stage ? 1 : 0.45, fontWeight: s.stage === run.stage ? 700 : 400 }}
                          >
                            {s.label}
                            {s.risk === 'red' ? ' 🔴' : s.risk === 'yellow' ? ' 🟡' : ''}
                          </span>
                        ))}
                      </div>

                      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                        <button type="button" className="btn btn--ghost btn--sm" onClick={() => void planRun(run)} disabled={busy}>
                          🧭 Lập kế hoạch
                        </button>
                        {to && (
                          <button type="button" className="btn btn--primary btn--sm" onClick={() => void advanceRun(run)}>
                            Chuyển giai đoạn → {toMeta?.label}
                            {toMeta && transitionNeedsApproval(to) ? ' 🔴' : ''}
                          </button>
                        )}
                        <button type="button" className="btn btn--ghost btn--sm" onClick={() => void runCouncil(run)} disabled={busy}>
                          {busy ? 'Đang hỏi…' : '🏛️ Hội đồng'}
                        </button>
                      </div>

                      {/* Blackboard entries (with provenance) */}
                      {entries.length === 0 ? (
                        <div className="task-column__empty">Chưa có mốc nào. "Chuyển giai đoạn" hoặc "Hội đồng" sẽ ghi mốc vào đây.</div>
                      ) : (
                        entries.map((entry) => (
                          <div key={entry.id} className="glass-card" style={{ padding: 8 }}>
                            <div className="task-card__meta">
                              <span>{entry.kind}{entry.stage ? ` · ${entry.stage}` : ''}</span>
                              <span>{entry.agentId ?? 'agent'} · {new Date(entry.createdAt).toLocaleString('vi-VN')}</span>
                            </div>
                            <div className="task-card__summary" style={{ whiteSpace: 'pre-wrap' }}>{entry.content}</div>
                          </div>
                        ))
                      )}
                    </div>
                  )}
                </article>
              );
            })}
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
