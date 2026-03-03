// src/AuthModal.jsx
import { useState, useEffect } from 'react';
import './AuthModal.css';

const API_BASE = "https://my-smart-grocery-api.onrender.com";

export default function AuthModal({ isOpen, onClose, onLoginSuccess, initMode = 'login' }) {
  const [isLogin, setIsLogin] = useState(initMode === 'login');
  const [formData, setFormData] = useState({ name: '', email: '', password: '' });
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  // 🔴 FIX: Κάθε φορά που ανοίγει το modal, εφαρμόζει το σωστό mode
  useEffect(() => {
    if (isOpen) {
      setIsLogin(initMode === 'login');
      setError('');
      setFormData({ name: '', email: '', password: '' });
    }
  }, [isOpen, initMode]);

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
      <div className="modal-content" onClick={e => e.stopPropagation()}>
        <button className="close-btn" onClick={onClose} disabled={isLoading}>✕</button>
        <div className="modal-header staggered-1">
          <h2>{isLogin ? 'Καλώς ήρθες!' : 'Δημιουργία Λογαριασμού'}</h2>
          <p>{isLogin ? 'Συνδέσου για να δεις τη λίστα σου.' : 'Γίνε μέλος του Smart Hub.'}</p>
        </div>
        {error && <div className="error-message staggered-2">{error}</div>}
        <form onSubmit={handleSubmit} className="auth-form staggered-2">
          {!isLogin && (
            <input type="text" name="name" placeholder="Το όνομά σου" value={formData.name} onChange={handleChange} required disabled={isLoading} className="slide-down-input" />
          )}
          <input type="email" name="email" placeholder="Email" value={formData.email} onChange={handleChange} required disabled={isLoading} />
          <input type="password" name="password" placeholder="Κωδικός" value={formData.password} onChange={handleChange} required disabled={isLoading} />
          <button type="submit" className="submit-btn" disabled={isLoading}>
            {isLoading ? <span className="auth-spinner"></span> : (isLogin ? 'Σύνδεση' : 'Εγγραφή')}
          </button>
        </form>
        <p className="toggle-text staggered-3">
          {isLogin ? 'Δεν έχεις λογαριασμό; ' : 'Έχεις ήδη λογαριασμό; '}
          <span onClick={() => { if (!isLoading) { setIsLogin(!isLogin); setError(''); } }}>
            {isLogin ? 'Κάνε εγγραφή' : 'Συνδέσου'}
          </span>
        </p>
      </div>
    </div>
  );
}