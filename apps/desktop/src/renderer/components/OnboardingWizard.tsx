import React, { useEffect, useMemo, useState } from 'react';
import { AgentStatusBadge } from './AgentStatusBadge';
import { useAgentWorkspaceStore } from '../store/agentWorkspace';
import type { IntegrationProvider } from '../../main/agent/types';

const STEPS = ['Account', 'Runner', 'Integrations', 'Finish'] as const;

function formatBalance(balance: unknown): string {
  if (typeof balance === 'number') {
    return `$${balance.toFixed(2)}`;
  }
  return '$0.00';
}

export function OnboardingWizard({
  user,
}: {
  user: any;
}) {
  const [stepIndex, setStepIndex] = useState(0);
  const isOpen = useAgentWorkspaceStore((state) => state.isOnboardingOpen);
  const onboardingState = useAgentWorkspaceStore((state) => state.onboardingState);
  const integrations = useAgentWorkspaceStore((state) => state.integrations);
  const integrationsLoading = useAgentWorkspaceStore((state) => state.integrationsLoading);
  const runtimeState = useAgentWorkspaceStore((state) => state.runtimeState);
  const closeOnboarding = useAgentWorkspaceStore((state) => state.closeOnboarding);
  const dismissOnboarding = useAgentWorkspaceStore((state) => state.dismissOnboarding);
  const completeOnboarding = useAgentWorkspaceStore((state) => state.completeOnboarding);
  const refreshIntegrations = useAgentWorkspaceStore((state) => state.refreshIntegrations);
  const beginConnect = useAgentWorkspaceStore((state) => state.beginConnect);
  const disconnectIntegration = useAgentWorkspaceStore((state) => state.disconnectIntegration);

  useEffect(() => {
    if (!isOpen) {
      setStepIndex(0);
      return;
    }

    void refreshIntegrations();

    const onFocus = () => {
      void refreshIntegrations();
    };

    window.addEventListener('focus', onFocus);
    return () => {
      window.removeEventListener('focus', onFocus);
    };
  }, [isOpen, refreshIntegrations]);

  const connectedProviders = useMemo(
    () => integrations.filter((integration) => integration.status === 'connected'),
    [integrations],
  );

  if (!isOpen) {
    return null;
  }

  const isLastStep = stepIndex === STEPS.length - 1;

  return (
    <div className="onboarding-modal">
      <div className="onboarding-modal__backdrop" />
      <div className="onboarding-modal__panel glass-panel" role="dialog" aria-modal="true" aria-label="Onboarding wizard">
        <div className="onboarding-modal__header">
          <div>
            <div className="onboarding-modal__eyebrow">First-run Setup</div>
            <h2 className="onboarding-modal__title">{STEPS[stepIndex]}</h2>
          </div>
          <button type="button" className="btn btn--ghost btn--sm" onClick={closeOnboarding}>
            Đóng
          </button>
        </div>

        <div className="onboarding-modal__steps">
          {STEPS.map((step, index) => (
            <div
              key={step}
              className={`onboarding-modal__step ${index === stepIndex ? 'onboarding-modal__step--active' : ''}`}
            >
              <span>{index + 1}</span>
              <strong>{step}</strong>
            </div>
          ))}
        </div>

        <div className="onboarding-modal__body">
          {stepIndex === 0 && (
            <section className="onboarding-section">
              <p className="onboarding-section__copy">
                Desktop app đã liên kết với tài khoản IzziAPI. Đây là điểm bắt đầu cho managed runner,
                billing, và integrations.
              </p>
              <div className="onboarding-grid">
                <SetupCard label="Email" value={user?.email || 'N/A'} />
                <SetupCard label="Plan" value={user?.plan || 'free'} />
                <SetupCard label="Balance" value={formatBalance(user?.balance)} />
                <SetupCard label="Status" value="Connected via IzziAPI" />
              </div>
            </section>
          )}

          {stepIndex === 1 && (
            <section className="onboarding-section">
              <p className="onboarding-section__copy">
                Managed runner là execution mode duy nhất trong app. OpenClaw local vẫn được giữ như một shortcut ngoài luồng.
              </p>
              <div className="onboarding-runner-card glass-card">
                <div>
                  <div className="onboarding-runner-card__title">Managed Runner</div>
                  <div className="onboarding-runner-card__copy">
                    Chat, tasks, memory và status đều chạy qua IzziAPI managed runner.
                  </div>
                </div>
                <AgentStatusBadge state={runtimeState.state} detail={runtimeState.lastError} />
              </div>
              <div className="onboarding-runner-card glass-card">
                <div>
                  <div className="onboarding-runner-card__title">OpenClaw Local</div>
                  <div className="onboarding-runner-card__copy">
                    Không được chọn làm runner trong v1. Chỉ dùng để mở docs hoặc shortcut cài đặt.
                  </div>
                </div>
                <button
                  type="button"
                  className="btn btn--ghost btn--sm"
                  onClick={() => window.electronAPI?.system.openclawQuickInstall()}
                >
                  Mở shortcut
                </button>
              </div>
            </section>
          )}

          {stepIndex === 2 && (
            <section className="onboarding-section">
              <div className="onboarding-section__header">
                <p className="onboarding-section__copy">
                  Kết nối các kênh ngoài app bằng web flow của IzziAPI. Khi quay lại desktop, wizard sẽ làm mới trạng thái.
                </p>
                <button
                  type="button"
                  className="btn btn--ghost btn--sm"
                  disabled={integrationsLoading}
                  onClick={() => void refreshIntegrations()}
                >
                  {integrationsLoading ? 'Đang làm mới...' : 'Làm mới'}
                </button>
              </div>

              <div className="integration-list">
                {integrations.map((integration) => (
                  <div key={integration.provider} className="integration-card glass-card">
                    <div>
                      <div className="integration-card__title">{integration.provider}</div>
                      <div className="integration-card__meta">
                        {integration.accountLabel || integration.status}
                        {integration.connectedAt ? ` · ${new Date(integration.connectedAt).toLocaleDateString('vi-VN')}` : ''}
                      </div>
                      {integration.lastError && (
                        <div className="integration-card__error">{integration.lastError}</div>
                      )}
                    </div>
                    <div className="integration-card__actions">
                      {integration.status === 'connected' ? (
                        <button
                          type="button"
                          className="btn btn--ghost btn--sm"
                          disabled={integrationsLoading}
                          onClick={() => void disconnectIntegration(integration.provider)}
                        >
                          Disconnect
                        </button>
                      ) : (
                        <button
                          type="button"
                          className="btn btn--primary btn--sm"
                          disabled={integrationsLoading}
                          onClick={() => void beginConnect(integration.provider as IntegrationProvider)}
                        >
                          Connect
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </section>
          )}

          {stepIndex === 3 && (
            <section className="onboarding-section">
              <p className="onboarding-section__copy">
                Workspace đã sẵn sàng. Bạn có thể quay lại Chat và giao việc, trong khi Tasks, Memory và Status sẽ tiếp tục đồng bộ theo stream.
              </p>
              <div className="onboarding-grid">
                <SetupCard label="Connected channels" value={String(connectedProviders.length)} />
                <SetupCard label="Pending setup" value={onboardingState?.hasPendingSetup ? 'Yes' : 'No'} />
                <SetupCard label="Managed runner" value="Enabled" />
                <SetupCard label="Workspace" value="Chat + Tasks + Memory + Status" />
              </div>
            </section>
          )}
        </div>

        <div className="onboarding-modal__footer">
          <button type="button" className="btn btn--ghost" onClick={() => void dismissOnboarding()}>
            Skip for now
          </button>

          <div className="onboarding-modal__footer-actions">
            <button
              type="button"
              className="btn btn--ghost"
              disabled={stepIndex === 0}
              onClick={() => setStepIndex((current) => Math.max(0, current - 1))}
            >
              Back
            </button>
            {isLastStep ? (
              <button type="button" className="btn btn--primary" onClick={() => void completeOnboarding()}>
                Hoàn tất
              </button>
            ) : (
              <button
                type="button"
                className="btn btn--primary"
                onClick={() => setStepIndex((current) => Math.min(STEPS.length - 1, current + 1))}
              >
                Next
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function SetupCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="setup-card glass-card">
      <div className="setup-card__label">{label}</div>
      <div className="setup-card__value">{value}</div>
    </div>
  );
}
