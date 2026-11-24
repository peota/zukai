import { useRef, useState } from "react";
import type { FolderGit } from "../../git/api";
import { Icon } from "../icons";
import { Menu, type MenuItem } from "../Menu";

export interface GitFolder {
  path: string;
  name: string;
}

/** The 5px amber dot (`--z-warn`): this repo has uncommitted changes. */
export function DirtyDot() {
  return (
    <span
      role="img"
      aria-label="Uncommitted changes"
      title="Uncommitted changes"
      className="size-[5px] shrink-0 rounded-full bg-warn"
    />
  );
}

/**
 * The Git view's folder: plain text with one library folder, else a button
 * with a menu of them all, each marked dirty or "not synced".
 */
export function FolderPicker({
  folders,
  selected,
  statusOf,
  onSelect,
}: {
  folders: GitFolder[];
  selected: string;
  statusOf(folder: string): FolderGit | undefined;
  onSelect(folder: string): void;
}) {
  const [open, setOpen] = useState<{ x: number; y: number } | null>(null);
  const button = useRef<HTMLButtonElement>(null);
  const name = folders.find((f) => f.path === selected)?.name ?? selected;
  const label =
    "min-w-0 truncate text-ui-lg font-semibold tracking-[-0.005em] text-text";

  if (folders.length < 2) {
    return <span className={"px-2 " + label}>{name}</span>;
  }

  const items: MenuItem[] = folders.map((f) => {
    const s = statusOf(f.path);
    return {
      label: f.name,
      checked: f.path === selected,
      trailing: s?.kind === "repo" && s.dirty ? <DirtyDot /> : undefined,
      hint: s && s.kind !== "repo" ? "not synced" : undefined,
      onSelect: () => onSelect(f.path),
    };
  });

  return (
    <>
      <button
        ref={button}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open !== null}
        data-z-git-folder=""
        onClick={() => {
          if (open) return setOpen(null);
          const b = button.current?.getBoundingClientRect();
          setOpen({ x: b?.left ?? 0, y: (b?.bottom ?? 0) + 4 });
        }}
        className="flex h-[30px] min-w-0 items-center gap-1 rounded-[6px] px-2 hover:bg-row-hover"
      >
        <span className={label}>{name}</span>
        <Icon name="chevronDown" size={14} className="text-faint" />
      </button>
      {open && (
        <Menu
          label="Folder"
          x={open.x}
          y={open.y}
          items={items}
          ignoreSelector="[data-z-git-folder]"
          onDismiss={() => {
            setOpen(null);
            button.current?.focus({ preventScroll: true });
          }}
        />
      )}
    </>
  );
}
