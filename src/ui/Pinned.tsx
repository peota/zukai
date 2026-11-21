import { baseName } from "../files/paths";
import type { ClosedEntry, TabState } from "../model/types";
import { fileIcon, Icon, type IconName } from "./icons";
import { SectionHeading } from "./SectionHeading";

export interface PinnedItem {
  /** The Tab's id, open or in Recently Closed. */
  id: string;
  title: string;
  icon: IconName;
  /** False for a pinned Tab that was closed: shown dimmed, reopens on click. */
  open: boolean;
}

const iconOf = (t: TabState): IconName =>
  t.file
    ? fileIcon(baseName(t.file.path))
    : t.kind === "canvas"
      ? "canvas"
      : "scratchpad";

/** The open pinned Tabs in tab order, then the closed ones, newest first. */
export function pinnedItems(
  tabs: readonly TabState[],
  closed: readonly ClosedEntry[],
): PinnedItem[] {
  const item = (t: TabState, open: boolean): PinnedItem => ({
    id: t.id,
    title: t.title,
    icon: iconOf(t),
    open,
  });
  return [
    ...tabs.filter((t) => t.pinned).map((t) => item(t, true)),
    ...closed.filter((e) => e.tab.pinned).map((e) => item(e.tab, false)),
  ];
}

/** How many Files the sidebar's Recent list shows. */
export const RECENT_SHOWN = 8;

/**
 * The Recent list: File Tabs by `recent` (ids, newest first), open or in
 * Recently Closed, one per File, without pinned ones (they're listed above)
 * or deleted ones: an open Tab whose File is Missing, or a closed one in
 * `gone` (ids whose File was found not to exist).
 */
export function recentItems(
  recent: readonly string[],
  tabs: readonly TabState[],
  closed: readonly ClosedEntry[],
  keyOf: (path: string) => string,
  gone: ReadonlySet<string> = new Set(),
): PinnedItem[] {
  const open = new Map(tabs.map((t) => [t.id, t]));
  const shut = new Map(closed.map((e) => [e.tab.id, e.tab]));
  const seen = new Set<string>();
  const out: PinnedItem[] = [];
  for (const id of recent) {
    const t = open.get(id) ?? shut.get(id);
    if (!t?.file || t.pinned) continue;
    if (t.file.held === "missing" || gone.has(id)) continue;
    const key = keyOf(t.file.path);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ id, title: t.title, icon: iconOf(t), open: open.has(id) });
    if (out.length === RECENT_SHOWN) break;
  }
  return out;
}

export interface TabListProps {
  /** Shown as the heading, in capitals, and as the list's name. */
  label: string;
  items: PinnedItem[];
  activeId: string | null;
  onOpen(id: string): void;
  /** `from` gets the keyboard back when the menu closes. */
  onContextMenu?(id: string, x: number, y: number, from: HTMLElement): void;
}

export type PinnedProps = Omit<TabListProps, "label">;

/** Pinned Tabs, open or closed, near the top of the sidebar. */
export const Pinned = (props: PinnedProps) => (
  <TabList label="Pinned" {...props} />
);

/** A sidebar list of Tabs, open or closed: Pinned and Recent. */
export function TabList({
  label,
  items,
  activeId,
  onOpen,
  onContextMenu,
}: TabListProps) {
  if (items.length === 0) return null;
  // One stop in the Tab order: the active pin, else the first.
  const stop = items.some((i) => i.id === activeId) ? activeId : items[0].id;
  return (
    <section className="flex max-h-[35%] min-h-0 shrink-0 flex-col">
      <SectionHeading label={label.toUpperCase()} />
      <ul aria-label={label} className="min-h-0 overflow-y-auto pb-1">
        {items.map((item) => {
          const active = item.open && item.id === activeId;
          return (
            <li
              key={item.id}
              aria-current={active ? "true" : undefined}
              title={item.open ? item.title : `${item.title} (closed)`}
              tabIndex={item.id === stop ? 0 : -1}
              onKeyDown={(e) => {
                const li = e.currentTarget;
                if (e.key === "Enter" || e.key === " ") {
                  onOpen(item.id);
                } else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
                  const next =
                    e.key === "ArrowDown"
                      ? li.nextElementSibling
                      : li.previousElementSibling;
                  (next as HTMLElement | null)?.focus();
                } else {
                  return;
                }
                e.preventDefault();
                e.stopPropagation();
              }}
              onClick={() => onOpen(item.id)}
              onContextMenu={(e) => {
                if (!onContextMenu) return;
                e.preventDefault();
                e.stopPropagation();
                const li = e.currentTarget;
                // The context-menu key / Shift+F10 has no pointer position.
                if (e.clientX === 0 && e.clientY === 0) {
                  const box = li.getBoundingClientRect();
                  onContextMenu(item.id, box.left, box.bottom, li);
                } else {
                  onContextMenu(item.id, e.clientX, e.clientY, li);
                }
              }}
              className={
                "flex h-[30px] cursor-default items-center gap-2 rounded-[6px] px-2 whitespace-nowrap outline-none focus-visible:shadow-[inset_0_0_0_1px_var(--z-accent-soft)] " +
                // The active item's fill belongs to its home row (the tree or
                // Scratchpads); a shortcut list marks it by ink and icon alone,
                // so the screen never shows two selected rows for one Tab.
                (active
                  ? "text-text "
                  : item.open
                    ? "text-muted "
                    : "text-faint ") +
                "hover:bg-row-hover"
              }
            >
              <span className="w-3.5 shrink-0" />
              <Icon
                name={item.icon}
                className={
                  active
                    ? "text-accent"
                    : item.open
                      ? "text-muted"
                      : "text-faint"
                }
              />
              <span className="min-w-0 flex-1 truncate">{item.title}</span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
