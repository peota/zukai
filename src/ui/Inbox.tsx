import type { Kind } from "../model/kinds";
import { Icon } from "./icons";
import type { PointerHandlers } from "./useFolderDrag";

export interface InboxItem {
  id: string;
  title: string;
  kind: Kind;
}

export interface InboxProps {
  items: InboxItem[];
  activeId: string | null;
  onActivate(id: string): void;
  onContextMenu(id: string, x: number, y: number): void;
  dragHandlers(id: string): PointerHandlers;
  swallowClick(): boolean;
}

/** The open Scratchpads, below the Library tree (spec 5.2). */
export function Inbox({
  items,
  activeId,
  onActivate,
  onContextMenu,
  dragHandlers,
  swallowClick,
}: InboxProps) {
  if (items.length === 0) return null;
  return (
    <section className="flex max-h-[40%] min-h-0 shrink-0 flex-col">
      <div className="px-2 pt-2.5 pb-1 text-[10.5px] tracking-[0.02em] text-faint">
        INBOX
      </div>
      <ul aria-label="Inbox" className="min-h-0 overflow-y-auto pb-2">
        {items.map((item) => {
          const active = item.id === activeId;
          return (
            <li
              key={item.id}
              aria-current={active ? "true" : undefined}
              title={item.title}
              onClick={() => {
                if (swallowClick()) return;
                onActivate(item.id);
              }}
              onContextMenu={(e) => {
                e.preventDefault();
                e.stopPropagation();
                onContextMenu(item.id, e.clientX, e.clientY);
              }}
              {...dragHandlers(item.id)}
              className={
                "flex h-[26px] cursor-default items-center gap-[7px] rounded-[6px] px-2 whitespace-nowrap text-muted " +
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
