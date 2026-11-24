import { useCallback, useRef, useState } from "react";
import type { Change, ChangeStatus } from "../../git/api";
import { joinRel } from "../../git/paths";
import type { DiffTarget } from "../../model/types";
import { Menu, type MenuItem } from "../Menu";
import { SectionHeading } from "../SectionHeading";

/** Rows shown before "and N more files" (spec 4.3). */
export const MAX_ROWS = 500;

const LETTER: Record<ChangeStatus, string> = {
  modified: "M",
  added: "A",
  deleted: "D",
  renamed: "R",
  conflicted: "U",
};

const NAME: Record<ChangeStatus, string> = {
  modified: "Modified",
  added: "Added",
  deleted: "Deleted",
  renamed: "Renamed",
  conflicted: "Conflicted",
};

export interface ChangesListProps {
  folder: string;
  /** Undefined before the first answer. */
  changes: Change[] | undefined;
  onOpenDiff(target: DiffTarget): void;
  /** Absolute paths. */
  onOpenFile(path: string): void;
  onCopyPath(path: string): void;
}

function split(path: string): { name: string; parent: string } {
  const i = path.lastIndexOf("/");
  return i < 0
    ? { name: path, parent: "" }
    : { name: path.slice(i + 1), parent: path.slice(0, i) };
}

function target(folder: string, c: Change): DiffTarget {
  return c.oldPath
    ? { folder, path: c.path, oldPath: c.oldPath, status: c.status }
    : { folder, path: c.path, status: c.status };
}

/**
 * CHANGES: one row per changed file against the last commit, sorted by path.
 * A row opens its diff; its menu opens the file or copies its path.
 */
export function ChangesList({
  folder,
  changes,
  onOpenDiff,
  onOpenFile,
  onCopyPath,
}: ChangesListProps) {
  const [menu, setMenu] = useState<{
    x: number;
    y: number;
    items: MenuItem[];
  } | null>(null);
  const returnFocus = useRef<HTMLElement | null>(null);

  const closeMenu = useCallback(() => {
    setMenu(null);
    returnFocus.current?.focus({ preventScroll: true });
    returnFocus.current = null;
  }, []);

  const sorted = changes
    ? [...changes].sort((a, b) =>
        a.path < b.path ? -1 : a.path > b.path ? 1 : 0,
      )
    : undefined;
  const shown = sorted?.slice(0, MAX_ROWS) ?? [];
  const more = (sorted?.length ?? 0) - shown.length;

  const showMenu = (c: Change, x: number, y: number, from: HTMLElement) => {
    const abs = joinRel(folder, c.path);
    const items: MenuItem[] = [
      ...(c.status === "deleted"
        ? []
        : [{ label: "Open file", onSelect: () => onOpenFile(abs) }]),
      { label: "Copy path", onSelect: () => onCopyPath(abs) },
    ];
    returnFocus.current = from;
    setMenu({ x, y, items });
  };

  return (
    <section aria-label="Changes" className="flex min-h-0 flex-1 flex-col">
      <SectionHeading label="CHANGES">
        {sorted && sorted.length > 0 && (
          <span className="pr-1.5 font-normal tracking-normal tabular-nums">
            {sorted.length}
          </span>
        )}
      </SectionHeading>
      {sorted?.length === 0 && (
        <div className="px-2 py-1 text-ui text-faint">No changes</div>
      )}
      {shown.length > 0 && (
        <div className="min-h-0 overflow-y-auto pb-1">
          <ul aria-label="Changed files" className="m-0 list-none p-0">
            {shown.map((c, i) => {
              const { name, parent } = split(c.path);
              return (
                <li
                  key={c.path}
                  data-path={c.path}
                  title={c.oldPath ? `${c.oldPath} → ${c.path}` : c.path}
                  tabIndex={i === 0 ? 0 : -1}
                  onClick={() => onOpenDiff(target(folder, c))}
                  onKeyDown={(e) => {
                    const li = e.currentTarget;
                    if (e.key === "Enter" || e.key === " ") {
                      onOpenDiff(target(folder, c));
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
                  onContextMenu={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    const li = e.currentTarget;
                    // The context-menu key / Shift+F10 has no pointer position.
                    if (e.clientX === 0 && e.clientY === 0) {
                      const box = li.getBoundingClientRect();
                      showMenu(c, box.left, box.bottom, li);
                    } else {
                      showMenu(c, e.clientX, e.clientY, li);
                    }
                  }}
                  className="flex h-[30px] cursor-default items-center gap-2 rounded-[6px] px-2 whitespace-nowrap outline-none hover:bg-row-hover focus-visible:shadow-[inset_0_0_0_1px_var(--z-accent-soft)]"
                >
                  <span className="sr-only">{NAME[c.status]}</span>
                  <span
                    aria-hidden="true"
                    className={
                      "w-3.5 shrink-0 text-center text-ui-sm font-semibold " +
                      (c.status === "conflicted" ? "text-danger" : "text-muted")
                    }
                  >
                    {LETTER[c.status]}
                  </span>
                  <span className="min-w-0 shrink truncate text-text">
                    {name}
                  </span>
                  {parent && (
                    // Truncated from the left: the nearest folders stay visible.
                    <span className="ml-auto min-w-0 flex-1 truncate text-right text-ui-sm text-faint [direction:rtl]">
                      <bdi>{parent}</bdi>
                    </span>
                  )}
                </li>
              );
            })}
          </ul>
          {more > 0 && (
            <div className="px-2 py-1 text-ui-sm text-faint">{`and ${more} more files`}</div>
          )}
        </div>
      )}
      {menu && (
        <Menu
          label="Change"
          x={menu.x}
          y={menu.y}
          items={menu.items}
          onDismiss={closeMenu}
        />
      )}
    </section>
  );
}
