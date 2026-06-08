import React, { useEffect, useRef } from 'react';

interface ChatComposerProps {
  value: string;
  disabled?: boolean;
  isSubmitting?: boolean;
  onChange: (value: string) => void;
  onSubmit: () => void;
}

export function ChatComposer({
  value,
  disabled = false,
  isSubmitting = false,
  onChange,
  onSubmit,
}: ChatComposerProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    textarea.style.height = '0px';
    textarea.style.height = `${Math.min(textarea.scrollHeight, 180)}px`;
  }, [value]);

  return (
    <div className="chat-composer glass-surface">
      <textarea
        ref={textareaRef}
        className="chat-composer__input"
        placeholder="Giao việc cho agent, mô tả mục tiêu hoặc bước cần làm..."
        value={value}
        disabled={disabled}
        rows={1}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && !event.shiftKey) {
            event.preventDefault();
            if (!disabled && value.trim()) {
              onSubmit();
            }
          }
        }}
      />
      <button
        type="button"
        className="btn btn--primary chat-composer__submit"
        disabled={disabled || !value.trim()}
        onClick={onSubmit}
      >
        {isSubmitting ? 'Đang gửi...' : 'Gửi'}
      </button>
    </div>
  );
}
