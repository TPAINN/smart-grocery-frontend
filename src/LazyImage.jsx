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
  const [bgUrl,  setBgUrl]  = useState('');

  useEffect(() => {
    if (!src) return;

    // If IntersectionObserver is unavailable (old browser), load immediately
    if (!('IntersectionObserver' in window)) {
      setBgUrl(src);
      setLoaded(true);
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
          img.onerror = () => { setBgUrl(src); setLoaded(true); }; // show anyway on error
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
        backgroundImage: bgUrl ? `url(${bgUrl})` : 'none',
        transition: loaded ? 'opacity 0.3s ease' : 'none',
        opacity: loaded ? 1 : 0.6,
      }}
    >
      {!loaded && children}
    </div>
  );
}
