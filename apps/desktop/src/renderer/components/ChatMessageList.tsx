import React, { useEffect, useRef } from 'react';
import type { ChatMessage } from '../../main/agent/types';

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

        return (
          <article key={message.id} className={`chat-message chat-message--${message.role}`}>
            <div className="chat-message__meta">
              <span className="chat-message__author">{formatRole(message.role)}</span>
              {stateLabel && <span className="chat-message__state">{stateLabel}</span>}
            </div>
            <div className={`chat-message__bubble ${bubbleClass}`}>
              <div className="chat-message__content">{message.content || ' '}</div>
            </div>
          </article>
        );
      })}
      <div ref={endRef} />
    </div>
  );
}
