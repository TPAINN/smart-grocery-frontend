import { useEffect } from 'react';
import './RecipeNotification.css';

export default function RecipeNotification({ show, message, onClose }) {
  // Αν το 'show' γίνει true, ξεκινάει ένα χρονόμετρο για να κλείσει αυτόματα σε 3.5 δευτερόλεπτα!
  useEffect(() => {
    if (show) {
      const timer = setTimeout(() => {
        onClose();
      }, 3500);
      return () => clearTimeout(timer);
    }
  }, [show, onClose]);

  if (!show) return null;

  return (
    <div className="notification-container">
      <div className="notification-box">
        <div className="notification-icon">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path>
            <polyline points="22 4 12 14.01 9 11.01"></polyline>
          </svg>
        </div>
        <div className="notification-content">
          <h4></h4>
          <p>{message}</p>
        </div>
        <button className="close-notify-btn" onClick={onClose}>×</button>
      </div>
    </div>
  );
}