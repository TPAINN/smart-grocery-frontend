import { useEffect, useState, useRef } from 'react';

// Particle count — tweak to taste without touching anything else
const N = 18;

// Stable random values per particle — lives in a ref so they
// don't change on re-render (would cause a visible stutter).
function mkParticle(id) {
  return {
    id,
    x:    30 + Math.random() * 40,   // horizontal % — keep near center
    size: 2  + Math.random() * 3,    // px
    dur:  2.2 + Math.random() * 2.4, // float duration (s)
    del:  Math.random() * 1.6,       // start delay (s)
    op:   0.15 + Math.random() * 0.25,
  };
}

// Launch screen — phases driven by a setTimeout chain from mount:
//   80ms   → bloom    (logo + glow spring in)
//   900ms  → wordmark (app name slides up)
//   1400ms → tagline  (subtitle + dots fade in)
//   2400ms → exit     (whole screen fades out)
//   2950ms → onDone() fires
export default function AppSplash({ onDone }) {
  const [phase, setPhase] = useState('idle');
  const dots    = useRef(Array.from({ length: N }, (_, i) => mkParticle(i)));
  // Keep onDone in a ref so we can call the latest version without it
  // being a useEffect dependency — otherwise an inline () => {} prop
  // creates a new reference every render and re-triggers the whole chain.
  const onDoneRef = useRef(onDone);
  useEffect(() => { onDoneRef.current = onDone; }, [onDone]);

  useEffect(() => {
    // Empty deps — fire once on mount, clean up on unmount.
    const ts = [
      setTimeout(() => setPhase('bloom'),              80),
      setTimeout(() => setPhase('wordmark'),           900),
      setTimeout(() => setPhase('tagline'),           1400),
      setTimeout(() => setPhase('exit'),              2400),
      setTimeout(() => onDoneRef.current?.(),         2950),
    ];
    return () => ts.forEach(clearTimeout);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Helper: is the animation at or past this phase?
  const ORDER  = ['idle', 'bloom', 'wordmark', 'tagline', 'exit'];
  const past   = (p) => ORDER.indexOf(phase) >= ORDER.indexOf(p);
  const exiting = phase === 'exit';

  return (
    <div
      aria-hidden="true"
      style={{
        position:       'fixed',
        inset:           0,
        zIndex:          999999,
        display:        'flex',
        flexDirection:  'column',
        alignItems:     'center',
        justifyContent: 'center',
        // Deep navy radial — matches the brand palette
        background:     'radial-gradient(ellipse 120% 100% at 50% 60%, #111132 0%, #0a0a1e 55%, #060610 100%)',
        paddingTop:     'env(safe-area-inset-top)',
        paddingBottom:  'env(safe-area-inset-bottom)',
        // Whole-screen fade-out on exit
        opacity:         exiting ? 0 : 1,
        transition:      exiting ? 'opacity 0.55s cubic-bezier(0.4,0,0.6,1)' : 'none',
        userSelect:     'none',
      }}
    >
      {/* ── Floating particles ──────────────────────────────────────────── */}
      {dots.current.map(p => (
        <div
          key={p.id}
          style={{
            position:     'absolute',
            bottom:       '-8px',
            left:         `${p.x}%`,
            width:         p.size,
            height:        p.size,
            borderRadius: '50%',
            background:   '#8b5cf6',
            opacity:       past('bloom') ? p.op : 0,
            transition:   `opacity 0.8s ease ${p.del}s`,
            animation:     past('bloom')
              ? `splashFloat ${p.dur}s ease-in ${p.del}s infinite`
              : 'none',
          }}
        />
      ))}

      {/* ── Outer ambient ring (breathes once visible) ───────────────────── */}
      <div style={{
        position:     'absolute',
        width:  240,  height: 240,
        borderRadius: '50%',
        border:       '1px solid rgba(99,102,241,0.12)',
        opacity:       past('bloom') ? 1 : 0,
        transform:     past('bloom') ? 'scale(1)' : 'scale(0.4)',
        transition:   'all 1.4s cubic-bezier(0.22,1,0.36,1) 0.1s',
        animation:     past('wordmark') ? 'splashRingBreath 4s ease-in-out infinite' : 'none',
      }} />

      {/* ── Inner ring ───────────────────────────────────────────────────── */}
      <div style={{
        position:     'absolute',
        width:  180,  height: 180,
        borderRadius: '50%',
        border:       '1px solid rgba(139,92,246,0.18)',
        opacity:       past('bloom') ? 1 : 0,
        transform:     past('bloom') ? 'scale(1)' : 'scale(0.2)',
        transition:   'all 1.2s cubic-bezier(0.22,1,0.36,1) 0.2s',
      }} />

      {/* ── Purple glow bloom behind the logo ───────────────────────────── */}
      <div style={{
        position:     'absolute',
        width:  300,  height: 300,
        borderRadius: '50%',
        background:   'radial-gradient(circle, rgba(99,102,241,0.18) 0%, transparent 70%)',
        opacity:       past('bloom') ? 1 : 0,
        transform:     past('bloom') ? 'scale(1)' : 'scale(0)',
        transition:   'all 1.1s cubic-bezier(0.22,1,0.36,1)',
        filter:       'blur(24px)',
      }} />

      {/* ── Logo — spring scale-in ───────────────────────────────────────── */}
      <div style={{
        position:   'relative',
        zIndex:      1,
        transform:   past('bloom') ? 'scale(1) translateY(0)' : 'scale(0.35) translateY(16px)',
        opacity:     past('bloom') ? 1 : 0,
        transition: 'all 0.85s cubic-bezier(0.34,1.56,0.64,1) 0.05s',
      }}>
        {/* Soft glow halo so the logo floats */}
        <div style={{
          position:     'absolute',
          inset:       '-12px',
          borderRadius: 46,
          background:  'radial-gradient(circle, rgba(99,102,241,0.35) 0%, transparent 70%)',
          filter:      'blur(18px)',
          opacity:      past('bloom') ? 1 : 0,
          transition:  'opacity 0.6s ease 0.3s',
        }} />
        <img
          src="/pwa-192x192.png"
          alt="Smart Grocery"
          width={110}
          height={110}
          style={{
            borderRadius: 34,
            display:      'block',
            position:     'relative',
            zIndex:        1,
            boxShadow:     past('bloom')
              ? '0 0 0 1px rgba(255,255,255,0.08), 0 20px 60px rgba(0,0,0,0.6), 0 0 40px rgba(99,102,241,0.3)'
              : 'none',
            transition:   'box-shadow 0.8s ease 0.2s',
          }}
        />
      </div>

      {/* ── App name + tagline ───────────────────────────────────────────── */}
      <div style={{
        marginTop:  24,
        textAlign:  'center',
        position:   'relative',
        zIndex:      1,
        transform:   past('wordmark') ? 'translateY(0)' : 'translateY(22px)',
        opacity:     past('wordmark') ? 1 : 0,
        transition: 'all 0.65s cubic-bezier(0.22,1,0.36,1)',
      }}>
        <p style={{
          margin:        0,
          fontSize:      34,
          fontWeight:    900,
          letterSpacing: '-1px',
          lineHeight:    1.1,
          color:         '#fff',
          fontFamily:    '-apple-system, BlinkMacSystemFont, Segoe UI, Roboto, sans-serif',
        }}>
          Smart{' '}
          <span style={{
            background:           'linear-gradient(135deg, #818cf8 0%, #a78bfa 50%, #c4b5fd 100%)',
            WebkitBackgroundClip: 'text',
            WebkitTextFillColor:  'transparent',
            backgroundClip:       'text',
          }}>
            Grocery
          </span>
        </p>

        <p style={{
          margin:        '8px 0 0',
          fontSize:      12,
          fontWeight:    500,
          letterSpacing: '3px',
          textTransform: 'uppercase',
          color:         'rgba(255,255,255,0.35)',
          transform:      past('tagline') ? 'translateY(0)' : 'translateY(8px)',
          opacity:        past('tagline') ? 1 : 0,
          transition:    'all 0.55s ease 0.05s',
        }}>
          {'\u0395\u03be\u03c5\u03c0\u03bd\u03b5\u03c2 \u0391\u03b3\u03bf\u03c1\u03ad\u03c2'}
        </p>
      </div>

      {/* ── Loading dots ─────────────────────────────────────────────────── */}
      <div style={{
        position:   'absolute',
        bottom:     'calc(52px + env(safe-area-inset-bottom))',
        display:    'flex',
        gap:         6,
        opacity:     past('tagline') ? 1 : 0,
        transition: 'opacity 0.5s ease 0.2s',
      }}>
        {[0, 1, 2].map(i => (
          <div
            key={i}
            style={{
              width:        5,
              height:       5,
              borderRadius: '50%',
              background:   'rgba(139,92,246,0.7)',
              animation:    past('tagline')
                ? `splashDot 1.1s ease-in-out ${i * 0.18}s infinite`
                : 'none',
            }}
          />
        ))}
      </div>

      {/* Version badge — barely visible, looks polished */}
      <p style={{
        position:      'absolute',
        bottom:        'calc(20px + env(safe-area-inset-bottom))',
        margin:         0,
        fontSize:       10,
        color:         'rgba(255,255,255,0.12)',
        letterSpacing: '1px',
        opacity:        past('tagline') ? 1 : 0,
        transition:    'opacity 0.6s ease 0.4s',
      }}>
        v1.1.0
      </p>

      {/* ── Keyframes ────────────────────────────────────────────────────── */}
      <style>{`
        @keyframes splashFloat {
          0%   { transform: translateY(0) scale(1);       opacity: 0.2; }
          60%  { transform: translateY(-38vh) scale(0.7); opacity: 0;   }
          100% { transform: translateY(-38vh) scale(0.7); opacity: 0;   }
        }
        @keyframes splashRingBreath {
          0%, 100% { transform: scale(1);    opacity: 0.6; }
          50%       { transform: scale(1.06); opacity: 0.3; }
        }
        @keyframes splashDot {
          0%, 80%, 100% { transform: scale(0.5); opacity: 0.25; }
          40%            { transform: scale(1);   opacity: 1;    }
        }
      `}</style>
    </div>
  );
}
