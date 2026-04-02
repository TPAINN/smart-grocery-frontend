// PremiumWelcomeModal.jsx — Celebration popup shown once after Stripe payment success
import { useEffect, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import './PremiumWelcomeModal.css';

// ─── Confetti particle data ───────────────────────────────────────────────────
const CONFETTI_COLORS = ['#f59e0b','#10b981','#3b82f6','#ec4899','#8b5cf6','#f97316','#fbbf24','#34d399'];
const CONFETTI_COUNT  = 48;

function randomBetween(a, b) { return a + Math.random() * (b - a); }

function buildParticles() {
  return Array.from({ length: CONFETTI_COUNT }, (_, i) => ({
    id: i,
    color: CONFETTI_COLORS[i % CONFETTI_COLORS.length],
    left:  `${randomBetween(2, 98)}%`,
    delay: `${randomBetween(0, 1.2).toFixed(2)}s`,
    dur:   `${randomBetween(1.4, 2.6).toFixed(2)}s`,
    size:  `${randomBetween(7, 14).toFixed(0)}px`,
    rotate:`${Math.floor(randomBetween(0, 360))}deg`,
    shape: i % 3 === 0 ? 'circle' : i % 3 === 1 ? 'rect' : 'diamond',
  }));
}

// ─── Static particle list (same across renders) ───────────────────────────────
const PARTICLES = buildParticles();

const FEATURES = [
  { icon: '🗺️', text: 'Χάρτης — Έξυπνη διαδρομή αγορών' },
  { icon: '🤝', text: 'Κοινό καλάθι με απεριόριστους φίλους' },
  { icon: '🤖', text: 'AI Πλάνο Διατροφής & μακροεντολών' },
  { icon: '🔔', text: 'Push ειδοποιήσεις για offers & εκπτώσεις' },
  { icon: '📊', text: 'Ιστορικό αγορών & στατιστικά budget' },
  { icon: '⚡', text: 'Offline-first λίστα χωρίς διαφημίσεις' },
];

// ─── Component ────────────────────────────────────────────────────────────────
export default function PremiumWelcomeModal({ onClose }) {
  const overlayRef = useRef(null);

  // Close on Escape
  useEffect(() => {
    const onKey = e => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  // Prevent body scroll
  useEffect(() => {
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = ''; };
  }, []);

  const handleOverlayClick = useCallback(e => {
    if (e.target === overlayRef.current) onClose();
  }, [onClose]);

  return createPortal(
    <div className="pwm-overlay" ref={overlayRef} onClick={handleOverlayClick} role="dialog" aria-modal="true" aria-label="Premium καλωσόρισμα">

      {/* ── Confetti ── */}
      <div className="pwm-confetti" aria-hidden="true">
        {PARTICLES.map(p => (
          <span
            key={p.id}
            className={`pwm-piece pwm-piece--${p.shape}`}
            style={{
              left: p.left,
              width: p.size,
              height: p.size,
              background: p.color,
              animationDelay: p.delay,
              animationDuration: p.dur,
              '--rotate': p.rotate,
            }}
          />
        ))}
      </div>

      {/* ── Card ── */}
      <div className="pwm-card">

        {/* Glow ring */}
        <div className="pwm-glow" aria-hidden="true" />

        {/* Icon burst */}
        <div className="pwm-icon-wrap" aria-hidden="true">
          <div className="pwm-icon-ring" />
          <span className="pwm-icon">⭐</span>
        </div>

        <p className="pwm-eyebrow">Συνδρομή ενεργοποιήθηκε</p>

        <h1 className="pwm-title">
          Καλωσήρθες στο<br/>
          <span className="pwm-title-highlight">Premium!</span>
        </h1>

        <p className="pwm-subtitle">
          Σε ευχαριστούμε πολύ για την εμπιστοσύνη σου.&nbsp;
          Έχεις πλέον πρόσβαση σε <strong>όλες τις δυνατότητες</strong>.
        </p>

        {/* Features */}
        <ul className="pwm-features" aria-label="Δυνατότητες Premium">
          {FEATURES.map((f, i) => (
            <li key={i} className="pwm-feature" style={{ animationDelay: `${0.45 + i * 0.07}s` }}>
              <span className="pwm-feature-icon" aria-hidden="true">{f.icon}</span>
              <span className="pwm-feature-text">{f.text}</span>
              <span className="pwm-feature-check" aria-hidden="true">✓</span>
            </li>
          ))}
        </ul>

        {/* CTA */}
        <button className="pwm-cta" onClick={onClose} autoFocus>
          <span>Ας ξεκινήσουμε</span>
          <span className="pwm-cta-arrow" aria-hidden="true">→</span>
        </button>

        <p className="pwm-fine">
          Μπορείς να διαχειριστείς τη συνδρομή σου από το προφίλ σου.
        </p>
      </div>
    </div>,
    document.body
  );
}
