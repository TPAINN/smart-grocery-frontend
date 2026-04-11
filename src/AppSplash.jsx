import { useEffect, useState, useRef } from 'react';

// Launch screen phases:
//   80ms   → bloom    (logo springs in with ambient rings)
//   900ms  → wordmark (app name slides up)
//   1400ms → tagline  (divider + subtitle fade in)
//   2400ms → exit     (whole screen fades out)
//   2950ms → onDone() fires
export default function AppSplash({ onDone }) {
  const [phase, setPhase] = useState('idle');
  const onDoneRef = useRef(onDone);
  useEffect(() => { onDoneRef.current = onDone; }, [onDone]);

  useEffect(() => {
    const ts = [
      setTimeout(() => setPhase('bloom'),     80),
      setTimeout(() => setPhase('wordmark'),  900),
      setTimeout(() => setPhase('tagline'),  1400),
      setTimeout(() => setPhase('exit'),     2400),
      setTimeout(() => onDoneRef.current?.(), 2950),
    ];
    return () => ts.forEach(clearTimeout);
  }, []);

  const ORDER   = ['idle', 'bloom', 'wordmark', 'tagline', 'exit'];
  const past    = (p) => ORDER.indexOf(phase) >= ORDER.indexOf(p);
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
        background:     '#07091a',
        paddingTop:     'env(safe-area-inset-top)',
        paddingBottom:  'env(safe-area-inset-bottom)',
        opacity:         exiting ? 0 : 1,
        transition:      exiting ? 'opacity 0.55s cubic-bezier(0.4,0,0.6,1)' : 'none',
        userSelect:     'none',
        overflow:       'hidden',
      }}
    >
      {/* Subtle dot-grid background */}
      <div style={{
        position:         'absolute',
        inset:             0,
        backgroundImage:  'radial-gradient(rgba(79,87,208,0.18) 1px, transparent 1px)',
        backgroundSize:   '28px 28px',
        opacity:           past('bloom') ? 0.6 : 0,
        transition:       'opacity 1.4s ease 0.2s',
        maskImage:        'radial-gradient(ellipse 60% 60% at 50% 50%, black 0%, transparent 100%)',
        WebkitMaskImage:  'radial-gradient(ellipse 60% 60% at 50% 50%, black 0%, transparent 100%)',
      }}/>

      {/* Top radial glow */}
      <div style={{
        position:     'absolute',
        top:          -160,
        left:         '50%',
        transform:    'translateX(-50%)',
        width:         500,
        height:        380,
        background:   'radial-gradient(ellipse, rgba(79,87,208,0.14) 0%, transparent 65%)',
        filter:       'blur(48px)',
        opacity:       past('bloom') ? 1 : 0,
        transition:   'opacity 1.1s ease',
        pointerEvents:'none',
      }}/>

      {/* Outer ambient ring */}
      <div style={{
        position:     'absolute',
        width:  268,  height: 268,
        borderRadius: '50%',
        border:       '1px solid rgba(79,87,208,0.12)',
        opacity:       past('bloom') ? 1 : 0,
        transform:     past('bloom') ? 'scale(1)' : 'scale(0.35)',
        transition:   'all 1.5s cubic-bezier(0.22,1,0.36,1) 0.1s',
        animation:     past('wordmark') ? 'splashRingBreath 5s ease-in-out infinite' : 'none',
      }}/>

      {/* Inner ring */}
      <div style={{
        position:     'absolute',
        width:  196,  height: 196,
        borderRadius: '50%',
        border:       '1px solid rgba(99,102,241,0.18)',
        opacity:       past('bloom') ? 1 : 0,
        transform:     past('bloom') ? 'scale(1)' : 'scale(0.2)',
        transition:   'all 1.2s cubic-bezier(0.22,1,0.36,1) 0.2s',
      }}/>

      {/* Logo */}
      <div style={{
        position:   'relative',
        zIndex:      1,
        transform:   past('bloom') ? 'scale(1) translateY(0)' : 'scale(0.4) translateY(20px)',
        opacity:     past('bloom') ? 1 : 0,
        transition: 'all 0.9s cubic-bezier(0.34,1.56,0.64,1) 0.05s',
      }}>
        {/* Soft glow halo */}
        <div style={{
          position:     'absolute',
          inset:       '-18px',
          borderRadius: 52,
          background:  'radial-gradient(circle, rgba(79,87,208,0.32) 0%, transparent 70%)',
          filter:      'blur(22px)',
          opacity:      past('bloom') ? 1 : 0,
          transition:  'opacity 0.9s ease 0.2s',
        }}/>
        <img
          src="/pwa-192x192.png"
          alt="Smart Grocery"
          width={92}
          height={92}
          style={{
            borderRadius: 26,
            display:      'block',
            position:     'relative',
            zIndex:        1,
            boxShadow:     past('bloom')
              ? '0 0 0 1px rgba(255,255,255,0.06), 0 28px 72px rgba(0,0,0,0.72), 0 0 52px rgba(79,87,208,0.28)'
              : 'none',
            transition:   'box-shadow 0.85s ease 0.18s',
          }}
        />
      </div>

      {/* Wordmark */}
      <div style={{
        marginTop:  22,
        textAlign:  'center',
        position:   'relative',
        zIndex:      1,
        transform:   past('wordmark') ? 'translateY(0)' : 'translateY(20px)',
        opacity:     past('wordmark') ? 1 : 0,
        transition: 'all 0.65s cubic-bezier(0.22,1,0.36,1)',
      }}>
        <p style={{
          margin:        0,
          fontSize:      27,
          fontWeight:    800,
          letterSpacing: '-0.4px',
          lineHeight:    1.15,
          color:         '#eef0ff',
          fontFamily:    "'Plus Jakarta Sans', 'Inter', -apple-system, sans-serif",
        }}>
          Smart{' '}
          <span style={{
            background:           'linear-gradient(135deg, #818cf8 0%, #a5b4fc 100%)',
            WebkitBackgroundClip: 'text',
            WebkitTextFillColor:  'transparent',
            backgroundClip:       'text',
          }}>
            Grocery
          </span>
        </p>
      </div>

      {/* Divider + tagline */}
      <div style={{
        marginTop:     11,
        textAlign:     'center',
        position:      'relative',
        zIndex:         1,
        opacity:        past('tagline') ? 1 : 0,
        transform:      past('tagline') ? 'translateY(0)' : 'translateY(8px)',
        transition:    'all 0.5s ease 0.05s',
        display:       'flex',
        flexDirection: 'column',
        alignItems:    'center',
        gap:            7,
      }}>
        <div style={{
          width:      past('tagline') ? 44 : 0,
          height:      1,
          background: 'linear-gradient(90deg, transparent, rgba(129,140,248,0.45), transparent)',
          transition: 'width 0.65s ease 0.08s',
        }}/>
        <p style={{
          margin:        0,
          fontSize:      10.5,
          fontWeight:    500,
          letterSpacing: '3.5px',
          textTransform: 'uppercase',
          color:         'rgba(165,180,252,0.38)',
          fontFamily:    "'Plus Jakarta Sans', 'Inter', sans-serif",
        }}>
          Εξυπνες Αγορές
        </p>
      </div>

      {/* Loading bar — thin elegant scan line */}
      <div style={{
        position:     'absolute',
        bottom:       'calc(38px + env(safe-area-inset-bottom))',
        width:         108,
        height:         2,
        borderRadius:   2,
        background:    'rgba(99,102,241,0.12)',
        overflow:      'hidden',
        opacity:        past('tagline') ? 1 : 0,
        transition:    'opacity 0.5s ease 0.35s',
      }}>
        <div style={{
          height:       '100%',
          width:         '38%',
          borderRadius:   2,
          background:    'linear-gradient(90deg, transparent, rgba(129,140,248,0.85), transparent)',
          animation:      past('tagline') ? 'splashScan 1.3s cubic-bezier(0.4,0,0.6,1) infinite' : 'none',
        }}/>
      </div>

      {/* Version badge */}
      <p style={{
        position:      'absolute',
        bottom:        'calc(16px + env(safe-area-inset-bottom))',
        margin:         0,
        fontSize:       9,
        color:         'rgba(255,255,255,0.1)',
        letterSpacing: '1.5px',
        fontFamily:    "'Plus Jakarta Sans', 'Inter', sans-serif",
        textTransform: 'uppercase',
        opacity:        past('tagline') ? 1 : 0,
        transition:    'opacity 0.6s ease 0.5s',
      }}>
        v2.3.0
      </p>

      <style>{`
        @keyframes splashScan {
          0%   { transform: translateX(-110%); }
          100% { transform: translateX(370%); }
        }
        @keyframes splashRingBreath {
          0%, 100% { transform: scale(1);    opacity: 0.7; }
          50%       { transform: scale(1.05); opacity: 0.3; }
        }
      `}</style>
    </div>
  );
}
