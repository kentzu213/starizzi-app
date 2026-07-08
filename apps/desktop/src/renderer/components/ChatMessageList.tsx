import React, { useEffect, useRef, useState } from 'react';
import type { ChatMessage } from '../../main/agent/types';
import type { AgentStep } from '../types/agent-registry';

/** Gateway messages may carry live process data + pasted images; read defensively (optional). */
type MessageWithProcess = ChatMessage & { reasoning?: string; steps?: AgentStep[]; images?: string[] };

function formatRole(role: ChatMessage['role']): string {
  if (role === 'assistant') return 'Agent';
  if (role === 'system') return 'System';
  return 'Bạn';
}

function formatState(message: ChatMessage): string | null {
  if (message.state === 'streaming') return 'Đang xử lý';
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
  const [copiedId, setCopiedId] = useState<string | null>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [messages]);

  async function copyMessage(message: ChatMessage) {
    const text = (message.content ?? '').trim();
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      setCopiedId(message.id);
      window.setTimeout(() => setCopiedId((id) => (id === message.id ? null : id)), 1500);
    } catch {
      // Clipboard unavailable — silently ignore (text is still selectable manually).
    }
  }

  return (
    <div className="chat-message-list glass-panel" role="log" aria-live="polite">
      {messages.map((message) => {
        const stateLabel = formatState(message);
        const isStreaming = message.state === 'streaming';
        const hasContent = (message.content ?? '').trim().length > 0;
        const bubbleClass =
          message.role === 'assistant'
            ? 'chat-message__bubble--assistant'
            : message.role === 'system'
              ? 'chat-message__bubble--system'
              : 'chat-message__bubble--user';

        const proc = message as MessageWithProcess;
        const steps = Array.isArray(proc.steps) ? proc.steps : [];
        const reasoning = typeof proc.reasoning === 'string' ? proc.reasoning : '';
        const images = Array.isArray(proc.images) ? proc.images.filter((s) => typeof s === 'string') : [];

        return (
          <article key={message.id} className={`chat-message chat-message--${message.role}`}>
            <div className="chat-message__meta">
              <span className="chat-message__author">{formatRole(message.role)}</span>
              {stateLabel && (
                <span className={`chat-message__state${isStreaming ? ' chat-message__state--streaming' : ''}`}>
                  {stateLabel}
                </span>
              )}
              {hasContent && (
                <button
                  type="button"
                  className="chat-message__copy"
                  onClick={() => void copyMessage(message)}
                  title="Sao chép nội dung"
                >
                  {copiedId === message.id ? '✓ Đã chép' : 'Sao chép'}
                </button>
              )}
            </div>
            <div className={`chat-message__bubble ${bubbleClass}`}>
              {images.length > 0 && (
                <div className="chat-message__images">
                  {images.map((src, i) => (
                    <img key={i} src={src} alt="Ảnh đính kèm" className="chat-message__image" />
                  ))}
                </div>
              )}
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
                <details className="chat-reasoning" open={isStreaming}>
                  <summary className="chat-reasoning__summary">💭 Suy nghĩ</summary>
                  <pre className="chat-reasoning__body">{reasoning}</pre>
                </details>
              )}
              {isStreaming && !hasContent && (
                <div className="chat-working" aria-label="Agent đang xử lý">
                  <span className="chat-working__dots" aria-hidden="true">
                    <i />
                    <i />
                    <i />
                  </span>
                  <span className="chat-working__label">
                    {reasoning.length > 0 ? 'Đang suy nghĩ…' : 'Agent đang xử lý…'}
                  </span>
                </div>
              )}
              {(hasContent || !isStreaming) && (
                <div className="chat-message__content">{message.content || ' '}</div>
              )}
            </div>
          </article>
        );
      })}
      <div ref={endRef} />
    </div>
  );
}
