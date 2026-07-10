import React from 'react';
import type { AgentChatSession } from '../types/agent-registry';
import type { ExternalAgent } from '../types/agent-registry';

interface AgentTabBarProps {
  sessions: AgentChatSession[];
  activeSessionId: string | null;
  agents: ExternalAgent[];
  onSwitchSession: (sessionId: string) => void;
  onCloseSession: (sessionId: string) => void;
  onAddAgent: () => void;
}

/** Editorial monogram from a display name (e.g. "Hermes Agent" -> "HA"). */
function monogram(name: string): string {
  const cleaned = (name || '').trim();
  if (!cleaned) return '??';
  const words = cleaned.split(/\s+/).filter(Boolean);
  if (words.length >= 2) return (words[0][0] + words[1][0]).toUpperCase();
  return cleaned.slice(0, 2).toUpperCase();
}

export function AgentTabBar({
  sessions,
  activeSessionId,
  agents,
  onSwitchSession,
  onCloseSession,
  onAddAgent,
}: AgentTabBarProps) {
  function getAgentStatus(agentId: string): string {
    const agent = agents.find((a) => a.id === agentId);
    if (!agent) return '';
    switch (agent.status) {
      case 'running':
        return 'gw-tab__dot--running';
      case 'stopped':
        return 'gw-tab__dot--stopped';
      case 'error':
        return 'gw-tab__dot--error';
      case 'installing':
        return 'gw-tab__dot--installing';
      default:
        return 'gw-tab__dot--offline';
    }
  }

  if (sessions.length === 0) {
    return (
      <div className="gw-tabbar gw-tabbar--empty glass-surface">
        <button className="gw-tabbar__add" onClick={onAddAgent} type="button">
          <span className="gw-tabbar__add-icon">+</span>
          <span>Chọn Agent để bắt đầu chat</span>
        </button>
      </div>
    );
  }

  return (
    <div className="gw-tabbar glass-surface">
      <div className="gw-tabbar__tabs">
        {sessions.map((session) => (
          <button
            key={session.id}
            className={`gw-tab ${session.id === activeSessionId ? 'gw-tab--active' : ''}`}
            onClick={() => onSwitchSession(session.id)}
            type="button"
          >
            <span className={`gw-tab__dot ${getAgentStatus(session.agentId)}`} />
            <span className="gw-tab__icon">{monogram(session.agentName)}</span>
            <span className="gw-tab__name">{session.agentName}</span>
            <span className="gw-tab__model">{session.model}</span>
            <button
              className="gw-tab__close"
              onClick={(e) => {
                e.stopPropagation();
                onCloseSession(session.id);
              }}
              type="button"
              title="Đóng tab"
            >
              ×
            </button>
          </button>
        ))}
      </div>
      <button className="gw-tabbar__add" onClick={onAddAgent} type="button" title="Thêm Agent">
        <span className="gw-tabbar__add-icon">+</span>
      </button>
    </div>
  );
}
