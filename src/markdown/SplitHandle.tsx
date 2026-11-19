import { useRef } from "react";
import type { PointerEvent } from "react";
import { clampSplit, SPLIT_MAX, SPLIT_MIN } from "../model/settings";

/** The arrow keys' step. */
const KEY_STEP = 0.05;

export interface SplitHandleProps {
  /** The editor's share of the row (0.2–0.8). */
  ratio: number;
  onRatio(r: number): void;
}

/**
 * The divider between the editor and the Markdown preview: drag it, use
 * the arrow keys, or double-click it for an even split. It measures the row
 * it's placed in (the parent of its divider line).
 */
export function SplitHandle({ ratio, onRatio }: SplitHandleProps) {
  const press = useRef<{ pointerId: number } | null>(null);

  const ratioAt = (el: HTMLElement, x: number) => {
    const row = el.parentElement?.parentElement?.getBoundingClientRect();
    if (!row || row.width <= 0) return ratio;
    return clampSplit((x - row.left) / row.width);
  };

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    e.preventDefault();
    press.current = { pointerId: e.pointerId };
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      // No capture: moves over the handle still resize.
    }
  };
  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    const p = press.current;
    if (!p || p.pointerId !== e.pointerId) return;
    if ((e.buttons & 1) === 0) {
      press.current = null; // the release was missed
      return;
    }
    onRatio(ratioAt(e.currentTarget, e.clientX));
  };
  const end = (e: PointerEvent<HTMLDivElement>) => {
    if (press.current?.pointerId === e.pointerId) press.current = null;
  };

  return (
    <div className="relative w-px shrink-0 bg-hairline">
      <div
        role="separator"
        aria-label="Resize preview"
        aria-orientation="vertical"
        aria-valuemin={Math.round(SPLIT_MIN * 100)}
        aria-valuemax={Math.round(SPLIT_MAX * 100)}
        aria-valuenow={Math.round(ratio * 100)}
        title="Drag to resize; double-click for half and half"
        tabIndex={0}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={end}
        onPointerCancel={end}
        onDoubleClick={() => onRatio(0.5)}
        onKeyDown={(e) => {
          const step =
            e.key === "ArrowRight"
              ? KEY_STEP
              : e.key === "ArrowLeft"
                ? -KEY_STEP
                : 0;
          if (step === 0) return;
          e.preventDefault();
          onRatio(clampSplit(ratio + step));
        }}
        className="absolute top-0 -left-[3px] bottom-0 z-10 w-[7px] cursor-col-resize outline-none hover:bg-accent-soft focus-visible:bg-accent-soft"
      />
    </div>
  );
}
