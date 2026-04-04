import { useEffect, useRef, useState } from 'react';
import { animate } from 'framer-motion';
import './SavingsRing.css';

function useCountUp(target, decimals = 2) {
  const [display, setDisplay] = useState(target.toFixed(decimals));
  const prevRef = useRef(target);
  const controlsRef = useRef(null);

  useEffect(() => {
    const from = prevRef.current;
    prevRef.current = target;
    if (controlsRef.current) controlsRef.current.stop();
    controlsRef.current = animate(from, target, {
      duration: 0.9,
      ease: [0.16, 1, 0.3, 1],
      onUpdate: (v) => setDisplay(v.toFixed(decimals)),
    });
    return () => controlsRef.current?.stop();
  }, [target, decimals]);

  return display;
}

export default function SavingsRing({ items = [], checkedItems = [], totalCost = 0, checkedCost = 0 }) {
  const SIZE = 116;
  const STROKE = 8;
  const R = (SIZE - STROKE) / 2;
  const CIRC = 2 * Math.PI * R;

  const pct = items.length > 0 ? checkedItems.length / items.length : 0;
  const remaining = items.length - checkedItems.length;

  const [animPct, setAnimPct] = useState(0);
  useEffect(() => {
    const raf = requestAnimationFrame(() => setAnimPct(pct));
    return () => cancelAnimationFrame(raf);
  }, [pct]);

  const costDisplay = useCountUp(totalCost, 2);

  if (items.length === 0) return null;

  return (
    <div className="sring-hero">
      <div className="sring-container">
        <svg
          width={SIZE}
          height={SIZE}
          className="sring-svg"
          style={{ transform: 'rotate(-90deg)' }}
        >
          <defs>
            <linearGradient id="sring-grad" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor="#6366f1" />
              <stop offset="100%" stopColor="#a855f7" />
            </linearGradient>
          </defs>
          {/* Track */}
          <circle
            cx={SIZE / 2} cy={SIZE / 2} r={R}
            fill="none"
            stroke="rgba(255,255,255,0.06)"
            strokeWidth={STROKE}
          />
          {/* Progress arc */}
          <circle
            cx={SIZE / 2} cy={SIZE / 2} r={R}
            fill="none"
            stroke="url(#sring-grad)"
            strokeWidth={STROKE}
            strokeLinecap="round"
            strokeDasharray={CIRC}
            strokeDashoffset={CIRC * (1 - animPct)}
            style={{ transition: 'stroke-dashoffset 0.9s cubic-bezier(0.16,1,0.3,1)' }}
          />
        </svg>

        <div className="sring-center">
          <span className="sring-value">{costDisplay}</span>
          <span className="sring-euro">€</span>
          <span className="sring-sublabel">σύνολο</span>
        </div>
      </div>

      <div className="sring-stats">
        <div className="sring-stat">
          <span className="sring-stat-val">{checkedItems.length}</span>
          <span className="sring-stat-lbl">στο καλάθι</span>
        </div>
        <div className="sring-sep" />
        <div className="sring-stat">
          <span className="sring-stat-val">{remaining}</span>
          <span className="sring-stat-lbl">απομένουν</span>
        </div>
        {checkedCost > 0 && (
          <>
            <div className="sring-sep" />
            <div className="sring-stat">
              <span className="sring-stat-val sring-stat-val--green">{checkedCost.toFixed(2)}€</span>
              <span className="sring-stat-lbl">δαπανήθηκαν</span>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
