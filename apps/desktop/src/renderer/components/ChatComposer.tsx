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
}

/** Max images per message + per-image size cap (keeps a paste/drop from ballooning the payload). */
const MAX_IMAGES = 4;
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;

export function ChatComposer({
  value,
  images,
  disabled = false,
  isSubmitting = false,
  menuActions,
  onChange,
  onImagesChange,
  onSubmit,
}: ChatComposerProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const menuWrapRef = useRef<HTMLDivElement>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [dragOver, setDragOver] = useState(false);

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
          placeholder="Giao việc cho agent, mô tả mục tiêu, hoặc dán ảnh (Ctrl+V)..."
          value={value}
          disabled={disabled}
          rows={1}
          onChange={(event) => onChange(event.target.value)}
          onPaste={handlePaste}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault();
              if (canSubmit) {
                onSubmit();
              }
            }
          }}
        />
        <button
          type="button"
          className="btn btn--primary chat-composer__submit"
          disabled={!canSubmit}
          onClick={onSubmit}
        >
          {isSubmitting ? 'Đang gửi...' : 'Gửi'}
        </button>
      </div>
    </div>
  );
}
