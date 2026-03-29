/**
 * Smart Grocery - Haptic Feedback Hook
 * Provides tactile feedback for premium mobile experience
 */

import { useCallback, useRef } from 'react';
import { Haptics, ImpactStyle } from '@capacitor/haptics';

/**
 * Haptic Feedback Hook
 * Provides different levels of haptic feedback for mobile interactions
 */
export function useHapticFeedback() {
  const lastTriggerRef = useRef(0);
  const minInterval = 50; // Minimum ms between haptics

  // Light impact - for subtle interactions
  const light = useCallback(async () => {
    const now = Date.now();
    if (now - lastTriggerRef.current < minInterval) return;
    lastTriggerRef.current = now;

    try {
      await Haptics.impact({ style: ImpactStyle.Light });
    } catch {
      // Fallback to browser vibration
      if (navigator.vibrate) {
        navigator.vibrate(10);
      }
    }
  }, []);

  // Medium impact - for standard interactions
  const medium = useCallback(async () => {
    const now = Date.now();
    if (now - lastTriggerRef.current < minInterval) return;
    lastTriggerRef.current = now;

    try {
      await Haptics.impact({ style: ImpactStyle.Medium });
    } catch {
      if (navigator.vibrate) {
        navigator.vibrate(20);
      }
    }
  }, []);

  // Heavy impact - for important actions
  const heavy = useCallback(async () => {
    const now = Date.now();
    if (now - lastTriggerRef.current < minInterval) return;
    lastTriggerRef.current = now;

    try {
      await Haptics.impact({ style: ImpactStyle.Heavy });
    } catch {
      if (navigator.vibrate) {
        navigator.vibrate([30, 10, 30]);
      }
    }
  }, []);

  // Selection changed - for picker/selection changes
  const selection = useCallback(async () => {
    const now = Date.now();
    if (now - lastTriggerRef.current < minInterval / 2) return;
    lastTriggerRef.current = now;

    try {
      await Haptics.play({ id: 1 });
    } catch {
      if (navigator.vibrate) {
        navigator.vibrate(5);
      }
    }
  }, []);

  // Success notification
  const success = useCallback(async () => {
    const now = Date.now();
    if (now - lastTriggerRef.current < minInterval) return;
    lastTriggerRef.current = now;

    try {
      await Haptics.notification({ type: 'SUCCESS' });
    } catch {
      if (navigator.vibrate) {
        navigator.vibrate([30, 50, 60]);
      }
    }
  }, []);

  // Warning notification
  const warning = useCallback(async () => {
    const now = Date.now();
    if (now - lastTriggerRef.current < minInterval) return;
    lastTriggerRef.current = now;

    try {
      await Haptics.notification({ type: 'WARNING' });
    } catch {
      if (navigator.vibrate) {
        navigator.vibrate([50, 30, 50]);
      }
    }
  }, []);

  // Error notification
  const error = useCallback(async () => {
    const now = Date.now();
    if (now - lastTriggerRef.current < minInterval) return;
    lastTriggerRef.current = now;

    try {
      await Haptics.notification({ type: 'ERROR' });
    } catch {
      if (navigator.vibrate) {
        navigator.vibrate([100, 30, 100, 30, 100]);
      }
    }
  }, []);

  return {
    light,
    medium,
    heavy,
    selection,
    success,
    warning,
    error,
  };
}

/**
 * Creates a combined handler with haptic feedback
 * @param {Function} handler - The original event handler
 * @param {Function} haptic - The haptic feedback function
 * @param {boolean} preventDouble - Prevent double execution
 */
export function withHaptic(handler, haptic = 'medium', preventDouble = true) {
  return async (e) => {
    if (preventDouble) {
      e.target.disabled = true;
      setTimeout(() => { e.target.disabled = false; }, 300);
    }
    
    if (typeof haptic === 'function') {
      haptic();
    } else {
      // Lazy load haptics
      const feedback = await import('./useHapticFeedback').then(m => m.useHapticFeedback());
      switch (haptic) {
        case 'light': feedback.light(); break;
        case 'medium': feedback.medium(); break;
        case 'heavy': feedback.heavy(); break;
        case 'success': feedback.success(); break;
        case 'warning': feedback.warning(); break;
        case 'error': feedback.error(); break;
        default: feedback.medium();
      }
    }

    if (handler) {
      await handler(e);
    }
  };
}

/**
 * Haptic-enabled button wrapper component
 * Usage: <HapticButton onClick={handleClick} variant="success">Click me</HapticButton>
 */
export function HapticButton({ 
  children, 
  onClick, 
  variant = 'default',
  hapticType = 'medium',
  className = '',
  style = {},
  disabled = false,
  ...props 
}) {
  const { [hapticType]: hapticFn } = useHapticFeedback();

  const handleClick = async (e) => {
    if (disabled) return;
    
    try {
      hapticFn?.();
    } catch {
      // Haptics not available
    }

    if (onClick) {
      await onClick(e);
    }
  };

  const variantStyles = {
    default: {},
    success: { background: 'linear-gradient(135deg, #22c55e, #16a34a)', color: 'white' },
    danger: { background: 'linear-gradient(135deg, #ef4444, #dc2626)', color: 'white' },
    primary: { background: 'linear-gradient(135deg, #6366f1, #4f46e5)', color: 'white' },
  };

  return (
    <button
      className={`haptic-button ${className}`}
      onClick={handleClick}
      disabled={disabled}
      style={{ ...variantStyles[variant], ...style }}
      {...props}
    >
      {children}
    </button>
  );
}
