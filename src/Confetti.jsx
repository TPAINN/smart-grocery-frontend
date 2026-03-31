/**
 * Smart Grocery - Confetti Celebration Component
 * Beautiful confetti animations for achievements and completions
 */

import { useEffect, useMemo, useState } from 'react';
import './Confetti.css';

// Confetti colors matching the app's premium palette
const CONFETTI_COLORS = [
  '#6366f1', // Primary purple
  '#8b5cf6', // Light purple
  '#a78bfa', // Lighter purple
  '#22c55e', // Success green
  '#10b981', // Emerald
  '#f59e0b', // Amber
  '#f97316', // Orange
  '#ec4899', // Pink
  '#06b6d4', // Cyan
];

// Emoji confetti for fun celebrations
const EMOJI_CONFETTI = ['🎉', '✨', '🎊', '💚', '⭐', '🌟', '💫', '🎈'];

/**
 * Generate random confetti piece
 */
function generateConfettiPiece(index) {
  const isEmoji = Math.random() > 0.7;
  return {
    id: index,
    x: Math.random() * 100,
    delay: Math.random() * 0.8,
    duration: 2 + Math.random() * 2,
    size: 8 + Math.random() * 8,
    color: CONFETTI_COLORS[Math.floor(Math.random() * CONFETTI_COLORS.length)],
    rotation: Math.random() * 360,
    rotationSpeed: (Math.random() - 0.5) * 720,
    drift: (Math.random() - 0.5) * 30,
    endY: -100 - Math.random() * 50,
    emoji: isEmoji ? EMOJI_CONFETTI[Math.floor(Math.random() * EMOJI_CONFETTI.length)] : null,
    shape: ['square', 'circle', 'strip'][Math.floor(Math.random() * 3)],
  };
}

/**
 * Success Checkmark SVG Component
 */
export function SuccessCheckmark({ size = 64, color = '#22c55e' }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      className="success-checkmark"
    >
      <circle
        cx="12"
        cy="12"
        r="11"
        stroke={color}
        strokeWidth="2"
        fill={`${color}15`}
      />
      <path
        d="M7 12l3 3 7-7"
        stroke={color}
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="checkmark-path"
      />
    </svg>
  );
}

/**
 * Confetti Overlay Component
 */
export function Confetti({ isActive, onComplete, count = 80, duration = 3000 }) {
  const pieces = useMemo(
    () => (isActive ? Array.from({ length: count }, (_, i) => generateConfettiPiece(i)) : []),
    [isActive, count]
  );

  useEffect(() => {
    if (!isActive) return undefined;

    const timer = setTimeout(() => {
      onComplete?.();
    }, duration);

    return () => clearTimeout(timer);
  }, [isActive, duration, onComplete]);

  if (!isActive || pieces.length === 0) return null;

  return (
    <div className="confetti-overlay">
      {pieces.map((piece) => (
        <div
          key={piece.id}
          className={`confetti-piece confetti-${piece.shape}`}
          style={{
            left: `${piece.x}%`,
            animationDelay: `${piece.delay}s`,
            animationDuration: `${piece.duration}s`,
            '--drift': `${piece.drift}px`,
            '--rotation-speed': `${piece.rotationSpeed}deg`,
            backgroundColor: piece.color,
            width: piece.size,
            height: piece.size,
            borderRadius: piece.shape === 'circle' ? '50%' : piece.shape === 'strip' ? '2px' : '2px',
          }}
        >
          {piece.emoji && <span className="confetti-emoji">{piece.emoji}</span>}
        </div>
      ))}
    </div>
  );
}

/**
 * Celebration Modal for completing shopping list
 */
export function CelebrationModal({ isOpen, onClose, stats }) {
  const [showContent, setShowContent] = useState(false);

  useEffect(() => {
    if (isOpen) {
      const timer = setTimeout(() => setShowContent(true), 300);
      return () => clearTimeout(timer);
    }
  }, [isOpen]);

  if (!isOpen) return null;

  return (
    <div className="celebration-backdrop" onClick={onClose}>
      <div 
        className={`celebration-modal ${showContent ? 'show' : ''}`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="celebration-icon">
          <SuccessCheckmark size={80} />
        </div>
        
        <h2 className="celebration-title">🎉 Συγχαρητήρια!</h2>
        <p className="celebration-subtitle">Τα ψώνιασες!</p>

        {stats && (
          <div className="celebration-stats">
            {stats.items && (
              <div className="celebration-stat">
                <span className="stat-value">{stats.items}</span>
                <span className="stat-label">προϊόντα</span>
              </div>
            )}
            {stats.total && (
              <div className="celebration-stat">
                <span className="stat-value">{stats.total.toFixed(2)}€</span>
                <span className="stat-label">σύνολο</span>
              </div>
            )}
            {stats.stores && (
              <div className="celebration-stat">
                <span className="stat-value">{stats.stores}</span>
                <span className="stat-label">καταστήματα</span>
              </div>
            )}
          </div>
        )}

        <div className="celebration-motivational">
          {stats?.total > 0 && stats.total < 20 && <p>💚 Οικονομική επιλογή!</p>}
          {stats?.total >= 20 && stats.total < 50 && <p>✨ Καλή αξία!</p>}
          {stats?.total >= 50 && stats.total < 100 && <p>🌟 Τα πήγες καλά!</p>}
          {stats?.total >= 100 && <p>🏆 Τα ψώνιασες στυλ!</p>}
        </div>

        <button className="celebration-close-btn" onClick={onClose}>
          Συνέχεια →
        </button>
      </div>

      <Confetti isActive={isOpen} duration={4000} count={100} />
    </div>
  );
}

/**
 * Mini confetti burst for smaller celebrations
 */
export function ConfettiBurst({ trigger }) {
  const pieces = useMemo(
    () => (trigger > 0 ? Array.from({ length: 20 }, (_, i) => generateConfettiPiece(i)) : []),
    [trigger]
  );

  return (
    <div className="confetti-burst-container">
      {pieces.map((piece) => (
        <div
          key={piece.id}
          className="confetti-burst-piece"
          style={{
            '--end-x': `${piece.drift}px`,
            '--end-y': `${piece.endY}px`,
            '--rotation': `${piece.rotationSpeed}deg`,
            backgroundColor: piece.color,
          }}
        />
      ))}
    </div>
  );
}

/**
 * Sparkle effect for premium features
 */
export function SparkleEffect({ children, active }) {
  return (
    <span className={`sparkle-container ${active ? 'active' : ''}`}>
      {children}
      {active && (
        <>
          <span className="sparkle sparkle-1">✨</span>
          <span className="sparkle sparkle-2">⭐</span>
          <span className="sparkle sparkle-3">💫</span>
        </>
      )}
    </span>
  );
}

/**
 * Badge Unlock Animation
 */
export function BadgeUnlock({ badge, onCollect }) {
  const [phase, setPhase] = useState('unlocking'); // unlocking, unlocked

  useEffect(() => {
    if (!badge) return undefined;

    const timer = setTimeout(() => {
      setPhase('unlocked');
      // Trigger haptic if available
      try {
        if (navigator.vibrate) navigator.vibrate([50, 30, 100]);
      } catch {
        // Ignore missing vibration support.
      }
    }, 800);

    return () => clearTimeout(timer);
  }, [badge]);

  if (!badge) return null;

  return (
    <div className={`badge-unlock ${phase}`}>
      <div className="badge-glow" />
      <div className="badge-icon">{badge.icon || '🏆'}</div>
      <div className="badge-name">{badge.name}</div>
      {phase === 'unlocked' && (
        <button className="badge-collect-btn" onClick={onCollect}>
          Πάρε το! 🎁
        </button>
      )}
    </div>
  );
}

/**
 * Progress Ring Animation
 */
export function ProgressRing({ 
  progress, // 0-100
  size = 80,
  strokeWidth = 6,
  color = '#6366f1',
  bgColor = '#e5e5e5',
  children 
}) {
  const radius = (size - strokeWidth) / 2;
  const circumference = radius * 2 * Math.PI;
  const offset = circumference - (progress / 100) * circumference;

  return (
    <div className="progress-ring-container" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="progress-ring">
        <circle
          className="progress-ring-bg"
          stroke={bgColor}
          strokeWidth={strokeWidth}
          fill="transparent"
          r={radius}
          cx={size / 2}
          cy={size / 2}
        />
        <circle
          className="progress-ring-progress"
          stroke={color}
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          fill="transparent"
          r={radius}
          cx={size / 2}
          cy={size / 2}
          style={{
            strokeDasharray: circumference,
            strokeDashoffset: offset,
          }}
        />
      </svg>
      <div className="progress-ring-content">
        {children}
      </div>
    </div>
  );
}

/**
 * Achievement Toast
 */
export function AchievementToast({ achievement, onDismiss }) {
  useEffect(() => {
    const timer = setTimeout(onDismiss, 4000);
    return () => clearTimeout(timer);
  }, [onDismiss]);

  return (
    <div className="achievement-toast">
      <div className="achievement-icon">{achievement.icon || '🏆'}</div>
      <div className="achievement-content">
        <div className="achievement-title">{achievement.title}</div>
        <div className="achievement-desc">{achievement.description}</div>
      </div>
      <button className="achievement-dismiss" onClick={onDismiss}>✕</button>
    </div>
  );
}
