import React, { useState, useRef, useCallback } from 'react';
import { apiClient } from '../lib/api-client';

interface UploadState {
  file: File | null;
  progress: number; // 0-100
  status: 'idle' | 'validating' | 'uploading' | 'success' | 'error';
  error: string | null;
  result: {
    path: string;
    size: number;
    sha256: string;
    version: string;
  } | null;
}

interface ExtensionForm {
  name: string;
  display_name: string;
  description: string;
  version: string;
  category: string;
}

const CATEGORIES = ['SEO', 'Marketing', 'Content', 'Analytics', 'Email', 'Customer Support'];

export function DeveloperUploadPage({ onBack }: { onBack: () => void }) {
  const [step, setStep] = useState<1 | 2>(1);
  const [form, setForm] = useState<ExtensionForm>({
    name: '',
    display_name: '',
    description: '',
    version: '1.0.0',
    category: 'SEO',
  });
  const [extensionId, setExtensionId] = useState<string | null>(null);

  const [upload, setUpload] = useState<UploadState>({
    file: null,
    progress: 0,
    status: 'idle',
    error: null,
    result: null,
  });

  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [formError, setFormError] = useState<string | null>(null);

  // ── Step 1: Register Extension ──

  function updateForm(key: keyof ExtensionForm, value: string) {
    setForm(prev => ({ ...prev, [key]: value }));
    setFormError(null);
  }

  async function handleRegister() {
    // Validate
    if (!form.name.trim() || !form.display_name.trim() || !form.description.trim()) {
      setFormError('Vui lòng điền đầy đủ thông tin tiện ích');
      return;
    }
    if (!/^[a-z0-9-]+$/.test(form.name)) {
      setFormError('Tên kỹ thuật chỉ chấp nhận chữ thường, số và dấu gạch ngang');
      return;
    }
    if (!/^\d+\.\d+\.\d+$/.test(form.version)) {
      setFormError('Phiên bản phải theo định dạng x.y.z (VD: 1.0.0)');
      return;
    }

    try {
      const res = await apiClient.publishExtension({
        name: form.name,
        display_name: form.display_name,
        description: form.description,
        version: form.version,
        category: form.category,
      });
      setExtensionId(res.extension?.id || res.id || 'new-ext');
      setStep(2);
    } catch (err: unknown) {
      setFormError(err instanceof Error ? err.message : 'Lỗi đăng ký tiện ích');
    }
  }

  // ── Step 2: Upload Binary ──

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) validateAndSetFile(file);
  }, []);

  function handleFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) validateAndSetFile(file);
  }

  function validateAndSetFile(file: File) {
    setUpload(prev => ({ ...prev, status: 'validating', error: null }));

    // Validate extension
    if (!file.name.endsWith('.ocx') && !file.name.endsWith('.tar.gz')) {
      setUpload(prev => ({ ...prev, status: 'error', error: 'Chỉ chấp nhận file .ocx hoặc .tar.gz' }));
      return;
    }

    // Validate size (50MB limit)
    if (file.size > 50 * 1024 * 1024) {
      setUpload(prev => ({ ...prev, status: 'error', error: 'File quá lớn! Giới hạn 50MB' }));
      return;
    }

    setUpload(prev => ({ ...prev, file, status: 'idle', error: null, progress: 0, result: null }));
  }

  async function handleUpload() {
    if (!upload.file || !extensionId) return;

    setUpload(prev => ({ ...prev, status: 'uploading', progress: 10 }));

    try {
      // Simulate progress (real progress would use XMLHttpRequest)
      const progressTimer = setInterval(() => {
        setUpload(prev => {
          if (prev.progress >= 90) {
            clearInterval(progressTimer);
            return prev;
          }
          return { ...prev, progress: prev.progress + 15 };
        });
      }, 300);

      const formData = new FormData();
      formData.append('file', upload.file);
      formData.append('version', form.version);

      const res = await fetch(`http://localhost:8788/api/extensions/${extensionId}/upload`, {
        method: 'POST',
        body: formData,
      });

      clearInterval(progressTimer);

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error?.message || `Upload failed: HTTP ${res.status}`);
      }

      const data = await res.json();

      setUpload(prev => ({
        ...prev,
        status: 'success',
        progress: 100,
        result: data.binary,
      }));
    } catch (err: unknown) {
      setUpload(prev => ({
        ...prev,
        status: 'error',
        progress: 0,
        error: err instanceof Error ? err.message : 'Upload thất bại',
      }));
    }
  }

  function formatFileSize(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  function resetUpload() {
    setUpload({ file: null, progress: 0, status: 'idle', error: null, result: null });
    if (fileInputRef.current) fileInputRef.current.value = '';
  }

  return (
    <div className="dev-upload">
      {/* Back */}
      <button className="ext-detail__back" onClick={onBack}>
        ← Quay lại Marketplace
      </button>

      {/* Header */}
      <div className="page-header">
        <h1 className="page-header__title">🚀 Đăng tải tiện ích</h1>
        <p className="page-header__subtitle">
          Xuất bản tiện ích mở rộng lên Izzi OpenClaw Marketplace
        </p>
      </div>

      {/* Step Indicator */}
      <div className="dev-upload__steps">
        <div className={`dev-upload__step ${step >= 1 ? 'dev-upload__step--active' : ''} ${step > 1 ? 'dev-upload__step--done' : ''}`}>
          <span className="dev-upload__step-num">{step > 1 ? '✓' : '1'}</span>
          <span className="dev-upload__step-label">Thông tin tiện ích</span>
        </div>
        <div className="dev-upload__step-line" />
        <div className={`dev-upload__step ${step >= 2 ? 'dev-upload__step--active' : ''}`}>
          <span className="dev-upload__step-num">2</span>
          <span className="dev-upload__step-label">Upload binary</span>
        </div>
      </div>

      {/* Step 1: Extension Info Form */}
      {step === 1 && (
        <div className="dev-upload__form animate-in">
          <div className="dev-upload__field">
            <label className="dev-upload__label">Tên kỹ thuật <span className="dev-upload__required">*</span></label>
            <input
              className="dev-upload__input"
              type="text"
              placeholder="smart-seo-scanner"
              value={form.name}
              onChange={e => updateForm('name', e.target.value)}
            />
            <span className="dev-upload__hint">Chữ thường, số, dấu gạch ngang. Không thay đổi được sau đăng ký.</span>
          </div>

          <div className="dev-upload__field">
            <label className="dev-upload__label">Tên hiển thị <span className="dev-upload__required">*</span></label>
            <input
              className="dev-upload__input"
              type="text"
              placeholder="Smart SEO Scanner"
              value={form.display_name}
              onChange={e => updateForm('display_name', e.target.value)}
            />
          </div>

          <div className="dev-upload__field">
            <label className="dev-upload__label">Mô tả <span className="dev-upload__required">*</span></label>
            <textarea
              className="dev-upload__textarea"
              placeholder="Mô tả chi tiết về tiện ích của bạn..."
              value={form.description}
              onChange={e => updateForm('description', e.target.value)}
              rows={4}
            />
          </div>

          <div className="dev-upload__row">
            <div className="dev-upload__field">
              <label className="dev-upload__label">Phiên bản</label>
              <input
                className="dev-upload__input"
                type="text"
                placeholder="1.0.0"
                value={form.version}
                onChange={e => updateForm('version', e.target.value)}
              />
            </div>
            <div className="dev-upload__field">
              <label className="dev-upload__label">Danh mục</label>
              <select
                className="dev-upload__select"
                value={form.category}
                onChange={e => updateForm('category', e.target.value)}
              >
                {CATEGORIES.map(c => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
            </div>
          </div>

          {formError && (
            <div className="dev-upload__error">⚠️ {formError}</div>
          )}

          <button className="btn btn--primary dev-upload__register-btn" onClick={handleRegister}>
            Tiếp tục → Upload Binary
          </button>
        </div>
      )}

      {/* Step 2: Upload Binary */}
      {step === 2 && (
        <div className="dev-upload__upload animate-in">
          {/* Drag & Drop Zone */}
          <div
            className={`dev-upload__dropzone ${isDragging ? 'dev-upload__dropzone--active' : ''} ${upload.status === 'error' ? 'dev-upload__dropzone--error' : ''}`}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
            onClick={() => fileInputRef.current?.click()}
          >
            <input
              ref={fileInputRef}
              type="file"
              accept=".ocx,.tar.gz"
              className="dev-upload__file-input"
              onChange={handleFileSelect}
            />

            {upload.status === 'success' ? (
              <div className="dev-upload__success-icon">
                <span className="dev-upload__success-glyph">✅</span>
                <p className="dev-upload__success-text">Upload thành công!</p>
              </div>
            ) : upload.file ? (
              <div className="dev-upload__file-info">
                <span className="dev-upload__file-glyph">📦</span>
                <div>
                  <div className="dev-upload__filename">{upload.file.name}</div>
                  <div className="dev-upload__filesize">{formatFileSize(upload.file.size)}</div>
                </div>
                <button
                  className="dev-upload__remove"
                  onClick={(e) => { e.stopPropagation(); resetUpload(); }}
                >
                  ✕
                </button>
              </div>
            ) : (
              <>
                <span className="dev-upload__drop-glyph">📂</span>
                <p className="dev-upload__drop-text">
                  Kéo thả file <strong>.ocx</strong> vào đây
                </p>
                <p className="dev-upload__drop-hint">hoặc nhấn để chọn file • Giới hạn 50MB</p>
              </>
            )}
          </div>

          {/* Progress Bar */}
          {(upload.status === 'uploading' || upload.status === 'success') && (
            <div className="dev-upload__progress">
              <div className="dev-upload__progress-bar">
                <div
                  className={`dev-upload__progress-fill ${upload.status === 'success' ? 'dev-upload__progress-fill--done' : ''}`}
                  style={{ width: `${upload.progress}%` }}
                />
              </div>
              <span className="dev-upload__progress-text">
                {upload.status === 'success' ? '✓ Hoàn tất' : `${upload.progress}%`}
              </span>
            </div>
          )}

          {/* Error */}
          {upload.error && (
            <div className="dev-upload__error">⚠️ {upload.error}</div>
          )}

          {/* Upload Result */}
          {upload.result && (
            <div className="dev-upload__result animate-in">
              <h4 className="dev-upload__result-title">📋 Thông tin binary</h4>
              <div className="dev-upload__result-grid">
                <div className="dev-upload__result-item">
                  <span className="dev-upload__result-label">Version</span>
                  <span className="dev-upload__result-value">{upload.result.version}</span>
                </div>
                <div className="dev-upload__result-item">
                  <span className="dev-upload__result-label">Size</span>
                  <span className="dev-upload__result-value">{formatFileSize(upload.result.size)}</span>
                </div>
                <div className="dev-upload__result-item dev-upload__result-item--full">
                  <span className="dev-upload__result-label">SHA-256</span>
                  <span className="dev-upload__result-value dev-upload__result-value--mono">
                    {upload.result.sha256.substring(0, 32)}...
                  </span>
                </div>
              </div>
            </div>
          )}

          {/* Actions */}
          <div className="dev-upload__actions">
            <button
              className="btn btn--ghost"
              onClick={() => setStep(1)}
              disabled={upload.status === 'uploading'}
            >
              ← Quay lại
            </button>
            {upload.status === 'success' ? (
              <button className="btn btn--primary" onClick={onBack}>
                🏪 Về Marketplace
              </button>
            ) : (
              <button
                className="btn btn--primary"
                onClick={handleUpload}
                disabled={!upload.file || upload.status === 'uploading'}
              >
                {upload.status === 'uploading' ? '⏳ Đang upload...' : '🚀 Upload Binary'}
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
