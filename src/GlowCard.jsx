import { useRef, useCallback } from 'react';
import './GlowCard.css';

export default function GlowCard({ icon, label, active = false, onClick, className = '' }) {
  const ref = useRef(null);

  const onMove = useCallback((e) => {
    const el = ref.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * 100;
    const y = ((e.clientY - rect.top) / rect.height) * 100;
    el.style.setProperty('--gx', `${x}%`);
    el.style.setProperty('--gy', `${y}%`);
    el.style.setProperty('--go', '1');
  }, []);

  const onLeave = useCallback(() => {
    ref.current?.style.setProperty('--go', '0');
  }, []);

  return (
    <button
      ref={ref}
      className={`gcard ${active ? 'gcard--active' : ''} ${className}`}
      onClick={onClick}
      onMouseMove={onMove}
      onMouseLeave={onLeave}
    >
      <div className="gcard-glow" aria-hidden="true" />
      <span className="gcard-icon">{icon}</span>
      <span className="gcard-label">{label}</span>
    </button>
  );
}
