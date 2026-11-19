import type { Kind } from "../model/kinds";
import { Icon } from "./icons";
import type { PointerHandlers } from "./useFolderDrag";

export interface ScratchpadItem {
  id: string;
  title: string;
  kind: Kind;
}

export interface ScratchpadListProps {
  items: ScratchpadItem[];
  activeId: string | null;
  onActivate(id: string): void;
  /** `from` gets the keyboard back when the menu closes. */
  onContextMenu(id: string, x: number, y: number, from: HTMLElement): void;
  dragHandlers(id: string): PointerHandlers;
  swallowClick(): boolean;
}

/** The open Scratchpads, below the Library tree (spec 5.2). */
export function ScratchpadList({
  items,
  activeId,
  onActivate,
  onContextMenu,
  dragHandlers,
  swallowClick,
}: ScratchpadListProps) {
  if (items.length === 0) return null;
  // One stop in the Tab order: the active Scratchpad, else the first.
  const stop = items.some((i) => i.id === activeId) ? activeId : items[0].id;
  return (
    <section className="flex max-h-[40%] min-h-0 shrink-0 flex-col">
      <div className="px-2 pt-2.5 pb-1 text-[10.5px] tracking-[0.02em] text-faint">
        SCRATCHPADS
      </div>
      <ul aria-label="Scratchpads" className="min-h-0 overflow-y-auto pb-2">
        {items.map((item) => {
          const active = item.id === activeId;
          return (
            <li
              key={item.id}
              aria-current={active ? "true" : undefined}
              title={item.title}
              tabIndex={item.id === stop ? 0 : -1}
              onKeyDown={(e) => {
                const li = e.currentTarget;
                if (e.key === "Enter" || e.key === " ") {
                  onActivate(item.id);
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
              onClick={() => {
                if (swallowClick()) return;
                onActivate(item.id);
              }}
              onContextMenu={(e) => {
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
              {...dragHandlers(item.id)}
              className={
                "flex h-[26px] cursor-default items-center gap-[7px] rounded-[6px] px-2 whitespace-nowrap text-muted outline-none focus-visible:shadow-[inset_0_0_0_1px_var(--z-accent-soft)] " +
                (active ? "bg-row-sel text-text" : "hover:bg-row-hover")
              }
            >
              <span className="w-2.5 shrink-0" />
              <Icon
                name={item.kind === "canvas" ? "canvas" : "scratchpad"}
                className="text-muted"
              />
              <span className="min-w-0 flex-1 truncate">{item.title}</span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
