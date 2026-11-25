import { useRef } from "react";
import type { KeyboardEvent, PointerEvent } from "react";
import { clampTerminalSize } from "../model/settings";

/** The arrow keys' step, in px. */
const KEY_STEP = 16;

/**
 * A right-docked panel's left edge: drag (or arrow keys) to resize, like
 * the terminal's. The panel's width stays within `min` and 70% of the row
 * it sits in, the same base as its CSS maxWidth.
 */
export function PanelResizeEdge({
  label,
  width,
  min,
  onWidth,
}: {
  /** The separator's accessible name, e.g. "Resize Ask panel". */
  label: string;
  width: number;
  min: number;
  onWidth(px: number): void;
}) {
  const press = useRef<{ pointerId: number; at: number; width: number } | null>(
    null,
  );
  const clamp = (el: HTMLElement, px: number) =>
    clampTerminalSize(
      px,
      min,
      el.closest<HTMLElement>("[data-z-right-panel]")?.parentElement
        ?.clientWidth || window.innerWidth,
    );

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    e.preventDefault();
    press.current = { pointerId: e.pointerId, at: e.clientX, width };
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      // No capture: moves over the edge still resize.
    }
  };
  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    const p = press.current;
    if (!p || p.pointerId !== e.pointerId) return;
    if ((e.buttons & 1) === 0) {
      press.current = null; // the release was missed
      return;
    }
    // Dragging left makes the panel wider.
    onWidth(clamp(e.currentTarget, p.width + p.at - e.clientX));
  };
  const end = (e: PointerEvent<HTMLDivElement>) => {
    if (press.current?.pointerId === e.pointerId) press.current = null;
  };
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const step =
      e.key === "ArrowLeft" ? KEY_STEP : e.key === "ArrowRight" ? -KEY_STEP : 0;
    if (step === 0) return;
    e.preventDefault();
    onWidth(clamp(e.currentTarget, width + step));
  };

  return (
    <div className="relative w-px shrink-0 bg-hairline">
      <div
        role="separator"
        aria-label={label}
        aria-orientation="vertical"
        aria-valuenow={width}
        title="Drag to resize"
        tabIndex={0}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={end}
        onPointerCancel={end}
        onKeyDown={onKeyDown}
        className="absolute top-0 bottom-0 -left-[3px] z-10 w-[7px] cursor-col-resize outline-none hover:bg-accent-soft focus-visible:bg-accent-soft"
      />
    </div>
  );
}
