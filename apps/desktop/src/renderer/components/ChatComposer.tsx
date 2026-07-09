import React, { useEffect, useRef, useState } from 'react';

/** An entry in the composer "+" menu — an integration / app / agent the host wires up. */
export interface ComposerMenuAction {
  id: string;
  label: string;
  description?: string;
  icon?: string;
  /** Optional section header to group items under (e.g. "Agent", "Ứng dụng"). */
  group?: string;
  onSelect: () => void;
}

interface ChatComposerProps {
  value: string;
  images: string[];
  disabled?: boolean;
  isSubmitting?: boolean;
  menuActions?: ComposerMenuAction[];
  onChange: (value: string) => void;
  onImagesChange: React.Dispatch<React.SetStateAction<string[]>>;
  onSubmit: () => void;
  /** When set + running, shows a Stop button that aborts the in-flight turn. */
  onCancel?: () => void;
  /** When set + running, lets the user inject a steering message mid-turn. */
  onInject?: (text: string) => void;
}

/** Max images per message + per-image size cap (keeps a paste/drop from ballooning the payload). */
const MAX_IMAGES = 4;
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;

type PermMode = 'chat' | 'agent' | 'agent-full';

/** Access the main-process agent-permission bridge (absent in browser dev). */
function permApi():
  | {
      getMode: () => Promise<PermMode>;
      setMode: (m: PermMode) => Promise<{ ok: boolean; mode: PermMode }>;
      getWorkingDir: () => Promise<{ dir: string }>;
      pickWorkingDir: () => Promise<{ dir: string }>;
      clearWorkingDir: () => Promise<{ dir: string }>;
    }
  | undefined {
  if (typeof window === 'undefined') return undefined;
  return (
    window as unknown as {
      electronAPI?: {
        agentPermission?: {
          getMode: () => Promise<PermMode>;
          setMode: (m: PermMode) => Promise<{ ok: boolean; mode: PermMode }>;
          getWorkingDir: () => Promise<{ dir: string }>;
          pickWorkingDir: () => Promise<{ dir: string }>;
          clearWorkingDir: () => Promise<{ dir: string }>;
        };
      };
    }
  ).electronAPI?.agentPermission;
}

/** Last path segment of a dir, for a compact chip label. */
function dirBasename(dir: string): string {
  if (!dir) return '';
  const parts = dir.replace(/[\\/]+$/, '').split(/[\\/]/);
  return parts[parts.length - 1] || dir;
}

export function ChatComposer({
  value,
  images,
  disabled = false,
  isSubmitting = false,
  menuActions,
  onChange,
  onImagesChange,
  onSubmit,
  onCancel,
  onInject,
}: ChatComposerProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const menuWrapRef = useRef<HTMLDivElement>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [permMode, setPermMode] = useState<PermMode>('chat');
  const [workingDir, setWorkingDir] = useState('');

  // Load the persisted agent permission mode + working directory once.
  useEffect(() => {
    const api = permApi();
    if (!api?.getMode) return;
    void api
      .getMode()
      .then((m) => {
        if (m === 'chat' || m === 'agent' || m === 'agent-full') setPermMode(m);
      })
      .catch(() => {
        /* browser dev / no bridge */
      });
    void api
      .getWorkingDir?.()
      .then((r) => setWorkingDir(r?.dir ?? ''))
      .catch(() => {
        /* ignore */
      });
  }, []);

  function changePermMode(m: PermMode) {
    setPermMode(m);
    void permApi()?.setMode?.(m).catch(() => {
      /* best-effort */
    });
  }

  function pickWorkingDir() {
    void permApi()
      ?.pickWorkingDir?.()
      .then((r) => setWorkingDir(r?.dir ?? ''))
      .catch(() => {
        /* ignore */
      });
  }

  function clearWorkingDir() {
    void permApi()
      ?.clearWorkingDir?.()
      .then((r) => setWorkingDir(r?.dir ?? ''))
      .catch(() => {
        /* ignore */
      });
  }

  useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    textarea.style.height = '0px';
    textarea.style.height = `${Math.min(textarea.scrollHeight, 180)}px`;
  }, [value]);

  // Close the "+" menu on outside-click or Escape.
  useEffect(() => {
    if (!menuOpen) return;
    function onDocMouseDown(e: MouseEvent) {
      if (!menuWrapRef.current?.contains(e.target as Node)) setMenuOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setMenuOpen(false);
    }
    document.addEventListener('mousedown', onDocMouseDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDocMouseDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [menuOpen]);

  const canSubmit = !disabled && (value.trim().length > 0 || images.length > 0);
  // While a turn is running (gateway host-agent path), the composer offers Stop
  // + lets the user inject a "steering" message instead of starting a new turn.
  const interruptible = isSubmitting && !!onCancel;
  const canInject = isSubmitting && !!onInject && value.trim().length > 0;

  function handleInject() {
    if (!onInject) return;
    const t = value.trim();
    if (!t) return;
    onInject(t);
    onChange('');
  }

  /** Shared path for paste / file-picker / drag-drop: read image files → data URLs → tray. */
  function addImageFiles(files: File[]) {
    for (const f of files) {
      if (!f.type.startsWith('image/') || f.size > MAX_IMAGE_BYTES) continue;
      const reader = new FileReader();
      reader.onload = () => {
        const url = typeof reader.result === 'string' ? reader.result : '';
        if (!url.startsWith('data:image/')) return;
        onImagesChange((prev) => (prev.length >= MAX_IMAGES ? prev : [...prev, url]));
      };
      reader.readAsDataURL(f);
    }
  }

  function handlePaste(event: React.ClipboardEvent<HTMLTextAreaElement>) {
    if (disabled) return;
    const items = event.clipboardData?.items;
    if (!items) return;
    const files: File[] = [];
    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      if (it.kind === 'file' && it.type.startsWith('image/')) {
        const f = it.getAsFile();
        if (f) files.push(f);
      }
    }
    // No image on the clipboard → let the normal text paste happen.
    if (files.length === 0) return;
    event.preventDefault();
    addImageFiles(files);
  }

  function handleFileInput(event: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? []);
    addImageFiles(files);
    event.target.value = ''; // allow re-picking the same file
  }

  function handleDrop(event: React.DragEvent<HTMLDivElement>) {
    const files = Array.from(event.dataTransfer?.files ?? []).filter((f) => f.type.startsWith('image/'));
    setDragOver(false);
    if (files.length === 0) return;
    event.preventDefault();
    if (disabled) return;
    addImageFiles(files);
  }

  function handleDragOver(event: React.DragEvent<HTMLDivElement>) {
    if (disabled) return;
    const hasFiles = Array.from(event.dataTransfer?.items ?? []).some((it) => it.kind === 'file');
    if (!hasFiles) return;
    event.preventDefault();
    if (!dragOver) setDragOver(true);
  }

  function removeImage(index: number) {
    onImagesChange((prev) => prev.filter((_, i) => i !== index));
  }

  // Group "+" menu actions by their section header (stable insertion order).
  const groups: Array<{ name: string; items: ComposerMenuAction[] }> = [];
  for (const action of menuActions ?? []) {
    const name = action.group ?? 'Khác';
    let g = groups.find((x) => x.name === name);
    if (!g) {
      g = { name, items: [] };
      groups.push(g);
    }
    g.items.push(action);
  }

  return (
    <div
      className={`chat-composer glass-surface${dragOver ? ' chat-composer--dragover' : ''}`}
      onDragOver={handleDragOver}
      onDragLeave={() => setDragOver(false)}
      onDrop={handleDrop}
    >
      {images.length > 0 && (
        <div className="chat-composer__attachments">
          {images.map((src, i) => (
            <div key={i} className="chat-composer__thumb">
              <img src={src} alt="Ảnh đã dán" />
              <button
                type="button"
                className="chat-composer__thumb-remove"
                title="Xoá ảnh"
                aria-label="Xoá ảnh"
                onClick={() => removeImage(i)}
              >
                ×
              </button>
            </div>
          ))}
        </div>
      )}
      <div className="chat-composer__row">
        <div className="chat-composer__add-wrap" ref={menuWrapRef}>
          <button
            type="button"
            className="chat-composer__add"
            title="Thêm ảnh & tích hợp"
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            disabled={disabled}
            onClick={() => setMenuOpen((v) => !v)}
          >
            +
          </button>
          {menuOpen && (
            <div className="chat-composer__menu" role="menu">
              <div className="chat-composer__menu-section">
                <div className="chat-composer__menu-label">Đính kèm</div>
                <button
                  type="button"
                  role="menuitem"
                  className="chat-composer__menu-item"
                  onClick={() => {
                    fileInputRef.current?.click();
                    setMenuOpen(false);
                  }}
                >
                  <span className="chat-composer__menu-icon" aria-hidden="true">🖼</span>
                  <span className="chat-composer__menu-text">
                    <span className="chat-composer__menu-item-label">Ảnh từ máy</span>
                    <span className="chat-composer__menu-item-desc">Chọn ảnh để agent đọc &amp; hiểu</span>
                  </span>
                </button>
              </div>
              {groups.map((group) => (
                <div key={group.name} className="chat-composer__menu-section">
                  <div className="chat-composer__menu-label">{group.name}</div>
                  {group.items.map((action) => (
                    <button
                      key={action.id}
                      type="button"
                      role="menuitem"
                      className="chat-composer__menu-item"
                      onClick={() => {
                        action.onSelect();
                        setMenuOpen(false);
                      }}
                    >
                      <span className="chat-composer__menu-icon" aria-hidden="true">{action.icon ?? '•'}</span>
                      <span className="chat-composer__menu-text">
                        <span className="chat-composer__menu-item-label">{action.label}</span>
                        {action.description && (
                          <span className="chat-composer__menu-item-desc">{action.description}</span>
                        )}
                      </span>
                    </button>
                  ))}
                </div>
              ))}
              <div className="chat-composer__menu-hint">Mẹo: dán ảnh (Ctrl+V) hoặc kéo-thả vào ô chat.</div>
            </div>
          )}
        </div>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          multiple
          className="chat-composer__file-input"
          onChange={handleFileInput}
        />
        <textarea
          ref={textareaRef}
          className="chat-composer__input"
          placeholder={
            interruptible
              ? 'Thêm điều chỉnh khi agent đang chạy — Enter để chèn...'
              : 'Giao việc cho agent, mô tả mục tiêu, hoặc dán ảnh (Ctrl+V)...'
          }
          value={value}
          disabled={disabled}
          rows={1}
          onChange={(event) => onChange(event.target.value)}
          onPaste={handlePaste}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault();
              if (interruptible) {
                if (value.trim()) handleInject();
              } else if (canSubmit) {
                onSubmit();
              }
            }
          }}
        />
        {interruptible ? (
          <div className="chat-composer__running-actions">
            {onInject && (
              <button
                type="button"
                className="btn btn--ghost chat-composer__inject"
                disabled={!canInject}
                onClick={handleInject}
                title="Chèn điều chỉnh vào lượt đang chạy"
              >
                Chèn
              </button>
            )}
            <button
              type="button"
              className="btn chat-composer__stop"
              onClick={onCancel}
              title="Dừng agent giữa chừng"
            >
              ⏹ Dừng
            </button>
          </div>
        ) : (
          <button
            type="button"
            className="btn btn--primary chat-composer__submit"
            disabled={!canSubmit}
            onClick={onSubmit}
          >
            {isSubmitting ? 'Đang gửi...' : 'Gửi'}
          </button>
        )}
      </div>
      <div className="chat-composer__footer">
        <label
          className="chat-composer__perm"
          title="Quyền của agent — Chat: chỉ trả lời (không đụng máy). Agent: chạy lệnh & sửa file nhưng hỏi bạn trước mỗi hành động rủi ro. Toàn quyền: tự chạy, không hỏi."
        >
          <span className="chat-composer__perm-icon" aria-hidden="true">
            {permMode === 'chat' ? '💬' : permMode === 'agent' ? '🛡️' : '⚡'}
          </span>
          <select
            className="chat-composer__perm-select"
            value={permMode}
            disabled={disabled}
            onChange={(e) => changePermMode(e.target.value as PermMode)}
            aria-label="Chế độ quyền của agent"
          >
            <option value="chat">Chat · chỉ trả lời</option>
            <option value="agent">Agent · hỏi trước khi chạy</option>
            <option value="agent-full">Agent · toàn quyền</option>
          </select>
        </label>
        {permMode === 'agent-full' && (
          <span className="chat-composer__perm-warn" title="Agent sẽ tự chạy lệnh và sửa file mà không hỏi.">
            ⚠️ tự chạy, không hỏi
          </span>
        )}
        {permMode !== 'chat' && (
          <span className="chat-composer__wd">
            <button
              type="button"
              className="chat-composer__wd-btn"
              title={workingDir ? `Thư mục làm việc: ${workingDir}` : 'Chọn thư mục dự án để agent chạy lệnh đúng chỗ'}
              disabled={disabled}
              onClick={pickWorkingDir}
            >
              📁 {workingDir ? dirBasename(workingDir) : 'Chọn thư mục làm việc'}
            </button>
            {workingDir && (
              <button
                type="button"
                className="chat-composer__wd-clear"
                title="Bỏ thư mục làm việc (dùng thư mục mặc định)"
                aria-label="Bỏ thư mục làm việc"
                disabled={disabled}
                onClick={clearWorkingDir}
              >
                ×
              </button>
            )}
          </span>
        )}
      </div>
    </div>
  );
}
