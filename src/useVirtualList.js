// useVirtualList.js — Lightweight DOM windowing for large grocery lists
// Only renders visible items + a small overscan buffer.
// Zero dependencies — uses ResizeObserver + scroll events.
import { useState, useEffect, useRef, useCallback } from 'react';

const DEFAULT_ITEM_HEIGHT = 72; // px — approximate SwipeableItem height
const OVERSCAN            = 5;  // extra items above/below viewport

/**
 * useVirtualList
 *
 * @param {Array}  items        — full array of list items
 * @param {number} itemHeight   — estimated height per item in px (default 72)
 * @returns {{
 *   containerRef,   — attach to the scrollable container
 *   totalHeight,    — the total pixel height to reserve (for scrollbar accuracy)
 *   virtualItems,   — subset of items to actually render: [{item, index, offsetY}]
 * }}
 *
 * Usage:
 *   const { containerRef, totalHeight, virtualItems } = useVirtualList(items);
 *   <div ref={containerRef} style={{ overflowY:'auto', height:'100%' }}>
 *     <div style={{ height: totalHeight, position:'relative' }}>
 *       {virtualItems.map(({ item, index, offsetY }) => (
 *         <div key={item.id} style={{ position:'absolute', top: offsetY, width:'100%' }}>
 *           <SwipeableItem item={item} ... />
 *         </div>
 *       ))}
 *     </div>
 *   </div>
 *
 * NOTE: Only activates for lists with 40+ items. Below that the normal render is used.
 */
export function useVirtualList(items, itemHeight = DEFAULT_ITEM_HEIGHT) {
  const containerRef   = useRef(null);
  const [scrollTop,    setScrollTop]    = useState(0);
  const [viewportH,    setViewportH]    = useState(600);

  // Sync scroll position
  const onScroll = useCallback(() => {
    if (containerRef.current) setScrollTop(containerRef.current.scrollTop);
  }, []);

  // Sync container height on resize
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const ro = new ResizeObserver(([entry]) => {
      setViewportH(entry.contentRect.height || 600);
    });
    ro.observe(el);
    el.addEventListener('scroll', onScroll, { passive: true });

    return () => { ro.disconnect(); el.removeEventListener('scroll', onScroll); };
  }, [onScroll]);

  const totalHeight = items.length * itemHeight;

  // Don't virtualize small lists — overhead not worth it
  if (items.length < 40) {
    return {
      containerRef,
      totalHeight,
      virtualItems: items.map((item, index) => ({ item, index, offsetY: index * itemHeight })),
      isVirtualized: false,
    };
  }

  const startIndex = Math.max(0, Math.floor(scrollTop / itemHeight) - OVERSCAN);
  const endIndex   = Math.min(items.length - 1, Math.ceil((scrollTop + viewportH) / itemHeight) + OVERSCAN);

  const virtualItems = [];
  for (let i = startIndex; i <= endIndex; i++) {
    virtualItems.push({ item: items[i], index: i, offsetY: i * itemHeight });
  }

  return { containerRef, totalHeight, virtualItems, isVirtualized: true };
}
