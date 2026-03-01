// src/AuthModal.jsx
import { useState } from 'react';
import './AuthModal.css';
// Δυναμικό API Base URL (Λειτουργεί αυτόματα σε Localhost, LAN & Production)
const API_BASE = "https://my-smart-grocery-api.onrender.com";

export default function AuthModal({ isOpen, onClose, onLoginSuccess }) {
  const [isLogin, setIsLogin] = useState(true);
  const [formData, setFormData] = useState({ name: '', email: '', password: '' });
  const [error, setError] = useState('');

  if (!isOpen) return null;

  const handleChange = (e) => setFormData({ ...formData, [e.target.name]: e.target.value });

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');

    const endpoint = isLogin ? '/login' : '/register';
    
    try {
      const response = await fetch(`${API_BASE}/api/auth${endpoint}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(formData)
      });
      const data = await response.json();

      if (!response.ok) { setError(data.message || 'Κάτι πήγε στραβά.'); return; }

      localStorage.setItem('smart_grocery_token', data.token);
      localStorage.setItem('smart_grocery_user', JSON.stringify(data.user));
      onLoginSuccess(data.user);
      onClose();
    } catch (err) {
      setError('Πρόβλημα σύνδεσης με τον Server.');
    }
  };

  return (
    <div className="modal-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal-content" onClick={e => e.stopPropagation()}>
        <button className="close-btn" onClick={onClose}>✕</button>
        
        <div className="modal-header staggered-1">
          <h2>{isLogin ? 'Καλώς ήρθες!' : 'Δημιουργία Λογαριασμού'}</h2>
          <p>{isLogin ? 'Συνδέσου για να δεις τη λίστα σου.' : 'Γίνε μέλος του Smart Grocery.'}</p>
        </div>

        {error && <div className="error-message staggered-2">{error}</div>}

        {/* ΚΑΘΑΡΗ ΦΟΡΜΑ EMAIL */}
        <form onSubmit={handleSubmit} className={`auth-form staggered-2 ${!isLogin ? 'expanded' : ''}`}>
          {!isLogin && (
            <input type="text" name="name" placeholder="Το όνομά σου" value={formData.name} onChange={handleChange} required className="slide-down-input" />
          )}
          <input type="email" name="email" placeholder="Email" value={formData.email} onChange={handleChange} required />
          <input type="password" name="password" placeholder="Κωδικός" value={formData.password} onChange={handleChange} required />
          
          <button type="submit" className="submit-btn">
            {isLogin ? 'Σύνδεση' : 'Εγγραφή'}
          </button>
        </form>

        <p className="toggle-text staggered-3">
          {isLogin ? 'Δεν έχεις λογαριασμό; ' : 'Έχεις ήδη λογαριασμό; '}
          <span onClick={() => { setIsLogin(!isLogin); setError(''); }}>{isLogin ? 'Κάνε εγγραφή' : 'Συνδέσου'}</span>
        </p>
      </div>
    </div>
  );
}