import React, { useDeferredValue, useEffect, useState } from 'react';
import { AgentStatusBadge } from '../components/AgentStatusBadge';
import { AgentTabBar } from '../components/AgentTabBar';
import { ChatComposer, type ComposerMenuAction } from '../components/ChatComposer';
import { ChatEmptyState } from '../components/ChatEmptyState';
import { ChatMessageList } from '../components/ChatMessageList';
import { ModelSelector } from '../components/ModelSelector';
import { AgentRail } from '../components/AgentRail';
import { ContextPanel } from '../components/ContextPanel';
import { LoopDock } from '../components/LoopDock';
import { BusinessStrip } from '../components/BusinessStrip';
import { useAgentGatewayStore } from '../store/agentGateway';
import { useAgentWorkspaceStore } from '../store/agentWorkspace';
import type { AIProvider } from '../types/agent-registry';
import { AGENT_LOOPS, loopStarterDraft, planLoopApplication, type AgentLoop, type LoopTask } from '../types/agent-loops';
import '../styles/agent-gateway.css';
import '../styles/agent-workspace.css';

interface ChatPageProps {
  user?: { plan?: string; balance?: number } | null;
  onBuyApi?: () => void;
  onNavigateToDashboard?: () => void;
  onNavigateToAgentHub?: () => void;
  onNavigateToExtensions?: () => void;
}

export function ChatPage({ user, onBuyApi, onNavigateToDashboard, onNavigateToAgentHub, onNavigateToExtensions }: ChatPageProps) {
  // Composer draft + attachments live in the gateway store so they survive tab
  // switches (this page unmounts when you leave it) — fixes losing typed text.
  const draft = useAgentGatewayStore((state) => state.composerDraft);
  const setDraft = useAgentGatewayStore((state) => state.setComposerDraft);
  const images = useAgentGatewayStore((state) => state.composerImages);
  const setImages = useAgentGatewayStore((state) => state.setComposerImages);
  const [showAgentPicker, setShowAgentPicker] = useState(false);
  const [railCollapsed, setRailCollapsed] = useState(false);
  const [activeTask, setActiveTask] = useState<LoopTask | null>(null);

  // Legacy workspace store (OpenClaw native)
  const session = useAgentWorkspaceStore((state) => state.session);
  const messages = useAgentWorkspaceStore((state) => state.messages);
  const runtimeState = useAgentWorkspaceStore((state) => state.runtimeState);
  const isBootstrapping = useAgentWorkspaceStore((state) => state.isBootstrapping);
  const isSendingLegacy = useAgentWorkspaceStore((state) => state.isSending);
  const errorMessage = useAgentWorkspaceStore((state) => state.errorMessage);
  const onboardingState = useAgentWorkspaceStore((state) => state.onboardingState);
  const sendMessageLegacy = useAgentWorkspaceStore((state) => state.sendMessage);
  const newSessionLegacy = useAgentWorkspaceStore((state) => state.newSession);
  const openOnboarding = useAgentWorkspaceStore((state) => state.openOnboarding);
  const refreshStatus = useAgentWorkspaceStore((state) => state.refreshStatus);

  // Gateway store (multi-agent)
  const gwSessions = useAgentGatewayStore((state) => state.sessions);
  const gwActiveSessionId = useAgentGatewayStore((state) => state.activeSessionId);
  const gwAgents = useAgentGatewayStore((state) => state.agents);
  const gwIsSending = useAgentGatewayStore((state) => state.isSending);
  const gwSwitchSession = useAgentGatewayStore((state) => state.switchSession);
  const gwCloseSession = useAgentGatewayStore((state) => state.closeAgentChat);
  const gwOpenChat = useAgentGatewayStore((state) => state.openAgentChat);
  const gwSendMessage = useAgentGatewayStore((state) => state.sendGatewayMessage);
  const gwAbort = useAgentGatewayStore((state) => state.abortGateway);
  const gwInject = useAgentGatewayStore((state) => state.injectGateway);
  const gwSetModel = useAgentGatewayStore((state) => state.setSessionModel);
  const gwActiveSession = useAgentGatewayStore((state) => state.activeSession);
  const gwRefreshStatuses = useAgentGatewayStore((state) => state.refreshAgentStatuses);
  const gwReconfiguringId = useAgentGatewayStore((state) => state.reconfiguringSessionId);
  const gwSetReasoningEffort = useAgentGatewayStore((state) => state.setReasoningEffort);
  const gwHydrate = useAgentGatewayStore((state) => state.hydrateFromDisk);

  // Reflect real Docker running-state in the agent rail + picker on the Chat
  // surface. The gateway store resets every launch with all agents
  // 'not-installed', so without this a running container (e.g. Hermes) shows
  // "Chưa cài" here even though `docker ps` sees it. Mirrors AgentStore's sync.
  useEffect(() => {
    void gwHydrate(); // restore persisted chat history (survives app restart)
    void gwRefreshStatuses();
  }, [gwHydrate, gwRefreshStatuses]);

  // Re-sync when the agent picker opens, in case a container started/stopped
  // after the page mounted.
  useEffect(() => {
    if (showAgentPicker) void gwRefreshStatuses();
  }, [showAgentPicker, gwRefreshStatuses]);

  const activeGwSession = gwActiveSession();
  const isGatewayMode = gwSessions.length > 0;
  const gwMessages = activeGwSession?.messages ?? [];
  const deferredMessages = useDeferredValue(isGatewayMode ? gwMessages : messages);
  const isSending = isGatewayMode ? gwIsSending : isSendingLegacy;
  const isReconfiguring = Boolean(activeGwSession && gwReconfiguringId === activeGwSession.id);
  // Interrupt/steer only makes sense on the host-agent (codex-lb) path — non-izzi
  // gateway agents. izzi persona turns run server-side and aren't abortable here.
  const activeAgentRuntime = gwAgents.find((a) => a.id === activeGwSession?.agentId)?.runtime;
  const canInterrupt = isGatewayMode && !!activeGwSession && activeAgentRuntime !== 'izzi';

  async function handleSubmit() {
    const text = draft.trim();
    if (!text && images.length === 0) return;

    if (isGatewayMode && activeGwSession) {
      const sent = await gwSendMessage(text, images);
      if (sent) {
        setDraft('');
        setImages([]);
      }
    } else {
      // Legacy (OpenClaw native) path is text-only; images aren't sent there.
      const sent = await sendMessageLegacy(text);
      if (sent) {
        setDraft('');
        setImages([]);
      }
    }
  }

  function handleSelectAgent(agentId: string) {
    gwOpenChat(agentId);
    setShowAgentPicker(false);
  }

  function handleModelChange(model: string, provider: AIProvider) {
    if (activeGwSession) {
      gwSetModel(activeGwSession.id, model, provider);
    }
  }

  function handleSelectAgentFromRail(agentId: string) {
    gwOpenChat(agentId);
  }

  function handleSelectLoop(loop: AgentLoop) {
    const plan = planLoopApplication(loop, activeGwSession, gwAgents);
    if (plan.action === 'configure-existing' && activeGwSession) {
      gwSetModel(activeGwSession.id, plan.model, plan.provider);
    } else if (plan.action === 'open-new' && plan.agentId) {
      gwOpenChat(plan.agentId);
      const opened = useAgentGatewayStore.getState().activeSession();
      if (opened) {
        useAgentGatewayStore.getState().setSessionModel(opened.id, plan.model, plan.provider);
      }
    }
    // Seed the composer draft with the loop's starter prompt (Req 9.1: DO NOT auto-send)
    setDraft(loopStarterDraft(loop));
    setActiveTask(loop.task);
  }

  // "+" composer menu: attach images (handled inside the composer) + quick agent
  // switch + shortcuts into the app's integrations (Agent Hub, extensions).
  const composerMenuActions: ComposerMenuAction[] = [
    ...gwAgents.map((agent) => ({
      id: `open-agent-${agent.id}`,
      group: 'Agent',
      icon: agent.icon,
      label: agent.displayName,
      description:
        agent.status === 'running' ? 'Đang chạy' : agent.status === 'stopped' ? 'Đã dừng' : undefined,
      onSelect: () => gwOpenChat(agent.id),
    })),
    {
      id: 'pick-agent',
      group: 'Agent',
      icon: '➕',
      label: 'Chọn agent khác…',
      onSelect: () => setShowAgentPicker(true),
    },
    {
      id: 'nav-agent-hub',
      group: 'Ứng dụng & tích hợp',
      icon: '🧭',
      label: 'Kho Agent',
      description: 'Cài & quản lý agent',
      onSelect: () => onNavigateToAgentHub?.(),
    },
    {
      id: 'nav-extensions',
      group: 'Ứng dụng & tích hợp',
      icon: '🧩',
      label: 'Tiện ích mở rộng',
      description: 'Marketplace tiện ích',
      onSelect: () => onNavigateToExtensions?.(),
    },
  ];

  return (
    <div className={`agent-workspace ${railCollapsed ? 'agent-workspace--collapsed' : ''}`}>
      <div className="agent-workspace__main">
        <div className="chat-page">
      {/* Header */}
      <header className="chat-page__header">
        <div>
          <div className="chat-page__eyebrow">Memory relay</div>
          <h1 className="chat-page__title">
            🔀 {isGatewayMode && activeGwSession
              ? `${activeGwSession.agentIcon} ${activeGwSession.agentName}`
              : 'Turn memory into actions that run again'}
          </h1>
          <p className="chat-page__subtitle">
            Chat đồng thời với nhiều AI Agent. IzziAPI recommended cho tất cả model.
          </p>
          <div className="chat-page__route-strip" aria-label="Memory workflow stages">
            {['Capture', 'Structure', 'Recall', 'Replay'].map((stage, index) => (
              <span key={stage}>
                <small>{String(index + 1).padStart(2, '0')}</small>
                {stage}
              </span>
            ))}
          </div>
        </div>

        <div className="chat-page__header-actions">
          {!isGatewayMode && (
            <AgentStatusBadge state={runtimeState.state} detail={runtimeState.lastError} />
          )}
          <button
            type="button"
            className="btn btn--glass-dashboard"
            onClick={() => window.electronAPI?.shell.openExternal('http://127.0.0.1:18789/')}
            title="Open OpenClaw Gateway Dashboard"
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
              <path d="M2 4.5A1.5 1.5 0 013.5 3h9A1.5 1.5 0 0114 4.5v7a1.5 1.5 0 01-1.5 1.5h-9A1.5 1.5 0 012 11.5v-7zM4 6h8M4 8.5h5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
            Dashboard
          </button>
          <button
            type="button"
            className="btn btn--ghost"
            disabled={isSending}
            onClick={() => {
              if (isGatewayMode && activeGwSession) {
                useAgentGatewayStore.getState().newGatewaySession(activeGwSession.agentId);
              } else {
                void newSessionLegacy();
              }
            }}
          >
            Cuộc trò chuyện mới
          </button>
        </div>
      </header>

      {/* Agent Tab Bar */}
      <AgentTabBar
        sessions={gwSessions}
        activeSessionId={gwActiveSessionId}
        agents={gwAgents}
        onSwitchSession={gwSwitchSession}
        onCloseSession={gwCloseSession}
        onAddAgent={() => setShowAgentPicker(true)}
      />

      {/* Chat Body */}
      <section className="chat-page__body">
        {/* Legacy session card (when no gateway tabs) */}
        {!isGatewayMode && (
          <div className="chat-session-card glass-card">
            <div>
              <div className="chat-session-card__label">Current session</div>
              <div className="chat-session-card__title">{session?.title || 'Đang khởi tạo session'}</div>
            </div>
            <div className="chat-session-card__meta-wrap">
              <div className="chat-session-card__meta">IzziAPI managed runner</div>
              <div className="chat-session-card__meta">
                {deferredMessages.length > 0 ? `${deferredMessages.length} messages` : 'No messages yet'}
              </div>
              <button
                type="button"
                className="btn btn--ghost btn--sm"
                disabled={runtimeState.state === 'running' || runtimeState.state === 'connecting'}
                onClick={() => void refreshStatus(session?.id)}
              >
                Làm mới status
              </button>
            </div>
          </div>
        )}

        {/* Messages */}
        {isBootstrapping && !isGatewayMode ? (
          <div className="chat-loading-state">Đang tải lịch sử chat...</div>
        ) : deferredMessages.length === 0 ? (
          isGatewayMode ? (
            <div className="gw-empty">
              <span className="gw-empty__icon">
                {activeGwSession?.agentIcon ?? '🔀'}
              </span>
              <h2 className="gw-empty__title">
                {activeGwSession
                  ? `Bắt đầu chat với ${activeGwSession.agentName}`
                  : 'Chọn Agent để bắt đầu'}
              </h2>
              <p className="gw-empty__desc">
                {activeGwSession
                  ? `Gửi tin nhắn đầu tiên cho ${activeGwSession.agentName}. Model: ${activeGwSession.model}`
                  : 'Nhấn "+" ở tab bar hoặc chọn một agent bên dưới để mở cuộc trò chuyện mới.'}
              </p>
              {!activeGwSession && (
                <div className="gw-empty__agents">
                  {gwAgents.map((agent) => (
                    <button
                      key={agent.id}
                      className="gw-empty__agent-btn"
                      onClick={() => handleSelectAgent(agent.id)}
                      type="button"
                    >
                      <span className="gw-empty__agent-icon">{agent.icon}</span>
                      <span className="gw-empty__agent-name">{agent.displayName}</span>
                      <span className="gw-empty__agent-stars">⭐ {agent.githubStars}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          ) : (
            <ChatEmptyState
              onUsePrompt={setDraft}
              showFinishSetup={Boolean(onboardingState?.hasPendingSetup)}
              onFinishSetup={openOnboarding}
            />
          )
        ) : (
          <ChatMessageList messages={deferredMessages as any} />
        )}
      </section>

      {/* Footer */}
      <footer className="chat-page__footer">
        {errorMessage && <div className="chat-error-banner">{errorMessage}</div>}
        {!isGatewayMode && runtimeState.state === 'error' && !errorMessage && (
          <div className="chat-error-banner">
            Kết nối agent đang gặp lỗi. Bạn có thể làm mới status hoặc gửi lại khi backend sẵn sàng.
          </div>
        )}

        {/* Model selector + agent info for gateway mode */}
        {isGatewayMode && activeGwSession && (
          <div className="gw-footer__bar">
            <div className="gw-footer__agent-info">
              <span>{activeGwSession.agentIcon}</span>
              <span>{activeGwSession.agentName}</span>
              <span
                className="gw-tab__dot"
              />
            </div>
            {activeGwSession.agentId === 'hermes' ? (
              <div className="gw-effort" title="GPT-5.6 qua codex router — chọn độ sâu suy luận (như codex)">
                <span className="gw-effort__label">⚡ GPT-5.6 · Reasoning</span>
                <select
                  className="gw-effort__select"
                  value={activeGwSession.reasoningEffort ?? 'xhigh'}
                  disabled={isReconfiguring}
                  onChange={(e) => void gwSetReasoningEffort(e.target.value)}
                >
                  <option value="low">Low · nhanh</option>
                  <option value="medium">Medium</option>
                  <option value="high">High</option>
                  <option value="xhigh">xHigh · sâu nhất</option>
                </select>
                {isReconfiguring && (
                  <span className="gw-effort__applying">Đang áp dụng… (~30s)</span>
                )}
              </div>
            ) : (
              <ModelSelector
                currentModel={activeGwSession.model}
                currentProvider={activeGwSession.provider}
                onSelect={handleModelChange}
              />
            )}
          </div>
        )}

        <ChatComposer
          value={draft}
          images={images}
          menuActions={composerMenuActions}
          disabled={isBootstrapping || isReconfiguring || (!isGatewayMode && isSendingLegacy)}
          isSubmitting={isSending}
          onChange={setDraft}
          onImagesChange={setImages}
          onSubmit={() => void handleSubmit()}
          onCancel={canInterrupt ? () => void gwAbort() : undefined}
          onInject={canInterrupt ? (t) => void gwInject(t) : undefined}
        />
      </footer>

      {/* Agent Picker Popup */}
      {showAgentPicker && (
        <div className="agent-picker-overlay" onClick={() => setShowAgentPicker(false)}>
          <div className="agent-picker" onClick={(e) => e.stopPropagation()}>
            <h2 className="agent-picker__title">🤖 Chọn Agent</h2>
            <p className="agent-picker__subtitle">
              Chọn AI Agent để mở tab chat mới
            </p>
            <div className="agent-picker__grid">
              {gwAgents.map((agent) => (
                <button
                  key={agent.id}
                  className="agent-picker__card"
                  onClick={() => handleSelectAgent(agent.id)}
                  type="button"
                >
                  <div className="agent-picker__card-header">
                    <span className="agent-picker__card-icon">{agent.icon}</span>
                    <div className="agent-picker__card-info">
                      <div className="agent-picker__card-name">{agent.displayName}</div>
                      <div className="agent-picker__card-stars">⭐ {agent.githubStars}</div>
                    </div>
                    <span
                      className={`agent-picker__card-status agent-picker__card-status--${agent.status}`}
                    >
                      {agent.status === 'running' ? '🟢 Running' :
                       agent.status === 'stopped' ? '🟡 Stopped' :
                       agent.status === 'not-installed' ? '⚪ Not Installed' :
                       agent.status}
                    </span>
                  </div>
                  <div className="agent-picker__card-desc">{agent.description}</div>
                </button>
              ))}
            </div>
            <button
              className="agent-picker__close"
              onClick={() => setShowAgentPicker(false)}
              type="button"
            >
              Đóng
            </button>
          </div>
        </div>
      )}
        </div>
      </div>

      {railCollapsed && (
        <button
          type="button"
          className="agent-workspace__reopen"
          onClick={() => setRailCollapsed(false)}
        >
          ⟨ Agents
        </button>
      )}

      <aside className="agent-workspace__rail glass-panel">
        <BusinessStrip user={user ?? null} onBuyApi={onBuyApi} />
        <AgentRail
          agents={gwAgents}
          activeAgentId={activeGwSession?.agentId ?? null}
          collapsed={railCollapsed}
          onToggleCollapse={() => setRailCollapsed((v) => !v)}
          onSelectAgent={handleSelectAgentFromRail}
        />
        <ContextPanel agentId={activeGwSession?.agentId ?? null} />
        <LoopDock loops={AGENT_LOOPS} activeTask={activeTask} onSelectLoop={handleSelectLoop} />
      </aside>
    </div>
  );
}
