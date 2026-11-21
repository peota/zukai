import { useEffect } from "react";
import type { RefObject } from "react";
import { createPortal } from "react-dom";
import { Icon, type IconName } from "./icons";
import type { DragGhost as Ghost } from "./useFolderDrag";

/** How long a released ghost takes to settle (ms). */
const SETTLE_MS = 180;

/**
 * The lifted row that follows the pointer while a Library row or Scratchpad
 * drags. It floats (the float shadow, like a dragged Tab), fades in on the
 * lift, and on release glides into its folder or back to its row.
 */
export function DragGhost({
  ghost,
  ghostRef,
  onDone,
  name,
  icon,
  count,
}: {
  ghost: Ghost;
  ghostRef: RefObject<HTMLDivElement | null>;
  onDone(): void;
  name: string;
  icon: IconName;
  /** Items carried along (a selection); 1 shows no count. */
  count: number;
}) {
  const { landing } = ghost;
  // transitionend doesn't fire when nothing moved: a timer backs it up.
  useEffect(() => {
    if (!landing) return;
    const t = window.setTimeout(onDone, SETTLE_MS + 60);
    return () => window.clearTimeout(t);
  }, [landing, onDone]);

  const at = landing ?? ghost;
  return createPortal(
    <div
      ref={ghostRef}
      aria-hidden="true"
      data-drag-ghost={landing ? (landing.drop ? "drop" : "return") : "drag"}
      onTransitionEnd={(e) => {
        if (landing && e.propertyName === "opacity") onDone();
      }}
      style={{
        width: ghost.width,
        transform:
          `translate(${at.left}px, ${at.top}px)` +
          (landing?.drop ? " scale(0.94)" : ""),
        opacity: landing ? 0 : 1,
        transition: landing
          ? `transform ${SETTLE_MS}ms cubic-bezier(0.16, 1, 0.3, 1), opacity ${SETTLE_MS}ms ease-in`
          : undefined,
      }}
      className="pointer-events-none fixed top-0 left-0 z-50 origin-top-left"
    >
      <div className="z-fade-in flex h-[30px] items-center gap-2 rounded-[6px] bg-surface px-2 text-ui-lg whitespace-nowrap text-text shadow-float">
        <span className="w-3.5 shrink-0" />
        <Icon name={icon} className="text-muted" />
        <span className="min-w-0 flex-1 truncate">{name}</span>
        {count > 1 && (
          <span className="shrink-0 rounded-full bg-accent px-1.5 text-ui-xs leading-[18px] font-semibold text-accent-fg tabular-nums">
            {count}
          </span>
        )}
      </div>
    </div>,
    document.body,
  );
}
