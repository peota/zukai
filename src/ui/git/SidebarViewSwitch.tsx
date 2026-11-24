import { useRef, type KeyboardEvent } from "react";
import type { SidebarView } from "../../model/types";
import { Icon, type IconName } from "../icons";
import { DirtyDot } from "./FolderPicker";

const SEGMENTS: { id: SidebarView; label: string; icon: IconName }[] = [
  { id: "files", label: "Files", icon: "folder" },
  { id: "git", label: "Git", icon: "gitBranch" },
];

/**
 * The Files | Git switch at the top of the sidebar (spec 4.1): a segmented
 * control. The Git segment carries the amber dot while any repo folder has
 * uncommitted changes.
 */
export function SidebarViewSwitch({
  view,
  dirty,
  onView,
}: {
  view: SidebarView;
  dirty: boolean;
  onView(v: SidebarView): void;
}) {
  const refs = useRef(new Map<SidebarView, HTMLButtonElement>());

  // A radio group: the arrows move the choice and the focus with it.
  const onKeyDown = (e: KeyboardEvent<HTMLButtonElement>) => {
    const step = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
    if (step === 0) return;
    e.preventDefault();
    const at = SEGMENTS.findIndex((s) => s.id === view);
    const next = SEGMENTS[(at + step + SEGMENTS.length) % SEGMENTS.length].id;
    refs.current.get(next)?.focus();
    onView(next);
  };

  return (
    <div
      role="radiogroup"
      aria-label="Sidebar view"
      className="mx-0.5 mb-1.5 flex shrink-0 gap-px rounded-[7px] bg-row-hover p-0.5"
    >
      {SEGMENTS.map((s) => {
        const on = view === s.id;
        return (
          <button
            key={s.id}
            ref={(el) => {
              if (el) refs.current.set(s.id, el);
              else refs.current.delete(s.id);
            }}
            type="button"
            role="radio"
            aria-checked={on}
            tabIndex={on ? 0 : -1}
            onClick={() => onView(s.id)}
            onKeyDown={onKeyDown}
            className={
              "flex h-[26px] min-w-0 flex-1 items-center justify-center gap-1.5 rounded-[5px] px-2 " +
              (on
                ? "bg-surface text-text shadow-tab"
                : "text-muted hover:text-text")
            }
          >
            <Icon name={s.icon} className={on ? "text-muted" : "text-faint"} />
            <span className="truncate">{s.label}</span>
            {s.id === "git" && dirty && <DirtyDot />}
          </button>
        );
      })}
    </div>
  );
}
