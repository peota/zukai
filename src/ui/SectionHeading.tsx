import type { ReactNode } from "react";

/**
 * A sidebar section's heading (RECENT, PINNED, LIBRARY, SCRATCHPADS): one
 * height and one gap above it, so every section starts on the same rhythm.
 * `children` are its actions, at the end of the row.
 */
export function SectionHeading({
  label,
  children,
}: {
  label: string;
  children?: ReactNode;
}) {
  return (
    <div className="mt-4 mb-0.5 flex h-7 shrink-0 items-center gap-0.5 pr-0.5 pl-2 text-ui-xs font-semibold tracking-[0.06em] text-faint">
      <span className="flex-1">{label}</span>
      {children}
    </div>
  );
}
