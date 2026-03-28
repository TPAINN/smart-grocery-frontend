import { useEffect } from 'react';
import './RecipeNotification.css';

const ICONS = {
  success: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/>
      <polyline points="22 4 12 14.01 9 11.01"/>
    </svg>
  ),
  error: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10"/>
      <line x1="15" y1="9" x2="9" y2="15"/>
      <line x1="9" y1="9" x2="15" y2="15"/>
    </svg>
  ),
  warning: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>
      <line x1="12" y1="9" x2="12" y2="13"/>
      <line x1="12" y1="17" x2="12.01" y2="17"/>
    </svg>
  ),
  info: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10"/>
      <line x1="12" y1="8" x2="12" y2="12"/>
      <line x1="12" y1="16" x2="12.01" y2="16"/>
    </svg>
  ),
};

const DURATIONS = { success: 3500, error: 6000, warning: 4500, info: 4000 };

export default function RecipeNotification({ show, message, type = 'success', onClose }) {
  useEffect(() => {
    if (!show) return;
    const ms = DURATIONS[type] ?? 3500;
    const t = setTimeout(() => onClose?.(), ms);
    return () => clearTimeout(t);
  }, [show, type, onClose]);

  if (!show) return null;

  return (
    <div className="notification-container">
      <div className={`notification-box notification-${type}`}>
        <div className="notification-icon">
          {ICONS[type] ?? ICONS.success}
        </div>
        <div className="notification-content">
          <p>{message}</p>
        </div>
        <button className="close-notify-btn" onClick={onClose} aria-label="Κλείσιμο">×</button>
      </div>
    </div>
  );
}
