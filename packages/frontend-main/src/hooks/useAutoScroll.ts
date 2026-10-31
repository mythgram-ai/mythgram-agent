import { useCallback, useEffect, useRef } from "react";

/**
 * Keeps a scroll container pinned to the bottom while new content streams in — but only when
 * the user is already near the bottom. If they scroll up to read history, streaming no longer
 * yanks them back down. Uses rAF and avoids layout thrash so it stays smooth under heavy token
 * streams.
 */
export function useAutoScroll<T extends HTMLElement>(dep: unknown) {
  const ref = useRef<T | null>(null);
  const pinnedRef = useRef(true);
  const frameRef = useRef<number | null>(null);

  const onScroll = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    const distance = el.scrollHeight - el.scrollTop - el.clientHeight;
    pinnedRef.current = distance < 120;
  }, []);

  useEffect(() => {
    const el = ref.current;
    if (!el || !pinnedRef.current) return;
    if (frameRef.current) cancelAnimationFrame(frameRef.current);
    frameRef.current = requestAnimationFrame(() => {
      el.scrollTop = el.scrollHeight;
    });
    return () => {
      if (frameRef.current) cancelAnimationFrame(frameRef.current);
    };
  }, [dep]);

  return { ref, onScroll };
}
