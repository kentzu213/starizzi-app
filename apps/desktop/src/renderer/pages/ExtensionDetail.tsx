import React, { useState, useEffect } from 'react';
import { apiClient } from '../lib/api-client';

interface ExtensionDetailProps {
  extension: {
    id: string;
    name: string;
    displayName: string;
    description: string;
    author: string;
    version: string;
    category: string;
    rating: number;
    installs: number;
    price: { monthly: number; yearly: number } | null;
    icon: string;
  };
  isInstalled: boolean;
  onInstall: () => void;
  isInstalling: boolean;
  onBack: () => void;
}

interface VersionEntry {
  version: string;
  date: string;
  changes: string[];
}

interface Review {
  id: string;
  user_name: string;
  rating: number;
  comment: string;
  created_at: string;
}

// Simulated changelog data (from API in production)
function getChangelog(_extensionId: string): VersionEntry[] {
  return [
    {
      version: '1.2.0',
      date: '2026-03-28',
      changes: [
        'Thêm tính năng quét SEO tự động hàng tuần',
        'Cải thiện hiệu suất phân tích meta tags',
        'Sửa lỗi crash khi quét trang có nhiều hình ảnh',
      ],
    },
    {
      version: '1.1.0',
      date: '2026-03-15',
      changes: [
        'Hỗ trợ phân tích Core Web Vitals',
        'Thêm báo cáo PDF xuất được',
        'Tích hợp Google Search Console API',
      ],
    },
    {
      version: '1.0.0',
      date: '2026-02-20',
      changes: [
        'Phiên bản đầu tiên',
        'Quét meta tags, title, description',
        'Kiểm tra broken links',
        'Phân tích cấu trúc heading',
      ],
    },
  ];
}

// Demo reviews
const DEMO_REVIEWS: Review[] = [
  { id: 'r1', user_name: 'NguyenDev', rating: 5, comment: 'Tiện ích rất hữu ích, quét SEO nhanh và chính xác!', created_at: '2026-03-20T10:30:00Z' },
  { id: 'r2', user_name: 'TranMarketer', rating: 4, comment: 'Giao diện đẹp, dễ sử dụng. Mong có thêm tính năng phân tích đối thủ.', created_at: '2026-03-18T14:00:00Z' },
  { id: 'r3', user_name: 'LeDesigner', rating: 5, comment: 'Xuất sắc! Core Web Vitals check rất nhanh.', created_at: '2026-03-10T09:15:00Z' },
];

export function ExtensionDetailPage({
  extension,
  isInstalled,
  onInstall,
  isInstalling,
  onBack,
}: ExtensionDetailProps) {
  const [activeTab, setActiveTab] = useState<'overview' | 'changelog' | 'reviews' | 'permissions'>('overview');
  const [changelog, setChangelog] = useState<VersionEntry[]>([]);
  const [reviews, setReviews] = useState<Review[]>([]);
  const [newRating, setNewRating] = useState(5);
  const [newComment, setNewComment] = useState('');
  const [reviewSubmitting, setReviewSubmitting] = useState(false);
  const [reviewToast, setReviewToast] = useState<string | null>(null);

  useEffect(() => {
    const data = getChangelog(extension.id);
    setChangelog(data);
    loadReviews();
  }, [extension.id]);

  async function loadReviews() {
    try {
      const res = await apiClient.getExtensionReviews(extension.id);
      if (res.reviews?.length > 0) {
        setReviews(res.reviews);
      } else {
        setReviews(DEMO_REVIEWS);
      }
    } catch {
      setReviews(DEMO_REVIEWS);
    }
  }

  async function submitReview() {
    if (!newComment.trim()) return;
    setReviewSubmitting(true);
    try {
      await apiClient.submitReview(extension.id, newRating, newComment);
      setReviewToast('Đánh giá đã được gửi!');
      setNewComment('');
      await loadReviews();
    } catch {
      setReviewToast('Cần đăng nhập để đánh giá');
    }
    setReviewSubmitting(false);
    setTimeout(() => setReviewToast(null), 3000);
  }

  function renderStars(rating: number): string {
    const full = Math.floor(rating);
    return '★'.repeat(full) + '☆'.repeat(5 - full);
  }

  function renderClickableStars(selected: number, onSelect: (n: number) => void) {
    return (
      <div className="review-stars-input">
        {[1, 2, 3, 4, 5].map(n => (
          <button
            key={n}
            className={`review-star-btn ${n <= selected ? 'review-star-btn--active' : ''}`}
            onClick={() => onSelect(n)}
            type="button"
          >
            ★
          </button>
        ))}
      </div>
    );
  }

  function formatInstalls(count: number): string {
    if (count >= 1000) return `${(count / 1000).toFixed(1)}k`;
    return String(count);
  }

  function formatDate(iso: string): string {
    const d = new Date(iso);
    return d.toLocaleDateString('vi-VN', { year: 'numeric', month: 'short', day: 'numeric' });
  }

  const tabs = [
    { id: 'overview' as const, label: 'Tổng quan' },
    { id: 'changelog' as const, label: 'Lịch sử cập nhật' },
    { id: 'reviews' as const, label: `Đánh giá (${reviews.length})` },
    { id: 'permissions' as const, label: 'Quyền truy cập' },
  ];

  return (
    <div className="ext-detail">
      {/* Back Button */}
      <button
        className="ext-detail__back"
        onClick={onBack}
      >
        ← Quay lại Marketplace
      </button>

      {/* Header */}
      <div className="ext-detail__header">
        <div className="ext-detail__icon">{extension.icon}</div>
        <div className="ext-detail__info">
          <h1 className="ext-detail__name">{extension.displayName}</h1>
          <div className="ext-detail__meta">
            <span className="ext-detail__author">by {extension.author}</span>
            <span className="ext-detail__separator">•</span>
            <span className="ext-detail__version">v{extension.version}</span>
            <span className="ext-detail__separator">•</span>
            <span className="ext-detail__category-tag">{extension.category}</span>
          </div>
          <div className="ext-detail__stats">
            <span className="ext-detail__rating">
              <span className="ext-detail__stars">{renderStars(extension.rating)}</span>
              {extension.rating.toFixed(1)}
            </span>
            <span className="ext-detail__separator">•</span>
            <span className="ext-detail__downloads">
              📥 {formatInstalls(extension.installs)} lượt cài đặt
            </span>
          </div>
        </div>
        <div className="ext-detail__actions">
          {extension.price ? (
            <div className="ext-detail__pricing">
              <span className="ext-detail__price-amount">${extension.price.monthly}</span>
              <span className="ext-detail__price-period">/tháng</span>
              <span className="ext-detail__price-yearly">
                hoặc ${extension.price.yearly}/năm
              </span>
            </div>
          ) : (
            <span className="ext-detail__free-badge">Miễn phí</span>
          )}
          {isInstalled ? (
            <button className="btn btn--installed" disabled>
              ✓ Đã cài đặt
            </button>
          ) : (
            <button
              className="btn btn--primary"
              onClick={onInstall}
              disabled={isInstalling}
            >
              {isInstalling ? '⏳ Đang cài...' : '📦 Cài đặt ngay'}
            </button>
          )}
        </div>
      </div>

      {/* Tabs */}
      <div className="ext-detail__tabs">
        {tabs.map(tab => (
          <button
            key={tab.id}
            className={`ext-detail__tab ${activeTab === tab.id ? 'ext-detail__tab--active' : ''}`}
            onClick={() => setActiveTab(tab.id)}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Tab Content */}
      <div className="ext-detail__content">
        {activeTab === 'overview' && (
          <div className="ext-detail__overview">
            <div className="ext-detail__section">
              <h3 className="ext-detail__section-title">Mô tả</h3>
              <p className="ext-detail__description">{extension.description}</p>
            </div>

            <div className="ext-detail__section">
              <h3 className="ext-detail__section-title">Tính năng chính</h3>
              <div className="ext-detail__features">
                <div className="ext-detail__feature">
                  <span className="ext-detail__feature-icon">⚡</span>
                  <span>Chạy nhanh, tối ưu hiệu suất</span>
                </div>
                <div className="ext-detail__feature">
                  <span className="ext-detail__feature-icon">🔒</span>
                  <span>Bảo mật, sandbox cách ly</span>
                </div>
                <div className="ext-detail__feature">
                  <span className="ext-detail__feature-icon">🔄</span>
                  <span>Tự động cập nhật</span>
                </div>
                <div className="ext-detail__feature">
                  <span className="ext-detail__feature-icon">🌐</span>
                  <span>Hỗ trợ tiếng Việt</span>
                </div>
              </div>
            </div>

            <div className="ext-detail__section">
              <h3 className="ext-detail__section-title">Thông tin</h3>
              <div className="ext-detail__info-grid">
                <div className="ext-detail__info-item">
                  <span className="ext-detail__info-label">Nhà phát triển</span>
                  <span className="ext-detail__info-value">{extension.author}</span>
                </div>
                <div className="ext-detail__info-item">
                  <span className="ext-detail__info-label">Phiên bản</span>
                  <span className="ext-detail__info-value">{extension.version}</span>
                </div>
                <div className="ext-detail__info-item">
                  <span className="ext-detail__info-label">Danh mục</span>
                  <span className="ext-detail__info-value">{extension.category}</span>
                </div>
                <div className="ext-detail__info-item">
                  <span className="ext-detail__info-label">Lượt cài</span>
                  <span className="ext-detail__info-value">{formatInstalls(extension.installs)}</span>
                </div>
              </div>
            </div>
          </div>
        )}

        {activeTab === 'changelog' && (
          <div className="ext-detail__changelog">
            {changelog.map((entry, i) => (
              <div key={entry.version} className="ext-detail__changelog-entry animate-in" style={{ animationDelay: `${i * 80}ms` }}>
                <div className="ext-detail__changelog-header">
                  <span className="ext-detail__changelog-version">v{entry.version}</span>
                  <span className="ext-detail__changelog-date">{entry.date}</span>
                  {i === 0 && <span className="ext-detail__changelog-latest">Mới nhất</span>}
                </div>
                <ul className="ext-detail__changelog-list">
                  {entry.changes.map((change, j) => (
                    <li key={j} className="ext-detail__changelog-item">{change}</li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        )}

        {/* ── REVIEWS TAB (NEW) ── */}
        {activeTab === 'reviews' && (
          <div className="ext-detail__reviews">
            {/* Submit Review Form */}
            <div className="review-form">
              <h4 className="review-form__title">Viết đánh giá</h4>
              <div className="review-form__rating">
                <label className="review-form__label">Đánh giá:</label>
                {renderClickableStars(newRating, setNewRating)}
              </div>
              <textarea
                className="review-form__textarea"
                placeholder="Chia sẻ trải nghiệm của bạn với tiện ích này..."
                value={newComment}
                onChange={e => setNewComment(e.target.value)}
                rows={3}
              />
              <button
                className="btn btn--primary btn--sm"
                onClick={submitReview}
                disabled={reviewSubmitting || !newComment.trim()}
              >
                {reviewSubmitting ? '⏳ Đang gửi...' : '📝 Gửi đánh giá'}
              </button>
            </div>

            {/* Review List */}
            <div className="review-list">
              {reviews.map((review, i) => (
                <div key={review.id} className="review-card animate-in" style={{ animationDelay: `${i * 60}ms` }}>
                  <div className="review-card__header">
                    <div className="review-card__avatar">
                      {review.user_name.charAt(0).toUpperCase()}
                    </div>
                    <div className="review-card__meta">
                      <span className="review-card__name">{review.user_name}</span>
                      <span className="review-card__date">{formatDate(review.created_at)}</span>
                    </div>
                    <span className="review-card__stars">{renderStars(review.rating)}</span>
                  </div>
                  <p className="review-card__comment">{review.comment}</p>
                </div>
              ))}
              {reviews.length === 0 && (
                <div className="review-empty">
                  <span className="review-empty__icon">💬</span>
                  <p>Chưa có đánh giá nào. Hãy là người đầu tiên!</p>
                </div>
              )}
            </div>

            {/* Review toast */}
            {reviewToast && (
              <div className="review-toast">{reviewToast}</div>
            )}
          </div>
        )}

        {activeTab === 'permissions' && (
          <div className="ext-detail__permissions">
            <p className="ext-detail__permissions-intro">
              Tiện ích này yêu cầu các quyền sau để hoạt động:
            </p>
            <div className="ext-detail__permission-list">
              {['network', 'storage'].map(perm => (
                <div key={perm} className="ext-detail__permission-item">
                  <span className="ext-detail__permission-icon">
                    {perm === 'network' ? '🌐' : '💾'}
                  </span>
                  <div>
                    <div className="ext-detail__permission-name">
                      {perm === 'network' ? 'Truy cập mạng' : 'Lưu trữ dữ liệu'}
                    </div>
                    <div className="ext-detail__permission-desc">
                      {perm === 'network'
                        ? 'Gửi và nhận dữ liệu qua internet để hoạt động'
                        : 'Lưu cài đặt và cache dữ liệu trên máy'}
                    </div>
                  </div>
                </div>
              ))}
            </div>
            <div className="ext-detail__security-note">
              <span>🛡️</span>
              <span>
                Tất cả tiện ích chạy trong sandbox cách ly, đảm bảo an toàn cho dữ liệu của bạn.
                Mã nguồn được xác minh SHA-256 trước khi cài đặt.
              </span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
