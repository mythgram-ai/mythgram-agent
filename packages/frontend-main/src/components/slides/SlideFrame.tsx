import { useEffect, useRef, useState } from "react";
import { cn } from "@/utils/cn";

/**
 * Canonical slide design canvas. Every slide is authored at 1280x720 and scaled to
 * fit its container, so the deck always keeps a true 16:9 ratio and can never
 * produce scrollbars or clipped fixed-size content.
 */
export const SLIDE_WIDTH = 1280;
export const SLIDE_HEIGHT = 720;

export function SlideFrame({
  html,
  title,
  className,
}: {
  html: string;
  title?: string;
  className?: string;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(0);

  useEffect(() => {
    const element = wrapRef.current;
    if (!element) return;
    const update = () => {
      const width = element.clientWidth;
      setScale(width > 0 ? width / SLIDE_WIDTH : 0);
    };
    update();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(update);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  return (
    <div
      ref={wrapRef}
      className={cn("relative w-full overflow-hidden bg-transparent", className)}
      style={{ aspectRatio: `${SLIDE_WIDTH} / ${SLIDE_HEIGHT}` }}
    >
      {scale > 0 && (
        <iframe
          title={title ?? "Slide"}
          srcDoc={html}
          sandbox="allow-scripts"
          scrolling="no"
          loading="lazy"
          style={{
            width: SLIDE_WIDTH,
            height: SLIDE_HEIGHT,
            border: 0,
            position: "absolute",
            top: 0,
            left: 0,
            transform: `scale(${scale})`,
            transformOrigin: "top left",
            pointerEvents: "none",
          }}
        />
      )}
    </div>
  );
}