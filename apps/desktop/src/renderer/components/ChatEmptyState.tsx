import React from 'react';

const SUGGESTIONS = [
  'Lập kế hoạch triển khai app Windows và macOS trong 2 tuần tới.',
  'Phân tích khoảng trống giữa desktop app hiện tại và tryopenclaw.io.',
  'Viết backlog kỹ thuật cho phase chat, tasks và memory.',
];

export function ChatEmptyState({
  onUsePrompt,
  showFinishSetup,
  onFinishSetup,
}: {
  onUsePrompt: (prompt: string) => void;
  showFinishSetup?: boolean;
  onFinishSetup?: () => void;
}) {
  return (
    <div className="chat-empty-state glass-panel">
      <div className="chat-empty-state__eyebrow">Managed Runner</div>
      <h2 className="chat-empty-state__title">Giao việc cho Izzi OpenClaw agent</h2>
      <p className="chat-empty-state__description">
        Bắt đầu bằng một mục tiêu rõ ràng. Agent sẽ stream phản hồi theo tiến trình, tạo tasks và memory,
        và lưu lại lịch sử cục bộ ngay trên desktop app.
      </p>

      {showFinishSetup && (
        <div className="chat-empty-state__setup">
          <div>
            <div className="chat-empty-state__setup-title">Finish setup</div>
            <div className="chat-empty-state__setup-copy">
              Hoàn tất onboarding để kết nối Telegram, Discord và Zalo trước khi giao việc dài hạn cho agent.
            </div>
          </div>
          <button type="button" className="btn btn--ghost" onClick={onFinishSetup}>
            Mở onboarding
          </button>
        </div>
      )}

      <div className="chat-empty-state__prompts">
        {SUGGESTIONS.map((prompt) => (
          <button
            key={prompt}
            type="button"
            className="chat-empty-state__prompt"
            onClick={() => onUsePrompt(prompt)}
          >
            {prompt}
          </button>
        ))}
      </div>
    </div>
  );
}
