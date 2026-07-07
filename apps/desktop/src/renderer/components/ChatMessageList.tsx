import React, { useEffect, useRef } from 'react';
import type { ChatMessage } from '../../main/agent/types';
import type { AgentStep } from '../types/agent-registry';

/** Gateway messages may carry live process data; read it defensively (optional). */
type MessageWithProcess = ChatMessage & { reasoning?: string; steps?: AgentStep[] };

function formatRole(role: ChatMessage['role']): string {
  if (role === 'assistant') return 'Agent';
  if (role === 'system') return 'System';
  return 'Bạn';
}

function formatState(message: ChatMessage): string | null {
  if (message.state === 'streaming') return 'Đang stream';
  if (message.state === 'error') return 'Gặp lỗi';
  return null;
}

function stepGlyph(status: AgentStep['status']): string {
  if (status === 'running') return '◌';
  if (status === 'error') return '✗';
  return '✓';
}

export function ChatMessageList({
  messages,
}: {
  messages: ChatMessage[];
}) {
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [messages]);

  return (
    <div className="chat-message-list glass-panel" role="log" aria-live="polite">
      {messages.map((message) => {
        const stateLabel = formatState(message);
        const bubbleClass =
          message.role === 'assistant'
            ? 'chat-message__bubble--assistant'
            : message.role === 'system'
              ? 'chat-message__bubble--system'
              : 'chat-message__bubble--user';

        const proc = message as MessageWithProcess;
        const steps = Array.isArray(proc.steps) ? proc.steps : [];
        const reasoning = typeof proc.reasoning === 'string' ? proc.reasoning : '';

        return (
          <article key={message.id} className={`chat-message chat-message--${message.role}`}>
            <div className="chat-message__meta">
              <span className="chat-message__author">{formatRole(message.role)}</span>
              {stateLabel && <span className="chat-message__state">{stateLabel}</span>}
            </div>
            <div className={`chat-message__bubble ${bubbleClass}`}>
              {steps.length > 0 && (
                <div className="chat-steps" aria-label="Các bước agent đang làm">
                  {steps.map((s) => (
                    <div key={s.id} className={`chat-step chat-step--${s.status}`}>
                      <span className="chat-step__glyph" aria-hidden="true">
                        {stepGlyph(s.status)}
                      </span>
                      <span className="chat-step__label">{s.label}</span>
                      {s.detail && <span className="chat-step__detail">{s.detail}</span>}
                    </div>
                  ))}
                </div>
              )}
              {reasoning.length > 0 && (
                <details className="chat-reasoning">
                  <summary className="chat-reasoning__summary">💭 Suy nghĩ</summary>
                  <pre className="chat-reasoning__body">{reasoning}</pre>
                </details>
              )}
              <div className="chat-message__content">{message.content || ' '}</div>
            </div>
          </article>
        );
      })}
      <div ref={endRef} />
    </div>
  );
}
