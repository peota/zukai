import type { ClosedEntry, SplitOrientation } from "../model/types";
import { Menu, type MenuItem } from "./Menu";

/** The Recently closed list shows at most this many entries. */
export const RECENT_LIMIT = 20;

export interface TabContextMenuProps {
  x: number;
  y: number;
  /** The right-clicked Tab, or null for the empty part of the tab bar. */
  tabId: string | null;
  /** Open Tabs: "Close other tabs" needs another one. */
  tabCount: number;
  /** Newest first. */
  closed: ClosedEntry[];
  /** Shown next to "Reopen closed tab", e.g. "Ctrl+Shift+T". */
  reopenHint?: string;
  /** The right-clicked Tab is pinned: the item reads "Unpin tab". */
  pinned?: boolean;
  onTogglePin(id: string): void;
  onClose(id: string): void;
  onCloseOthers(id: string): void;
  /** False when every open Tab is pinned (pins stay open). */
  canCloseAll?: boolean;
  onCloseAll(): void;
  /** False when no open File has unsaved changes. */
  canSaveAll?: boolean;
  onSaveAll(): void;
  onReopen(): void;
  /** The entry's Tab id: the list may change before the click lands. */
  onReopenEntry(id: string): void;
  onDismiss(): void;
  /** Tabs the right-clicked one could be joined with. */
  splitCandidates: { id: string; title: string }[];
  /** Present when the right-clicked tab is a joined one. */
  split?: { orientation: SplitOrientation };
  onSplitWith(id: string, other: string): void;
  onUnsplit(id: string): void;
  onSwap(id: string): void;
  onOrientation(id: string, o: SplitOrientation): void;
  onCloseSplit(id: string): void;
}

/** Right-click menu of the tab bar (spec 5.9). */
export function TabContextMenu({
  x,
  y,
  tabId,
  tabCount,
  closed,
  reopenHint,
  pinned = false,
  onTogglePin,
  onClose,
  onCloseOthers,
  canCloseAll = true,
  onCloseAll,
  canSaveAll = true,
  onSaveAll,
  onReopen,
  onReopenEntry,
  onDismiss,
  splitCandidates,
  split,
  onSplitWith,
  onUnsplit,
  onSwap,
  onOrientation,
  onCloseSplit,
}: TabContextMenuProps) {
  const joinedItems = (id: string, o: SplitOrientation): MenuItem[] => [
    { label: "Unsplit", separated: true, onSelect: () => onUnsplit(id) },
    { label: "Swap sides", onSelect: () => onSwap(id) },
    o === "row"
      ? {
          label: "Top and bottom",
          onSelect: () => onOrientation(id, "column"),
        }
      : { label: "Side by side", onSelect: () => onOrientation(id, "row") },
    { label: "Close split", onSelect: () => onCloseSplit(id) },
  ];
  const recent: MenuItem[] = closed.slice(0, RECENT_LIMIT).map((e) => ({
    label: e.tab.title,
    detail: e.tab.file?.path,
    onSelect: () => onReopenEntry(e.tab.id),
  }));
  const items: MenuItem[] = [
    {
      label: pinned ? "Unpin tab" : "Pin tab",
      disabled: tabId === null,
      onSelect: () => tabId !== null && onTogglePin(tabId),
    },
    ...(split && tabId !== null
      ? joinedItems(tabId, split.orientation)
      : [
          {
            label: "Split with",
            separated: true,
            disabled: tabId === null || splitCandidates.length === 0,
            submenu: splitCandidates.map((c) => ({
              label: c.title,
              onSelect: () => tabId !== null && onSplitWith(tabId, c.id),
            })),
          },
          {
            label: "Close tab",
            disabled: tabId === null,
            onSelect: () => tabId !== null && onClose(tabId),
          },
          {
            label: "Close other tabs",
            disabled: tabId === null || tabCount < 2,
            onSelect: () => tabId !== null && onCloseOthers(tabId),
          },
        ]),
    {
      label: "Save all",
      disabled: !canSaveAll,
      onSelect: onSaveAll,
    },
    {
      label: "Close all tabs",
      disabled: !canCloseAll,
      onSelect: onCloseAll,
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
