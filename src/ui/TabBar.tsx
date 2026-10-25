import { useEffect, useRef, useState } from "react";
import type { DragEvent, KeyboardEvent, WheelEvent } from "react";

export interface TabBarItem {
  id: string;
  title: string;
  active: boolean;
}

export interface TabBarProps {
  tabs: TabBarItem[];
  onActivate(id: string): void;
  onClose(id: string): void;
  onNew(): void;
  onMove(id: string, toIndex: number): void;
  onRename(id: string, name: string): void;
}

const DRAG_TYPE = "application/x-zukai-tab";

export function TabBar({
  tabs,
  onActivate,
  onClose,
  onNew,
  onMove,
  onRename,
}: TabBarProps) {
  const activeRef = useRef<HTMLDivElement>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const activeId = tabs.find((t) => t.active)?.id;

  useEffect(() => {
    activeRef.current?.scrollIntoView({ inline: "nearest", block: "nearest" });
  }, [activeId]);

  // The bar only scrolls horizontally; map the vertical wheel onto it.
  const onWheel = (e: WheelEvent<HTMLDivElement>) => {
    if (e.deltaY !== 0 && Math.abs(e.deltaX) < Math.abs(e.deltaY)) {
      e.currentTarget.scrollLeft += e.deltaY;
    }
  };

  const onDrop = (e: DragEvent<HTMLDivElement>, targetIndex: number) => {
    const id = e.dataTransfer.getData(DRAG_TYPE);
    const from = tabs.findIndex((t) => t.id === id);
    if (from === -1) return;
    e.preventDefault();
    const box = e.currentTarget.getBoundingClientRect();
    const after = e.clientX > box.left + box.width / 2;
    let to = targetIndex + (after ? 1 : 0);
    if (from < to) to -= 1; // index among the other Tabs
    if (to !== from) onMove(id, to);
  };

  return (
    <div
      className="z-no-scrollbar flex h-9 shrink-0 items-center gap-1 overflow-x-auto overflow-y-hidden bg-chrome px-2"
      onWheel={onWheel}
    >
      {tabs.map((tab, index) => (
        <div
          key={tab.id}
          ref={tab.active ? activeRef : undefined}
          role="tab"
          aria-selected={tab.active}
          title={tab.title}
          draggable={editing !== tab.id}
          onClick={() => onActivate(tab.id)}
          onMouseDown={(e) => {
            if (e.button === 1) e.preventDefault(); // no autoscroll
          }}
          onAuxClick={(e) => {
            if (e.button === 1) {
              e.preventDefault();
              onClose(tab.id);
            }
          }}
          onDoubleClick={() => setEditing(tab.id)}
          onDragStart={(e) => {
            e.dataTransfer.setData(DRAG_TYPE, tab.id);
            e.dataTransfer.effectAllowed = "move";
          }}
          onDragOver={(e) => {
            if (e.dataTransfer.types.includes(DRAG_TYPE)) {
              e.preventDefault();
              e.dataTransfer.dropEffect = "move";
            }
          }}
          onDrop={(e) => onDrop(e, index)}
          className={
            "group flex h-7 min-w-[120px] max-w-[200px] flex-[0_1_200px] cursor-default select-none items-center gap-1 rounded-tab pl-2.5 pr-1 " +
            (tab.active
              ? "bg-surface text-text shadow-float"
              : "text-muted hover:text-text")
          }
        >
          {editing === tab.id ? (
            <RenameInput
              initial={tab.title}
              onDone={(name) => {
                setEditing(null);
                if (name !== null) onRename(tab.id, name);
              }}
            />
          ) : (
            <span className="min-w-0 flex-1 truncate">{tab.title}</span>
          )}
          <button
            type="button"
            aria-label={`Close ${tab.title}`}
            tabIndex={-1}
            onClick={(e) => {
              e.stopPropagation();
              onClose(tab.id);
            }}
            onDoubleClick={(e) => e.stopPropagation()}
            className={
              "flex size-5 shrink-0 items-center justify-center rounded-[4px] text-faint hover:bg-chrome hover:text-text " +
              (tab.active ? "" : "invisible group-hover:visible")
            }
          >
            <svg width="8" height="8" viewBox="0 0 8 8" aria-hidden="true">
              <path
                d="M1 1l6 6M7 1L1 7"
                stroke="currentColor"
                strokeWidth="1.3"
                strokeLinecap="round"
              />
            </svg>
          </button>
        </div>
      ))}
      <button
        type="button"
        aria-label="New Tab"
        title="New Tab"
        tabIndex={-1}
        onClick={onNew}
        className="flex size-7 shrink-0 items-center justify-center rounded-tab text-muted hover:bg-surface hover:text-text"
      >
        <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
          <path
            d="M5 1v8M1 5h8"
            stroke="currentColor"
            strokeWidth="1.3"
            strokeLinecap="round"
          />
        </svg>
      </button>
    </div>
  );
}

function RenameInput({
  initial,
  onDone,
}: {
  initial: string;
  /** The new name, or null when cancelled. */
  onDone(name: string | null): void;
}) {
  const [value, setValue] = useState(initial);
  const done = useRef(false);
  const finish = (name: string | null) => {
    if (done.current) return;
    done.current = true;
    onDone(name);
  };
  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    e.stopPropagation(); // keep app shortcuts out of the field
    if (e.key === "Enter") finish(value);
    else if (e.key === "Escape") finish(null);
  };
  return (
    <input
      autoFocus
      value={value}
      onChange={(e) => setValue(e.target.value)}
      onKeyDown={onKeyDown}
      onBlur={() => finish(value)}
      onFocus={(e) => e.currentTarget.select()}
      onClick={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
      className="min-w-0 flex-1 bg-transparent text-text outline-none"
      spellCheck={false}
    />
  );
}
