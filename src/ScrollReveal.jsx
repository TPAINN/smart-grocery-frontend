// Fade+slide-up wrapper using IntersectionObserver.
// Works for both first-paint items AND things appended later (infinite scroll).
// Stagger via the `delay` prop — no JS timers needed, just CSS transition-delay.
//
// <ScrollReveal delay={idx * 60}>
//   <RecipeCard ... />
// </ScrollReveal>

import { useEffect, useRef, useState } from 'react';

export default function ScrollReveal({
  children,
  delay  = 0,
  y      = 24,
  once   = true,
  style  = {},
  className,
}) {
  const ref     = useRef(null);
  const [seen, setSeen] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    // Fire immediately if element is already in view
    // (handles items visible on first render without needing to scroll)
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting) {
          setSeen(true);
          if (once) observer.disconnect();
        }
      },
      { rootMargin: '0px 0px -40px 0px', threshold: 0.05 }
    );

    observer.observe(el);
    return () => observer.disconnect();
  }, [once]);

  return (
    <div
      ref={ref}
      className={className}
      style={{
        opacity:    seen ? 1 : 0,
        transform:  seen ? 'translateY(0)' : `translateY(${y}px)`,
        // The transition only applies once `seen` flips — the delay
        // creates the stagger without any JavaScript timers.
        transition: seen
          ? `opacity 0.5s cubic-bezier(0.22,1,0.36,1) ${delay}ms,
             transform 0.5s cubic-bezier(0.22,1,0.36,1) ${delay}ms`
          : 'none',
        ...style,
      }}
    >
      {children}
    </div>
  );
}
