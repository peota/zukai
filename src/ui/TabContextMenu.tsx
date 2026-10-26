import type { ClosedEntry } from "../model/types";
import { Menu, type MenuItem } from "./Menu";

/** The Recently closed list shows at most this many entries. */
export const RECENT_LIMIT = 20;

export interface TabContextMenuProps {
  x: number;
  y: number;
  /** The right-clicked Tab, or null for the empty part of the tab bar. */
  tabId: string | null;
  /** Newest first. */
  closed: ClosedEntry[];
  /** Shown next to "Reopen closed tab", e.g. "Ctrl+Shift+T". */
  reopenHint?: string;
  onClose(id: string): void;
  onCloseOthers(id: string): void;
  onReopen(): void;
  onReopenEntry(index: number): void;
  onDismiss(): void;
}

/** Right-click menu of the tab bar (spec 5.9). */
export function TabContextMenu({
  x,
  y,
  tabId,
  closed,
  reopenHint,
  onClose,
  onCloseOthers,
  onReopen,
  onReopenEntry,
  onDismiss,
}: TabContextMenuProps) {
  const recent: MenuItem[] = closed.slice(0, RECENT_LIMIT).map((e, i) => ({
    label: e.tab.title,
    detail: e.tab.file?.path,
    onSelect: () => onReopenEntry(i),
  }));
  const items: MenuItem[] = [
    {
      label: "Close tab",
      disabled: tabId === null,
      onSelect: () => tabId !== null && onClose(tabId),
    },
    {
      label: "Close other tabs",
      disabled: tabId === null,
      onSelect: () => tabId !== null && onCloseOthers(tabId),
    },
    {
      label: "Reopen closed tab",
      hint: reopenHint,
      disabled: closed.length === 0,
      separated: true,
      onSelect: onReopen,
    },
    {
      label: "Recently closed",
      submenu: recent,
      submenuEmpty: "Nothing closed yet",
    },
  ];
  return <Menu label="Tab" x={x} y={y} items={items} onDismiss={onDismiss} />;
}
