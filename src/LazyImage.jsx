// LazyImage.jsx — IntersectionObserver-based lazy loader for background-image recipe cards
// Avoids loading off-screen images, improving LCP and reducing bandwidth.
import { useEffect, useRef, useState } from 'react';

/**
 * LazyImage renders a div with a background-image that is only set
 * once the element enters the viewport (or comes close to it).
 *
 * Props:
 *   src        — image URL
 *   className  — CSS class for the div
 *   style      — additional inline styles
 *   placeholder — content/children shown while image hasn't loaded (e.g. emoji)
 *   rootMargin  — IntersectionObserver rootMargin (default: '200px')
 */
export default function LazyImage({ src, className = '', style = {}, children, rootMargin = '200px 0px' }) {
  const ref      = useRef(null);
  const [loaded, setLoaded] = useState(false);
  const [hasError, setHasError] = useState(false);
  const [bgUrl,  setBgUrl]  = useState('');

  useEffect(() => {
    // Reset error state when src changes
    setHasError(false);
    setBgUrl('');
    setLoaded(false);

    if (!src) { setHasError(true); setLoaded(true); return; }

    // If IntersectionObserver is unavailable (old browser), load immediately
    if (!('IntersectionObserver' in window)) {
      const img = new Image();
      img.onload  = () => { setBgUrl(src); setLoaded(true); };
      img.onerror = () => { setHasError(true); setLoaded(true); };
      img.src = src;
      return;
    }

    const el = ref.current;
    if (!el) return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          // Preload via Image() so we only show once decoded — avoids layout shift
          const img = new Image();
          img.onload  = () => { setBgUrl(src); setLoaded(true); };
          img.onerror = () => { setHasError(true); setLoaded(true); };
          img.src = src;
          observer.disconnect();
        }
      },
      { rootMargin, threshold: 0 }
    );

    observer.observe(el);
    return () => observer.disconnect();
  }, [src, rootMargin]);

  return (
    <div
      ref={ref}
      className={className}
      style={{
        ...style,
        backgroundImage: (!hasError && bgUrl) ? `url(${bgUrl})` : 'none',
        background: hasError
          ? 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)'
          : (bgUrl ? `url(${bgUrl}) center/cover no-repeat` : undefined),
        transition: loaded ? 'opacity 0.3s ease' : 'none',
        opacity: loaded ? 1 : 0.6,
        display: hasError ? 'flex' : undefined,
        alignItems: hasError ? 'center' : undefined,
        justifyContent: hasError ? 'center' : undefined,
      }}
    >
      {hasError && <span style={{ fontSize: 36, opacity: 0.5 }}>🍽️</span>}
      {!loaded && !hasError && children}
    </div>
  );
}
