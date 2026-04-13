import { AnimatePresence, motion } from 'framer-motion';
import { useEffect } from 'react';
import './DynamicIsland.css';

const DURATIONS = { success: 3500, error: 6000, warning: 4500, info: 4000 };

const ICONS = {
  success: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"
      strokeLinecap="round" strokeLinejoin="round" width="15" height="15">
      <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/>
      <polyline points="22 4 12 14.01 9 11.01"/>
    </svg>
  ),
  error: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"
      strokeLinecap="round" strokeLinejoin="round" width="15" height="15">
      <circle cx="12" cy="12" r="10"/>
      <line x1="15" y1="9" x2="9" y2="15"/>
      <line x1="9" y1="9" x2="15" y2="15"/>
    </svg>
  ),
  warning: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"
      strokeLinecap="round" strokeLinejoin="round" width="15" height="15">
      <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>
      <line x1="12" y1="9" x2="12" y2="13"/>
      <line x1="12" y1="17" x2="12.01" y2="17"/>
    </svg>
  ),
  info: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"
      strokeLinecap="round" strokeLinejoin="round" width="15" height="15">
      <circle cx="12" cy="12" r="10"/>
      <line x1="12" y1="8" x2="12" y2="12"/>
      <line x1="12" y1="16" x2="12.01" y2="16"/>
    </svg>
  ),
};

function detectType(message) {
  if (!message) return 'success';
  if (message.startsWith('❌') || message.includes('Σφάλμα') || message.includes('error')) return 'error';
  if (message.startsWith('⚠️')) return 'warning';
  if (message.startsWith('📡') || message.startsWith('🔔') || message.startsWith('🎙️')) return 'info';
  return 'success';
}

export default function DynamicIsland({ show, message, type, onClose }) {
  const resolvedType = type || detectType(message);

  useEffect(() => {
    if (!show) return;
    const ms = DURATIONS[resolvedType] ?? 3500;
    const t = setTimeout(() => onClose?.(), ms);
    return () => clearTimeout(t);
  }, [show, message, resolvedType, onClose]);

  return (
    <div className="di-outer">
      <AnimatePresence>
        {show && (
          <motion.div
            className="di-wrapper"
            initial={{ y: -72, opacity: 0, scale: 0.72 }}
            animate={{ y: 0, opacity: 1, scale: 1 }}
            exit={{ y: -72, opacity: 0, scale: 0.72 }}
            transition={{ type: 'spring', stiffness: 420, damping: 26, mass: 0.75 }}
            onClick={onClose}
            role="alert"
            aria-live="polite"
          >
            <div className={`di-pill di-pill--${resolvedType}`}>
              <span className="di-icon">{ICONS[resolvedType]}</span>
              <span className="di-message">{message}</span>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
