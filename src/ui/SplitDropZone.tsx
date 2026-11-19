import type { SplitOrientation } from "../model/types";

/** Which edge of the editor area a point is on: right third, bottom third. */
export function dropSide(
  rect: DOMRect,
  x: number,
  y: number,
): SplitOrientation | null {
  if (x < rect.left || x > rect.right || y < rect.top || y > rect.bottom) {
    return null;
  }
  if (x >= rect.left + (rect.width * 2) / 3) return "row";
  if (y >= rect.top + (rect.height * 2) / 3) return "column";
  return null;
}

/** The half of the editor area a dropped Tab would take. */
export function SplitDropZone({ side }: { side: SplitOrientation }) {
  return (
    <div
      aria-hidden="true"
      data-split-drop={side}
      className={
        "pointer-events-none absolute z-20 bg-accent-soft " +
        (side === "row"
          ? "bottom-0 right-0 top-0 w-1/2"
          : "bottom-0 left-0 right-0 h-1/2")
      }
    />
  );
}
