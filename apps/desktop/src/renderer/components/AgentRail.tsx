import React from 'react';
import type { ExternalAgent, ExternalAgentStatus } from '../types/agent-registry';
import { groupAgentsByCategory } from '../types/agent-loops';

interface AgentRailProps {
  agents: ExternalAgent[];
  activeAgentId: string | null;
  collapsed: boolean;
  onToggleCollapse: () => void;
  onSelectAgent: (agentId: string) => void;
}

const STATUS_LABEL: Record<ExternalAgentStatus, string> = {
  running: 'Đang chạy',
  stopped: 'Đã dừng',
  'not-installed': 'Chưa cài',
  error: 'Lỗi',
  installing: 'Đang cài',
};

export function AgentRail({
  agents,
  activeAgentId,
  collapsed,
  onToggleCollapse,
  onSelectAgent,
}: AgentRailProps) {
  const groups = groupAgentsByCategory(agents);

  return (
    <section className="aw-agents" aria-label="Agent và nhóm agent">
      <header className="aw-agents__header">
        <span className="aw-agents__title">Agents</span>
        <button
          type="button"
          className="aw-agents__collapse"
          onClick={onToggleCollapse}
          aria-label={collapsed ? 'Mở panel agent' : 'Thu gọn panel agent'}
          title={collapsed ? 'Mở panel agent' : 'Thu gọn panel agent'}
        >
          {collapsed ? '⟨' : '⟩'}
        </button>
      </header>

      <div className="aw-agents__scroll">
        {groups.map((group) => (
          <div key={group.category} className="aw-agents__group">
            <div className="aw-agents__group-title">{group.label}</div>
            {group.agents.map((agent) => (
              <button
                key={agent.id}
                type="button"
                className={`aw-agent ${agent.id === activeAgentId ? 'aw-agent--active' : ''}`}
                onClick={() => onSelectAgent(agent.id)}
                title={`${agent.displayName} · ${STATUS_LABEL[agent.status]}`}
              >
                <span className={`aw-agent__dot aw-agent__dot--${agent.status}`} aria-hidden="true" />
                <span className="aw-agent__icon" aria-hidden="true">{agent.icon}</span>
                <span className="aw-agent__name">{agent.displayName}</span>
                <span className="aw-agent__status">{STATUS_LABEL[agent.status]}</span>
              </button>
            ))}
          </div>
        ))}
      </div>
    </section>
  );
}
