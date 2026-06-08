import React from 'react';

/**
 * SkeletonCard — Placeholder loading animation for extension cards.
 * Shows a shimmer effect while real content loads.
 */
export function SkeletonCard() {
  return (
    <div className="skeleton-card glass-card" aria-hidden="true">
      <div className="skeleton-card__icon skeleton-pulse" />
      <div className="skeleton-card__body">
        <div className="skeleton-card__title skeleton-pulse" />
        <div className="skeleton-card__text skeleton-pulse" />
        <div className="skeleton-card__text skeleton-card__text--short skeleton-pulse" />
      </div>
    </div>
  );
}

/**
 * SkeletonGrid — Multiple skeleton cards in a grid layout.
 */
export function SkeletonGrid({ count = 6 }: { count?: number }) {
  return (
    <div className="marketplace-grid" role="status" aria-label="Đang tải...">
      {Array.from({ length: count }).map((_, i) => (
        <SkeletonCard key={i} />
      ))}
      <span className="sr-only">Đang tải danh sách tiện ích...</span>
    </div>
  );
}

/**
 * SkeletonStatCard — Placeholder for dashboard stat cards.
 */
export function SkeletonStatCard() {
  return (
    <div className="skeleton-stat glass-card" aria-hidden="true">
      <div className="skeleton-stat__icon skeleton-pulse" />
      <div className="skeleton-stat__value skeleton-pulse" />
      <div className="skeleton-stat__label skeleton-pulse" />
    </div>
  );
}
