import type { ReactNode } from "react";

export const BUTTON =
  "rounded-[5px] px-2 py-[3px] text-muted hover:bg-row-hover hover:text-text disabled:pointer-events-none disabled:opacity-40";

/** One Settings row: its label on the left, the control on the right. */
export function Row({
  label,
  children,
}: {
  label: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="flex min-h-11 items-center gap-4">
      <div className="flex-1 text-text">{label}</div>
      <div className="flex shrink-0 items-center gap-1">{children}</div>
    </div>
  );
}
