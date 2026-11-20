import { formatKeys } from "../app/shortcutList";
import type { Platform } from "../app/shortcuts";
import { Icon } from "./icons";

/**
 * Shows or hides the Library sidebar, at the title bar's left end. Its
 * tooltip names the shortcut (Mod+B), so a click teaches the key.
 */
export function SidebarToggle({
  open,
  platform,
  inset = 0,
  onToggle,
}: {
  open: boolean;
  platform: Platform;
  /** Room on the left (macOS draws its traffic lights there). */
  inset?: number;
  onToggle(): void;
}) {
  const label = open ? "Hide sidebar" : "Show sidebar";
  return (
    <div
      data-tauri-drag-region=""
      style={inset ? { paddingLeft: inset } : undefined}
      className="flex h-11 shrink-0 items-end pb-[3px] pl-2"
    >
      <button
        type="button"
        tabIndex={-1}
        aria-label={label}
        aria-expanded={open}
        title={`${label} (${formatKeys(["Mod", "B"], platform)})`}
        onClick={onToggle}
        className="flex size-7 items-center justify-center rounded-[6px] text-muted hover:bg-row-hover hover:text-text"
      >
        <Icon name="sidebar" />
      </button>
    </div>
  );
}
