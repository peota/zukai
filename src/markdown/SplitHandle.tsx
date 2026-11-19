import { useRef } from "react";
import type { PointerEvent } from "react";
import { clampSplit, SPLIT_MAX, SPLIT_MIN } from "../model/settings";
import type { SplitOrientation } from "../model/types";

/** The arrow keys' step. */
const KEY_STEP = 0.05;

export interface SplitHandleProps {
  /** The editor's share of the row (0.2–0.8). */
  ratio: number;
  onRatio(r: number): void;
  /** "row" (default): a vertical line, left and right; "column": above and below. */
  orientation?: SplitOrientation;
  /** Its accessible name ("Resize preview" when unset). */
  label?: string;
}

/**
 * A divider between two halves (the editor and its Markdown preview, or the
 * two Tabs of a Split): drag it, use the arrow keys, or double-click it for
 * an even split. It measures the row (or column) it's placed in, the parent
 * of its divider line.
 */
export function SplitHandle({
  ratio,
  onRatio,
  orientation = "row",
  label = "Resize preview",
}: SplitHandleProps) {
  const press = useRef<{ pointerId: number } | null>(null);
  const row = orientation === "row";

  const ratioAt = (el: HTMLElement, e: PointerEvent<HTMLDivElement>) => {
    const box = el.parentElement?.parentElement?.getBoundingClientRect();
    if (!box) return ratio;
    const [at, start, size] = row
      ? [e.clientX, box.left, box.width]
      : [e.clientY, box.top, box.height];
    if (size <= 0) return ratio;
    return clampSplit((at - start) / size);
  };
  const [back, forward] = row
    ? ["ArrowLeft", "ArrowRight"]
    : ["ArrowUp", "ArrowDown"];

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
    onRatio(ratioAt(e.currentTarget, e));
  };
  const end = (e: PointerEvent<HTMLDivElement>) => {
    if (press.current?.pointerId === e.pointerId) press.current = null;
  };

  return (
    <div className={`relative shrink-0 bg-hairline ${row ? "w-px" : "h-px"}`}>
      <div
        role="separator"
        aria-label={label}
        aria-orientation={row ? "vertical" : "horizontal"}
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
            e.key === forward ? KEY_STEP : e.key === back ? -KEY_STEP : 0;
          if (step === 0) return;
          e.preventDefault();
          onRatio(clampSplit(ratio + step));
        }}
        className={`absolute z-10 outline-none hover:bg-accent-soft focus-visible:bg-accent-soft ${
          row
            ? "top-0 -left-[3px] bottom-0 w-[7px] cursor-col-resize"
            : "left-0 -top-[3px] right-0 h-[7px] cursor-row-resize"
        }`}
      />
    </div>
  );
}
