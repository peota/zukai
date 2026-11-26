import type { ReactNode } from "react";

export const BUTTON =
  "flex h-8 min-w-8 items-center justify-center rounded-[6px] px-2 text-muted hover:bg-row-hover hover:text-text disabled:pointer-events-none disabled:opacity-40";

/**
 * A titled group of Settings rows (Theme, Text size, ...). Rows inside are
 * split by hairlines; groups are split by space, so each reads as one block.
 */
export function Group({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <section className="flex flex-col [&+&]:mt-9">
      <h3 className="m-0 mb-1 text-ui-xs font-semibold tracking-[0.06em] text-faint">
        {title.toUpperCase()}
      </h3>
      <div className="flex flex-col [&>*+*]:border-t [&>*+*]:border-hairline-strong">
        {children}
      </div>
    </section>
  );
}

/**
 * One Settings row: its label (and an optional hint under it) on the left,
 * the control on the right. `stack` puts a wide control under the label.
 */
export function Row({
  label,
  hint,
  hintId,
  stack = false,
  children,
}: {
  label: ReactNode;
  hint?: ReactNode;
  /** The hint's id, for the control's aria-describedby. */
  hintId?: string;
  stack?: boolean;
  children: ReactNode;
}) {
  const text = (
    <div className="flex min-w-0 flex-1 flex-col gap-1">
      <div className="text-ui-lg text-text">{label}</div>
      {hint && (
        <div id={hintId} className="text-ui-sm leading-snug text-faint">
          {hint}
        </div>
      )}
    </div>
  );
  if (stack) {
    return (
      <div className="flex flex-col gap-3 py-4">
        {text}
        <div className="flex flex-wrap items-center gap-3">{children}</div>
      </div>
    );
  }
  return (
    <div className="flex min-h-14 items-center gap-6 py-3">
      {text}
      <div className="flex shrink-0 items-center gap-1.5">{children}</div>
    </div>
  );
}
