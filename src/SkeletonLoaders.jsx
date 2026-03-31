/**
 * Smart Grocery - Skeleton Loaders
 * Shimmer animation loading states for premium UX
 */

import './SkeletonLoaders.css';

const getChatSkeletonWidth = (index) => `${60 + ((index % 4) * 8)}%`;
const getCategoryPillWidth = (index) => `${54 + ((index % 5) * 7)}px`;

// ── Base Skeleton Component ────────────────────────────────────────────────────
export function Skeleton({
  width = '100%',
  height = '16px',
  borderRadius = '8px',
  style = {},
  className = '',
}) {
  return (
    <div
      className={`skeleton ${className}`}
      style={{
        width,
        height,
        borderRadius,
        ...style,
      }}
    />
  );
}

// ── Product Card Skeleton ───────────────────────────────────────────────────
export function ProductCardSkeleton({ index = 0 }) {
  return (
    <div
      className="skeleton-card"
      style={{ animationDelay: `${index * 0.08}s` }}
    >
      <div className="skeleton-card-header">
        <Skeleton width="40px" height="40px" borderRadius="10px" />
        <div className="skeleton-card-info">
          <Skeleton width="70%" height="14px" />
          <Skeleton width="40%" height="10px" style={{ marginTop: '6px' }} />
        </div>
      </div>
      <Skeleton height="38px" borderRadius="10px" style={{ marginTop: '10px' }} />
      <div className="skeleton-card-tags">
        <Skeleton width="60px" height="22px" borderRadius="12px" />
        <Skeleton width="45px" height="22px" borderRadius="12px" />
        <Skeleton width="55px" height="22px" borderRadius="12px" />
      </div>
    </div>
  );
}

// ── Recipe Card Skeleton ─────────────────────────────────────────────────────
export function RecipeCardSkeleton({ index = 0 }) {
  return (
    <div
      className="skeleton-recipe-card"
      style={{ animationDelay: `${index * 0.1}s` }}
    >
      <Skeleton height="120px" borderRadius="16px 16px 0 0" />
      <div className="skeleton-recipe-content">
        <Skeleton width="80%" height="16px" />
        <Skeleton width="50%" height="12px" style={{ marginTop: '8px' }} />
        <div className="skeleton-recipe-meta">
          <Skeleton width="60px" height="24px" borderRadius="8px" />
          <Skeleton width="60px" height="24px" borderRadius="8px" />
        </div>
      </div>
    </div>
  );
}

// ── List Item Skeleton ───────────────────────────────────────────────────────
export function ListItemSkeleton({ index = 0 }) {
  return (
    <div
      className="skeleton-list-item"
      style={{ animationDelay: `${index * 0.05}s` }}
    >
      <Skeleton width="20px" height="20px" borderRadius="6px" />
      <Skeleton width="100%" height="18px" borderRadius="6px" />
      <Skeleton width="50px" height="16px" borderRadius="8px" />
    </div>
  );
}

// ── Budget Banner Skeleton ──────────────────────────────────────────────────
export function BudgetBannerSkeleton() {
  return (
    <div className="skeleton-budget">
      <div className="skeleton-budget-header">
        <Skeleton width="120px" height="20px" />
        <Skeleton width="80px" height="28px" borderRadius="14px" />
      </div>
      <Skeleton height="8px" borderRadius="4px" style={{ marginTop: '14px' }} />
      <Skeleton width="60%" height="14px" style={{ marginTop: '12px' }} />
      <div className="skeleton-budget-stats">
        <Skeleton width="80px" height="36px" borderRadius="10px" />
        <Skeleton width="80px" height="36px" borderRadius="10px" />
        <Skeleton width="80px" height="36px" borderRadius="10px" />
      </div>
    </div>
  );
}

// ── Scanner Skeleton ────────────────────────────────────────────────────────
export function ScannerSkeleton() {
  return (
    <div className="skeleton-scanner">
      <div className="skeleton-scanner-viewfinder">
        <div className="skeleton-scanner-icon">
          <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
            <path d="M3 7V5a2 2 0 0 1 2-2h2M17 3h2a2 2 0 0 1 2 2v2M21 17v2a2 2 0 0 1-2 2h-2M7 21H5a2 2 0 0 1-2-2v-2"/>
            <rect x="7" y="7" width="10" height="10" rx="1"/>
          </svg>
        </div>
        <Skeleton width="60%" height="14px" style={{ marginTop: '16px' }} />
      </div>
      <div className="skeleton-scanner-hint">
        <Skeleton width="100%" height="50px" borderRadius="12px" />
      </div>
    </div>
  );
}

// ── Chat Message Skeleton ──────────────────────────────────────────────────
export function ChatMessageSkeleton({ isUser = false, index = 0 }) {
  return (
    <div
      className={`skeleton-chat-message ${isUser ? 'user' : 'bot'}`}
      style={{ animationDelay: `${index * 0.15}s` }}
    >
      <Skeleton width="36px" height="36px" borderRadius="50%" />
      <div className="skeleton-chat-bubble">
        <Skeleton width={getChatSkeletonWidth(index)} height="14px" />
        <Skeleton width="40%" height="14px" style={{ marginTop: '6px' }} />
      </div>
    </div>
  );
}

// ── Nutrition Grid Skeleton ────────────────────────────────────────────────
export function NutritionGridSkeleton() {
  return (
    <div className="skeleton-nutrition-grid">
      {[1, 2, 3, 4, 5, 6].map((i) => (
        <div key={i} className="skeleton-nutrition-cell" style={{ animationDelay: `${i * 0.06}s` }}>
          <Skeleton width="50px" height="24px" borderRadius="8px" />
          <Skeleton width="35px" height="10px" style={{ marginTop: '8px' }} />
        </div>
      ))}
    </div>
  );
}

// ── Category Pills Skeleton ─────────────────────────────────────────────────
export function CategoryPillsSkeleton() {
  return (
    <div className="skeleton-category-pills">
      {[1, 2, 3, 4, 5, 6, 7, 8].map((i) => (
        <Skeleton
          key={i}
          width={getCategoryPillWidth(i)}
          height="32px"
          borderRadius="16px"
          style={{ animationDelay: `${i * 0.04}s` }}
        />
      ))}
    </div>
  );
}

// ── Friend Card Skeleton ────────────────────────────────────────────────────
export function FriendCardSkeleton({ index = 0 }) {
  return (
    <div
      className="skeleton-friend-card"
      style={{ animationDelay: `${index * 0.07}s` }}
    >
      <Skeleton width="48px" height="48px" borderRadius="50%" />
      <div className="skeleton-friend-info">
        <Skeleton width="100px" height="16px" />
        <Skeleton width="70px" height="12px" style={{ marginTop: '6px' }} />
      </div>
      <Skeleton width="70px" height="30px" borderRadius="15px" />
    </div>
  );
}

// ── Full Page Loading ───────────────────────────────────────────────────────
export function FullPageLoader({ message = 'Φόρτωση...' }) {
  return (
    <div className="skeleton-full-page">
      <div className="skeleton-pulse-logo">
        <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
          <path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z"/>
          <line x1="3" y1="6" x2="21" y2="6"/>
          <path d="M16 10a4 4 0 0 1-8 0"/>
        </svg>
      </div>
      <p className="skeleton-loading-text">{message}</p>
      <div className="skeleton-dots">
        <span />
        <span />
        <span />
      </div>
    </div>
  );
}

// ── Animated List Container ─────────────────────────────────────────────────
export function SkeletonList({ count = 5, type = 'product', children }) {
  if (children) return children;

  const skeletons = {
    product: Array.from({ length: count }, (_, i) => <ProductCardSkeleton key={i} index={i} />),
    recipe: Array.from({ length: count }, (_, i) => <RecipeCardSkeleton key={i} index={i} />),
    list: Array.from({ length: count }, (_, i) => <ListItemSkeleton key={i} index={i} />),
    friend: Array.from({ length: count }, (_, i) => <FriendCardSkeleton key={i} index={i} />),
  };

  return (
    <div className={`skeleton-list skeleton-list-${type}`}>
      {skeletons[type] || skeletons.product}
    </div>
  );
}
