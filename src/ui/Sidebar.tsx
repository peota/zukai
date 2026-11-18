import { useCallback, useRef, useState } from "react";
import type { KeyboardEvent, PointerEvent } from "react";
import type { Entry } from "../library/api";
import type { Row, TreeState } from "../library/tree";
import { detectPlatform } from "../app/shortcuts";
import { PlusIcon, SearchIcon } from "./icons";
import { Inbox, type InboxItem } from "./Inbox";
import { LibraryTree, type PendingTrash } from "./LibraryTree";
import { Menu, type MenuItem } from "./Menu";
import { entryBlocked } from "./libraryEntries";
import { useFolderDrag } from "./useFolderDrag";

export type { InboxItem } from "./Inbox";

export type NewItem = "folder" | "note" | "text" | "canvas";

export const SIDEBAR_MIN_WIDTH = 180;
export const SIDEBAR_MAX_WIDTH = 480;
/** Keyboard step of the width handle. */
const WIDTH_STEP = 16;

export function clampWidth(w: number): number {
  return Math.round(
    Math.min(SIDEBAR_MAX_WIDTH, Math.max(SIDEBAR_MIN_WIDTH, w)),
  );
}

export interface SidebarProps {
  open: boolean;
  width: number;
  /** A new width, already clamped to 180–480 px. */
  onWidth(w: number): void;
  root: string | null;
  /** False when the root is missing or unreachable (spec 5.1). */
  available: boolean;
  tree: TreeState;
  /** What the tree shows: `visibleRows`, or `filterRows` while searching. */
  rows: Row[];
  /** The rows are search results. */
  searching: boolean;
  search: { query: string; results: Entry[]; ready: boolean };
  onSearch(q: string): void;
  inbox: InboxItem[];
  /** The active Tab's File path, highlighted in the tree. */
  activePath: string | null;
  /** The active Tab's id, highlighted in the Inbox. */
  activeId: string | null;
  onOpen(entry: Entry): void;
  onToggle(dir: string): void;
  /** May resolve to the new item's path: its rename field then opens. */
  onCreate(parent: string, what: NewItem): void | Promise<string | null>;
  /** Resolves to an error message to show inline, or null on success. */
  onRename(path: string, name: string): Promise<string | null>;
  onMove(path: string, destDir: string): void;
  /** `itemCount` is set when the user confirmed a non-empty folder. */
  onTrash(path: string, itemCount?: number): void;
  onReveal(path: string): void;
  onCopyPath(path: string): void;
  onChooseRoot(): void;
  onRecreateRoot(): void;
  onInboxActivate(id: string): void;
  /** `destDir` null: Move to Library… through the save dialog. */
  onInboxMove(id: string, destDir: string | null): void;
  /** Esc: give the keyboard back to the editor. */
  onLeave(): void;
}

function revealLabel(): string {
  const p = detectPlatform();
  if (p === "windows") return "Show in Explorer";
  return p === "mac" ? "Show in Finder" : "Show in File Manager";
}

/** Focuses the Library tree (Mod+Shift+E); false when the sidebar is closed. */
export function focusSidebar(): boolean {
  const el =
    document.querySelector<HTMLElement>("[data-z-library-tree]") ??
    document.querySelector<HTMLElement>(
      "[data-z-sidebar] input, [data-z-sidebar] button",
    );
  if (!el) return false;
  el.focus();
  return true;
}

interface OpenMenu {
  label: string;
  x: number;
  y: number;
  items: MenuItem[];
  ignore?: string;
}

/** The Library sidebar, layout A (spec 5.2). */
export function Sidebar(props: SidebarProps) {
  if (!props.open) return null;
  return <SidebarPanel {...props} />;
}

function SidebarPanel({
  width,
  onWidth,
  root,
  available,
  tree,
  rows,
  searching,
  search,
  onSearch,
  inbox,
  activePath,
  activeId,
  onOpen,
  onToggle,
  onCreate,
  onRename,
  onMove,
  onTrash,
  onReveal,
  onCopyPath,
  onChooseRoot,
  onRecreateRoot,
  onInboxActivate,
  onInboxMove,
  onLeave,
}: SidebarProps) {
  const treeRef = useRef<HTMLDivElement>(null);
  const plusRef = useRef<HTMLButtonElement>(null);
  const [cursor, setCursor] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [pendingTrash, setPendingTrash] = useState<PendingTrash | null>(null);
  const [menu, setMenu] = useState<OpenMenu | null>(null);
  const closeMenu = useCallback(() => setMenu(null), []);

  const drag = useFolderDrag({
    treeRef,
    rows,
    root: available ? root : null,
    onDrop: (source, dest) => {
      if (source.kind === "entry") onMove(source.entry.path, dest);
      else onInboxMove(source.id, dest);
    },
  });

  const create = async (parent: string, what: NewItem) => {
    const made = await onCreate(parent, what);
    if (made) {
      setCursor(made);
      setEditing(made);
    }
  };

  const requestTrash = (e: Entry) => {
    if (entryBlocked(e)) return;
    if (!e.isDir) return onTrash(e.path);
    const kids = tree.children[e.path];
    if (Array.isArray(kids) && kids.length === 0) return onTrash(e.path);
    setPendingTrash({
      path: e.path,
      name: e.name,
      count: Array.isArray(kids) ? kids.length : null,
    });
  };

  const newItems = (parent: string): MenuItem[] => [
    { label: "New folder", onSelect: () => void create(parent, "folder") },
    { label: "New note", onSelect: () => void create(parent, "note") },
    { label: "New text file", onSelect: () => void create(parent, "text") },
    { label: "New canvas", onSelect: () => void create(parent, "canvas") },
  ];

  const rootItems = (r: string): MenuItem[] => [
    ...newItems(r),
    { label: revealLabel(), separated: true, onSelect: () => onReveal(r) },
    { label: "Choose Library folder…", onSelect: onChooseRoot },
  ];

  const entryItems = (e: Entry): MenuItem[] => {
    const blocked = entryBlocked(e);
    const off = blocked !== null;
    const rename: MenuItem = {
      label: "Rename",
      disabled: off,
      onSelect: () => setEditing(e.path),
    };
    const del: MenuItem = {
      label: "Delete",
      disabled: off,
      onSelect: () => requestTrash(e),
    };
    const tail: MenuItem[] = [
      {
        label: revealLabel(),
        separated: true,
        onSelect: () => onReveal(e.path),
      },
      { label: "Copy path", onSelect: () => onCopyPath(e.path) },
    ];
    if (e.isDir) {
      const news = newItems(e.path).map((m) => ({ ...m, disabled: off }));
      if (blocked) news[0] = { ...news[0], reason: blocked };
      return [...news, { ...rename, separated: true }, del, ...tail];
    }
    return [
      {
        label: "Open",
        disabled: off,
        reason: blocked ?? undefined,
        onSelect: () => onOpen(e),
      },
      rename,
      del,
      ...tail,
    ];
  };

  const showTreeMenu = (entry: Entry | null, x: number, y: number) => {
    if (entry) setMenu({ label: entry.name, x, y, items: entryItems(entry) });
    else if (root) setMenu({ label: "Library", x, y, items: rootItems(root) });
  };

  const togglePlusMenu = () => {
    if (menu?.ignore) return setMenu(null);
    const b = plusRef.current?.getBoundingClientRect();
    const items: MenuItem[] =
      root && available
        ? rootItems(root)
        : [{ label: "Choose Library folder…", onSelect: onChooseRoot }];
    setMenu({
      label: "Library",
      x: b?.left ?? 0,
      y: (b?.bottom ?? 0) + 4,
      items,
      ignore: "[data-z-library-plus]",
    });
  };

  const showInboxMenu = (id: string, x: number, y: number) =>
    setMenu({
      label: "Scratchpad",
      x,
      y,
      items: [
        {
          label: "Move to Library…",
          disabled: !available,
          reason: available ? undefined : "The Library folder isn't available.",
          onSelect: () => onInboxMove(id, null),
        },
      ],
    });

  const onSearchKey = (e: KeyboardEvent<HTMLInputElement>) => {
    e.stopPropagation(); // keep app shortcuts out of the field
    if (e.key === "Escape") {
      e.preventDefault();
      if (search.query !== "") onSearch("");
      else onLeave();
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      treeRef.current?.focus();
    }
  };

  const rootListed = root !== null && Array.isArray(tree.children[root]);
  let status: string | null = null;
  if (searching && !search.ready) status = "Searching…";
  else if (searching && rows.length === 0) status = "No matches";
  else if (!searching && rootListed && rows.length === 0) {
    status = "Nothing here yet. Use + to add a note.";
  }

  return (
    <aside
      aria-label="Library sidebar"
      data-z-sidebar=""
      style={{ width }}
      className="relative flex h-full shrink-0 flex-col border-r border-hairline bg-side px-1.5 pt-2 select-none"
    >
      <label className="mx-0.5 mb-1.5 flex h-7 shrink-0 items-center gap-1.5 rounded-[7px] bg-row-hover px-2 text-faint">
        <SearchIcon />
        <input
          type="search"
          value={search.query}
          placeholder="Search Library"
          aria-label="Search Library"
          spellCheck={false}
          disabled={!available}
          onChange={(e) => onSearch(e.target.value)}
          onKeyDown={onSearchKey}
          className="min-w-0 flex-1 bg-transparent text-text outline-none placeholder:text-faint [&::-webkit-search-cancel-button]:hidden"
        />
      </label>

      <div className="flex shrink-0 items-center px-2 pt-2.5 pb-1 text-[10.5px] tracking-[0.02em] text-faint">
        <span className="flex-1">LIBRARY</span>
        <button
          ref={plusRef}
          type="button"
          aria-label="New in Library"
          title="New in Library"
          data-z-library-plus=""
          onClick={togglePlusMenu}
          className="flex size-5 items-center justify-center rounded-[4px] text-faint hover:bg-row-hover hover:text-text"
        >
          <PlusIcon />
        </button>
      </div>

      {available ? (
        <>
          {status && (
            <div className="shrink-0 px-2 py-1 text-faint">{status}</div>
          )}
          <LibraryTree
            treeRef={treeRef}
            rows={rows}
            searching={searching}
            isOpen={(p) => tree.expanded.has(p)}
            activePath={activePath}
            cursor={cursor}
            onCursor={setCursor}
            editing={editing}
            onEditing={setEditing}
            pendingTrash={pendingTrash}
            onConfirmTrash={() => {
              if (!pendingTrash) return;
              setPendingTrash(null);
              onTrash(pendingTrash.path, pendingTrash.count ?? undefined);
            }}
            onCancelTrash={() => setPendingTrash(null)}
            dropTarget={drag.dropTarget}
            onOpen={onOpen}
            onToggle={onToggle}
            onRename={onRename}
            onRequestTrash={requestTrash}
            onLeave={onLeave}
            onContextMenu={showTreeMenu}
            dragHandlers={(entry) => drag.handlers({ kind: "entry", entry })}
            swallowClick={drag.swallowClick}
          />
        </>
      ) : (
        <div className="min-h-0 flex-1 px-2 py-1 text-muted">
          <p className="m-0">The Library folder isn't available.</p>
          {root && (
            <p className="m-0 mt-1 text-[11.5px] break-all text-faint">
              {root}
            </p>
          )}
          <div className="mt-3 flex flex-col items-start gap-1.5">
            <button
              type="button"
              onClick={onChooseRoot}
              className="rounded-[5px] bg-bar-btn-primary-bg px-2 py-[3px] text-bar-btn-primary-fg"
            >
              Choose Library folder…
            </button>
            {root && (
              <button
                type="button"
                onClick={onRecreateRoot}
                className="rounded-[5px] px-2 py-[3px] text-muted hover:bg-row-hover hover:text-text"
              >
                Create it again
              </button>
            )}
          </div>
        </div>
      )}

      <Inbox
        items={inbox}
        activeId={activeId}
        onActivate={onInboxActivate}
        onContextMenu={showInboxMenu}
        dragHandlers={(id) => drag.handlers({ kind: "inbox", id })}
        swallowClick={drag.swallowClick}
      />

      <WidthHandle width={width} onWidth={onWidth} />

      {menu && (
        <Menu
          label={menu.label}
          x={menu.x}
          y={menu.y}
          items={menu.items}
          onDismiss={closeMenu}
          ignoreSelector={menu.ignore}
        />
      )}
    </aside>
  );
}

/** The drag handle on the sidebar's right edge (180–480 px). */
function WidthHandle({
  width,
  onWidth,
}: {
  width: number;
  onWidth(w: number): void;
}) {
  const press = useRef<{
    pointerId: number;
    startX: number;
    startWidth: number;
  } | null>(null);

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    e.preventDefault();
    press.current = {
      pointerId: e.pointerId,
      startX: e.clientX,
      startWidth: width,
    };
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      // No capture: moves over the handle still resize.
    }
  };
  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    const d = press.current;
    if (!d || d.pointerId !== e.pointerId) return;
    if ((e.buttons & 1) === 0) {
      press.current = null; // the release was missed
      return;
    }
    onWidth(clampWidth(d.startWidth + e.clientX - d.startX));
  };
  const end = (e: PointerEvent<HTMLDivElement>) => {
    if (press.current?.pointerId === e.pointerId) press.current = null;
  };

  return (
    <div
      role="separator"
      aria-label="Resize sidebar"
      aria-orientation="vertical"
      aria-valuemin={SIDEBAR_MIN_WIDTH}
      aria-valuemax={SIDEBAR_MAX_WIDTH}
      aria-valuenow={width}
      tabIndex={-1}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={end}
      onPointerCancel={end}
      onKeyDown={(e) => {
        const step =
          e.key === "ArrowRight"
            ? WIDTH_STEP
            : e.key === "ArrowLeft"
              ? -WIDTH_STEP
              : 0;
        if (step === 0) return;
        e.preventDefault();
        onWidth(clampWidth(width + step));
      }}
      className="absolute top-0 -right-[3px] bottom-0 z-10 w-[6px] cursor-col-resize"
    />
  );
}
