// src/AuthModal.jsx
import { useId, useState } from 'react';
import './AuthModal.css';
import { API_BASE } from './config';

export default function AuthModal({ isOpen, onClose, onLoginSuccess, initMode = 'login' }) {
  const titleId = useId();
  const [isLogin, setIsLogin] = useState(initMode === 'login');
  const [formData, setFormData] = useState({ name: '', email: '', password: '' });
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  if (!isOpen) return null;

  const handleChange = (e) => setFormData({ ...formData, [e.target.name]: e.target.value });

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setIsLoading(true);
    const endpoint = isLogin ? '/login' : '/register';
    try {
      const response = await fetch(`${API_BASE}/api/auth${endpoint}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(formData)
      });
      const data = await response.json();
      if (!response.ok) { setError(data.message || 'Κάτι πήγε στραβά.'); setIsLoading(false); return; }
      localStorage.setItem('smart_grocery_token', data.token);
      localStorage.setItem('smart_grocery_user', JSON.stringify(data.user));
      onLoginSuccess(data.user);
      setIsLoading(false);
      onClose();
    } catch {
      setError('Πρόβλημα σύνδεσης με τον Server.');
      setIsLoading(false);
    }
  };

  return (
    <div className="modal-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget && !isLoading) onClose(); }}>
      <div
        className="modal-content"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onClick={e => e.stopPropagation()}
      >
        <button type="button" className="close-btn" onClick={onClose} disabled={isLoading} aria-label="Κλείσιμο">✕</button>
        <div className="modal-header staggered-1">
          <h2 id={titleId}>{isLogin ? 'Καλώς ήρθες!' : 'Δημιουργία Λογαριασμού'}</h2>
          <p>{isLogin ? 'Συνδέσου για να δεις τη λίστα σου.' : 'Γίνε μέλος του Smart Hub.'}</p>
        </div>
        {error && <div className="error-message staggered-2">{error}</div>}
        <form onSubmit={handleSubmit} className="auth-form staggered-2" autoComplete="on">
          {!isLogin && (
            <input
              type="text"
              name="name"
              placeholder="Το όνομά σου"
              value={formData.name}
              onChange={handleChange}
              required
              disabled={isLoading}
              className="slide-down-input"
              autoComplete="name"
              inputMode="text"
            />
          )}
          <input
            type="email"
            name="email"
            placeholder="Email"
            value={formData.email}
            onChange={handleChange}
            required
            disabled={isLoading}
            autoComplete="email"
            inputMode="email"
          />
          <input
            type="password"
            name="password"
            placeholder="Κωδικός"
            value={formData.password}
            onChange={handleChange}
            required
            disabled={isLoading}
            autoComplete={isLogin ? 'current-password' : 'new-password'}
          />
          <button type="submit" className="submit-btn" disabled={isLoading}>
            {isLoading ? <span className="auth-spinner"></span> : (isLogin ? 'Σύνδεση' : 'Εγγραφή')}
          </button>
        </form>
        <p className="toggle-text staggered-3">
          {isLogin ? 'Δεν έχεις λογαριασμό; ' : 'Έχεις ήδη λογαριασμό; '}
          <button
            type="button"
            className="toggle-link-btn"
            onClick={() => { if (!isLoading) { setIsLogin(!isLogin); setError(''); } }}
            disabled={isLoading}
          >
            {isLogin ? 'Κάνε εγγραφή' : 'Συνδέσου'}
          </button>
        </p>
      </div>
    </div>
  );
}
