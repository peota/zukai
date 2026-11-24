import { useCallback, useMemo, useRef, useState } from "react";
import type { KeyboardEvent, PointerEvent, ReactNode } from "react";
import type { AddedState, Entry } from "../library/api";
import type { Row, TreeState } from "../library/tree";
import { detectPlatform, type Platform } from "../app/shortcuts";
import { formatKeys } from "../app/shortcutList";
import {
  CollapseAllIcon,
  MoreIcon,
  NewCanvasIcon,
  NewFileIcon,
  NewFolderIcon,
  SearchIcon,
} from "./icons";
import { gitCancel, type GitError, type PickedParent } from "../git/api";
import type { GitSyncApi } from "../git/useGitSync";
import { baseName } from "../files/paths";
import type { DiffTarget, SidebarView } from "../model/types";
import { CloneDialog, type CloneForm, type CloneInitial } from "./CloneDialog";
import { DragGhost } from "./DragGhost";
import { GitView } from "./git/GitView";
import { SidebarViewSwitch } from "./git/SidebarViewSwitch";
import { SectionHeading } from "./SectionHeading";
import { fileIcon, Icon } from "./icons";
import { ScratchpadList, type ScratchpadItem } from "./ScratchpadList";
import { Pinned, TabList, type PinnedItem } from "./Pinned";
import { LibraryTree, type PendingTrash, type SelectHow } from "./LibraryTree";
import { Menu, type MenuItem } from "./Menu";
import {
  entryBlocked,
  isUnder,
  parentOf,
  revealLabel,
  sameDir,
} from "./libraryEntries";
import { draggedEntries, useFolderDrag } from "./useFolderDrag";
import {
  SIDEBAR_MAX_WIDTH,
  SIDEBAR_MIN_WIDTH,
  clampSidebarWidth as clampWidth,
} from "../model/session";

export type { ScratchpadItem } from "./ScratchpadList";
export type { PinnedItem } from "./Pinned";

/** "file" is an empty "Untitled" with no extension, named on creation. */
export type NewItem = "folder" | "file" | "canvas";

export { SIDEBAR_MAX_WIDTH, SIDEBAR_MIN_WIDTH, clampWidth };
/** Keyboard step of the width handle. */
const WIDTH_STEP = 16;

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
  scratchpads: ScratchpadItem[];
  /** The active Tab's File path, highlighted in the tree. */
  activePath: string | null;
  /** The File last revealed in the tree: its row scrolls into view. */
  revealed?: { path: string } | null;
  /** The active Tab's id, highlighted in the Pinned and Scratchpads lists. */
  activeId: string | null;
  onOpen(entry: Entry): void;
  onToggle(dir: string): void;
  /** Closes every expanded folder. */
  onCollapseAll(): void;
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
  onScratchpadActivate(id: string): void;
  /** `destDir` null: Move to Library… through the save dialog. */
  onScratchpadMove(id: string, destDir: string | null): void;
  /** Pinned Tabs, open ones first. */
  pinned: PinnedItem[];
  /** Activates an open pinned Tab, or reopens a closed one. */
  onPinnedOpen(id: string): void;
  /** Files last viewed, newest first. */
  recent: PinnedItem[];
  /** Activates an open recent Tab, or reopens a closed one. */
  onRecentOpen(id: string): void;
  onUnpin(id: string): void;
  /** Esc: give the keyboard back to the editor. */
  onLeave(): void;
  /** The folders added beside the Library, in the order added. */
  added: AddedState[];
  /** Add folder…: the OS folder picker, run by Rust. */
  onAddFolder(): void;
  /** Locate…: picks the folder that replaces a missing added one. */
  onLocateFolder(path: string): void;
  /** Remove from sidebar: forgets the folder; nothing on disk changes. */
  onRemoveFolder(path: string): void;
  /** Open in terminal: a new terminal in this folder. */
  onOpenTerminal(path: string): void;
  /** Git sync (spec 4): nothing git shows while `git.enabled` is false. */
  git: GitSyncApi;
  /** Files or Git, below the switch; Files whenever git sync is off. */
  view: SidebarView;
  onView(v: SidebarView): void;
  /**
   * The folder the Git view shows: the one last picked, else the active
   * tab's library folder; null keeps what shows (first: the Library root).
   */
  gitFolder: string | null;
  /** A folder picked in the Git view. */
  onGitFolder(folder: string): void;
  /** Open tabs under `folder` with edits not yet on disk. */
  unsavedUnder(folder: string): number;
  /** Save all, from the commit box's unsaved-files line. */
  onSaveAll(): void;
  /** A change in the Git view: its diff tab. */
  onOpenDiff(target: DiffTarget): void;
  /** Open file, from a change's menu (an absolute path). */
  onOpenFile(path: string): void;
  /**
   * Add folder from git… (spec 4.2): runs the clone; resolves to its error,
   * or null once the new folder is in the roots. Never rejects.
   */
  onCloneFolder(req: CloneForm, opId: string): Promise<GitError | null>;
  /** Decides the Windows-only name rule and the "Show in …" label. */
  platform?: Platform;
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

/** The keyboard cursor; `index` finds a neighbour when its row goes away. */
interface Cursor {
  path: string;
  index: number;
}

/** Rows selected together, and where a Shift range starts from. */
interface Selection {
  paths: ReadonlySet<string>;
  anchor: string | null;
}
const NO_SELECTION: Selection = { paths: new Set(), anchor: null };

/** Drops entries inside another one listed: moving or trashing it takes them. */
function topmost(entries: Entry[]): Entry[] {
  return entries.filter(
    (e) => !entries.some((o) => o !== e && isUnder(e.path, o.path)),
  );
}

/** A clone running: its placeholder row's name and the id that cancels it. */
interface Cloning {
  opId: string;
  name: string;
}

interface CloneProps {
  cloning: Cloning | null;
  onStartClone(): void;
}

/** The Library sidebar, layout A (spec 5.2). */
export function Sidebar(props: SidebarProps) {
  // Held here, not in the panel, so a clone that fails while the sidebar is
  // closed still brings its dialog back.
  const { onCloneFolder } = props;
  const [dialog, setDialog] = useState<CloneInitial | null>(null);
  const [cloning, setCloning] = useState<Cloning | null>(null);

  const clone = (
    req: CloneForm,
    shown: { name: string; parent: PickedParent },
  ) => {
    const opId = crypto.randomUUID();
    setDialog(null);
    setCloning({ opId, name: shown.name });
    void onCloneFolder(req, opId).then((error) => {
      setCloning(null);
      if (error && error.kind !== "cancelled") {
        const { url, name, useAsLibrary } = req;
        setDialog({ url, name, useAsLibrary, parent: shown.parent, error });
      }
    });
  };

  return (
    <>
      {props.open && (
        <SidebarPanel
          {...props}
          cloning={cloning}
          onStartClone={() => setDialog(EMPTY_CLONE)}
        />
      )}
      {dialog && (
        <CloneDialog
          initial={dialog === EMPTY_CLONE ? undefined : dialog}
          onClone={clone}
          onCancel={() => setDialog(null)}
        />
      )}
    </>
  );
}

/** The dialog opened fresh from the menu. */
const EMPTY_CLONE: CloneInitial = {
  url: "",
  name: "",
  useAsLibrary: false,
  parent: null,
  error: null,
};

function SidebarPanel({
  width,
  onWidth,
  root,
  available,
  tree,
  rows: allRows,
  searching,
  search,
  onSearch,
  scratchpads,
  activePath,
  revealed = null,
  activeId,
  onOpen,
  onToggle,
  onCollapseAll,
  onCreate,
  onRename,
  onMove,
  onTrash,
  onReveal,
  onCopyPath,
  onChooseRoot,
  onRecreateRoot,
  onScratchpadActivate,
  onScratchpadMove,
  pinned,
  onPinnedOpen,
  recent,
  onRecentOpen,
  onUnpin,
  onLeave,
  added,
  onAddFolder,
  onLocateFolder,
  onRemoveFolder,
  onOpenTerminal,
  git,
  view,
  onView,
  gitFolder,
  onGitFolder,
  unsavedUnder,
  onSaveAll,
  onOpenDiff,
  onOpenFile,
  cloning,
  onStartClone,
  platform: platformProp,
}: SidebarProps & CloneProps) {
  // With the Library offline its rows are stale: only the added folders show.
  const rows = useMemo(() => {
    if (available) return allRows;
    const first = allRows.findIndex((r) => r.heading !== undefined);
    return first < 0 ? [] : allRows.slice(first);
  }, [allRows, available]);
  const platform = platformProp ?? detectPlatform();
  const windows = platform === "windows";
  const blockedReason = (e: Entry) => entryBlocked(e, windows);
  const treeRef = useRef<HTMLDivElement>(null);
  const moreRef = useRef<HTMLButtonElement>(null);
  const [cursorState, setCursorState] = useState<Cursor | null>(null);
  // `rows` is the listing the edit started on (null: a created item, waiting
  // for the next listing); an item not in it gets one more listing to show.
  const [editingState, setEditingState] = useState<{
    path: string;
    rows: Row[] | null;
    /** A File just created (and opened): Enter goes on to its editor. */
    newFile?: boolean;
  } | null>(null);
  const [pendingState, setPendingTrash] = useState<PendingTrash | null>(null);
  const [sel, setSel] = useState<Selection>(NO_SELECTION);
  const [menu, setMenu] = useState<OpenMenu | null>(null);
  const returnFocus = useRef<HTMLElement | null>(null);
  const closeMenu = useCallback(() => {
    setMenu(null);
    const el = returnFocus.current;
    returnFocus.current = null;
    el?.focus({ preventScroll: true });
  }, []);

  const indexOf = (path: string) =>
    rows.findIndex((r) => r.entry.path === path);

  // A new listing drops a delete question or a rename whose row is gone (a
  // created item gets this one listing to appear), so they never come back
  // if the path does later.
  const [seenRows, setSeenRows] = useState(rows);
  if (rows !== seenRows) {
    setSeenRows(rows);
    if (pendingState && indexOf(pendingState.path) < 0) setPendingTrash(null);
    // Rows that went away (trashed, moved, hidden) leave the selection.
    if (sel.paths.size > 0) {
      const shown = new Set(rows.map((r) => r.entry.path));
      const kept = [...sel.paths].filter((p) => shown.has(p));
      if (kept.length !== sel.paths.size) {
        setSel({ paths: new Set(kept), anchor: sel.anchor });
      }
    }
    if (
      editingState &&
      editingState.rows !== rows &&
      indexOf(editingState.path) < 0
    ) {
      setEditingState(null);
    }
  }

  // Also derived each render, so rows that went away (renamed, moved,
  // trashed) never show stale state, even for the render above.
  let cursorIndex = cursorState ? indexOf(cursorState.path) : -1;
  if (cursorState && cursorIndex < 0 && cursorState.index >= 0) {
    cursorIndex = Math.min(cursorState.index, rows.length - 1);
  }
  const cursor = cursorIndex >= 0 ? rows[cursorIndex].entry.path : null;
  const setCursor = (path: string | null) =>
    setCursorState(path === null ? null : { path, index: indexOf(path) });
  const editing =
    editingState &&
    (editingState.rows === null ||
      editingState.rows === rows ||
      indexOf(editingState.path) >= 0)
      ? editingState.path
      : null;
  const setEditing = (path: string | null) =>
    setEditingState(path === null ? null : { path, rows });
  const pendingTrash =
    pendingState && indexOf(pendingState.path) >= 0 ? pendingState : null;

  /** A row that can join a selection: not a heading, not blocked. */
  const selectable = (r: Row | undefined): r is Row =>
    r !== undefined &&
    r.heading === undefined &&
    blockedReason(r.entry) === null;
  // In row order, and only rows still shown, even for the render above.
  const selection = useMemo(
    () =>
      sel.paths.size === 0
        ? []
        : rows.filter((r) => sel.paths.has(r.entry.path)).map((r) => r.entry),
    [rows, sel.paths],
  );
  const selectedSet = useMemo(
    () => new Set(selection.map((e) => e.path)),
    [selection],
  );
  const clearSelection = () => {
    if (sel.paths.size > 0 || sel.anchor !== null) setSel(NO_SELECTION);
  };

  const select = (path: string, how: SelectHow) => {
    setCursor(path);
    if (how === "only") return setSel({ paths: new Set(), anchor: path });
    if (how === "all") {
      return setSel({
        paths: new Set(rows.filter(selectable).map((r) => r.entry.path)),
        anchor: sel.anchor ?? path,
      });
    }
    if (how === "toggle") {
      // The first Mod+click adds to the row the cursor is already on.
      const paths = new Set(
        selection.length > 0
          ? selection.map((e) => e.path)
          : cursor !== null && selectable(rows[indexOf(cursor)])
            ? [cursor]
            : [],
      );
      if (paths.has(path)) paths.delete(path);
      else if (selectable(rows[indexOf(path)])) paths.add(path);
      return setSel({ paths, anchor: path });
    }
    // A range runs from the anchor (else the cursor) to `path`.
    const from = [sel.anchor, cursor]
      .map((p) => (p === null ? -1 : indexOf(p)))
      .find((i) => i >= 0);
    const to = indexOf(path);
    if (from === undefined || to < 0) {
      return setSel({ paths: new Set(), anchor: path });
    }
    const [a, b] = from <= to ? [from, to] : [to, from];
    const paths = new Set(
      rows
        .slice(a, b + 1)
        .filter(selectable)
        .map((r) => r.entry.path),
    );
    setSel({ paths, anchor: rows[from].entry.path });
  };

  const openMenu = (m: OpenMenu, from: HTMLElement | null) => {
    returnFocus.current = from;
    setMenu(m);
  };

  const addedOf = (path: string) => added.find((a) => a.path === path);
  const roots = useMemo(
    () => [...(root === null ? [] : [root]), ...added.map((a) => a.path)],
    [root, added],
  );

  const drag = useFolderDrag({
    treeRef,
    rows,
    root: available ? root : null,
    roots,
    blocked: (e) => blockedReason(e) !== null,
    fixed: (e) => addedOf(e.path) !== undefined,
    onDrop: (source, dest) => {
      if (source.kind !== "entry") return onScratchpadMove(source.id, dest);
      for (const e of draggedEntries(source)) {
        if (!sameDir(dest, parentOf(e.path))) onMove(e.path, dest);
      }
      if (source.group) clearSelection();
    },
  });

  /** The paths a drag in progress carries: their rows dim under it. */
  const dragSource = drag.source;
  const dragged = useMemo(
    () =>
      new Set(
        dragSource?.kind === "entry"
          ? draggedEntries(dragSource).map((e) => e.path)
          : [],
      ),
    [dragSource],
  );

  /** The ghost's face: the grabbed row's icon and name, and a count. */
  const ghostFace = (() => {
    const s = drag.ghost?.source;
    if (!s) return null;
    if (s.kind === "scratchpad") {
      const item = scratchpads.find((i) => i.id === s.id);
      return {
        name: item?.title ?? "",
        icon:
          item?.kind === "canvas"
            ? ("canvas" as const)
            : ("scratchpad" as const),
        count: 1,
      };
    }
    const e = s.entry;
    return {
      name: e.name,
      icon: e.isDir ? ("folder" as const) : fileIcon(e.name),
      count: draggedEntries(s).length,
    };
  })();

  /** A selected row drags the whole selection along. */
  const dragGroup = (entry: Entry): Entry[] | undefined =>
    selection.length > 1 && selectedSet.has(entry.path)
      ? topmost(selection)
      : undefined;

  const create = async (parent: string, what: NewItem) => {
    const made = await onCreate(parent, what);
    if (made) {
      setCursorState({ path: made, index: -1 });
      setEditingState({ path: made, rows: null, newFile: what !== "folder" });
    }
  };

  const requestTrash = (e: Entry) => {
    // With several rows selected, Delete takes them all, after asking.
    if (selection.length > 1) {
      const items = topmost(selection);
      const at = selectedSet.has(e.path) ? e.path : items[0].path;
      setPendingTrash({
        path: at,
        name: "",
        count: null,
        paths: items.map((i) => i.path),
      });
      return;
    }
    if (selection.length === 1) e = selection[0];
    if (blockedReason(e)) return;
    if (!e.isDir) return onTrash(e.path);
    // Always ask for a folder: listings hide dotfiles, so one that looks
    // empty may still hold `.git` or `.obsidian`.
    const kids = tree.children[e.path];
    setPendingTrash({
      path: e.path,
      name: e.name,
      count: Array.isArray(kids) && kids.length > 0 ? kids.length : null,
    });
  };

  const newItems = (parent: string): MenuItem[] => [
    { label: "New folder", onSelect: () => void create(parent, "folder") },
    { label: "New file", onSelect: () => void create(parent, "file") },
    { label: "New canvas", onSelect: () => void create(parent, "canvas") },
  ];

  const terminalItem = (path: string): MenuItem => ({
    label: "Open in terminal",
    onSelect: () => onOpenTerminal(path),
  });

  const rootItems = (r: string): MenuItem[] => [
    ...newItems(r),
    {
      label: revealLabel(platform),
      separated: true,
      onSelect: () => onReveal(r),
    },
    terminalItem(r),
    { label: "Choose Library folder…", onSelect: onChooseRoot },
  ];

  const addFolderItem: MenuItem = {
    label: "Add folder…",
    onSelect: onAddFolder,
  };

  /** Add folder from git… (sync spec 4.2): only with git sync on. */
  const cloneItems = (): MenuItem[] => {
    if (!git.enabled) return [];
    const label = "Add folder from git…";
    if (!git.available) {
      return [
        { label, disabled: true, reason: "Install git to sync folders." },
      ];
    }
    // One clone at a time: its placeholder row offers Cancel.
    return [{ label, disabled: cloning !== null, onSelect: onStartClone }];
  };

  /** An added folder heading's menu (its ⋯ button and a right-click). */
  const headingItems = (a: AddedState): MenuItem[] => {
    const remove: MenuItem = {
      label: "Remove from sidebar",
      separated: true,
      onSelect: () => onRemoveFolder(a.path),
    };
    if (!a.available) {
      return [
        { label: "Locate…", onSelect: () => onLocateFolder(a.path) },
        remove,
      ];
    }
    return [
      { label: "New file", onSelect: () => void create(a.path, "file") },
      { label: "New folder", onSelect: () => void create(a.path, "folder") },
      {
        label: revealLabel(platform),
        separated: true,
        onSelect: () => onReveal(a.path),
      },
      terminalItem(a.path),
      remove,
    ];
  };

  const entryItems = (e: Entry): MenuItem[] => {
    const blocked = blockedReason(e);
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
        label: revealLabel(platform),
        separated: true,
        onSelect: () => onReveal(e.path),
      },
      ...(e.isDir ? [{ ...terminalItem(e.path), disabled: off }] : []),
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

  const openSelected = () => {
    for (const e of selection) if (!e.isDir) onOpen(e);
  };

  /** The menu of several selected rows. */
  const selectionItems = (): MenuItem[] => {
    const files = selection.filter((e) => !e.isDir).length;
    return [
      ...(files > 0
        ? [
            {
              label: files === 1 ? "Open" : `Open ${files} files`,
              onSelect: openSelected,
            },
          ]
        : []),
      {
        label: `Delete ${selection.length} items`,
        onSelect: () => requestTrash(selection[0]),
      },
      {
        label: "Copy paths",
        separated: true,
        onSelect: () => onCopyPath(selection.map((e) => e.path).join("\n")),
      },
    ];
  };

  const showTreeMenu = (entry: Entry | null, x: number, y: number) => {
    const from = treeRef.current;
    if (entry && selection.length > 1 && selectedSet.has(entry.path)) {
      const label = `${selection.length} items`;
      return openMenu({ label, x, y, items: selectionItems() }, from);
    }
    clearSelection();
    const heading = entry ? addedOf(entry.path) : undefined;
    if (entry) {
      const items = heading ? headingItems(heading) : entryItems(entry);
      openMenu({ label: entry.name, x, y, items }, from);
    } else {
      // The empty part of the tree: the Library's menu.
      openMenu({ label: "Library", x, y, items: libraryItems() }, from);
    }
  };

  /** The Library's own menu (the tree's empty part): Add folder… last. */
  const libraryItems = (): MenuItem[] => [
    ...(root !== null && available
      ? rootItems(root)
      : [{ label: "Choose Library folder…", onSelect: onChooseRoot }]),
    { ...addFolderItem, separated: true },
    ...cloneItems(),
  ];

  /** The heading's ⋯: the Library's menu less what its buttons do. */
  const toggleMoreMenu = () => {
    if (menu?.ignore) return setMenu(null);
    const b = moreRef.current?.getBoundingClientRect();
    const library = root !== null && available;
    const items: MenuItem[] = [
      ...(library
        ? [
            { label: revealLabel(platform), onSelect: () => onReveal(root) },
            terminalItem(root),
          ]
        : []),
      { label: "Choose Library folder…", onSelect: onChooseRoot },
      { ...addFolderItem, separated: true },
      ...cloneItems(),
    ];
    openMenu(
      {
        label: "Library",
        x: b?.left ?? 0,
        y: (b?.bottom ?? 0) + 4,
        items,
        ignore: "[data-z-library-more]",
      },
      moreRef.current,
    );
  };

  const quickActions: { what: NewItem; label: string; icon: ReactNode }[] = [
    { what: "file", label: "New file", icon: <NewFileIcon /> },
    { what: "folder", label: "New folder", icon: <NewFolderIcon /> },
    { what: "canvas", label: "New canvas", icon: <NewCanvasIcon /> },
  ];

  const showScratchpadMenu = (
    id: string,
    x: number,
    y: number,
    from: HTMLElement,
  ) =>
    openMenu(
      {
        label: "Scratchpad",
        x,
        y,
        items: [
          {
            label: "Move to Library…",
            disabled: !available,
            reason: available
              ? undefined
              : "The Library folder isn't available.",
            onSelect: () => onScratchpadMove(id, null),
          },
        ],
      },
      from,
    );

  const showPinnedMenu = (
    id: string,
    x: number,
    y: number,
    from: HTMLElement,
  ) =>
    openMenu(
      {
        label: "Pinned",
        x,
        y,
        items: [{ label: "Unpin", onSelect: () => onUnpin(id) }],
      },
      from,
    );

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

  const rootList = root === null ? undefined : tree.children[root];
  const libraryEmpty =
    !available || (Array.isArray(rootList) && rootList.length === 0);
  let status: string | null = null;
  if (searching && !search.ready) status = "Searching…";
  else if (searching && rows.length === 0) status = "No matches";
  else if (!searching && Array.isArray(rootList) && rootList.length === 0) {
    status = "Nothing here yet. Use + to add a note.";
  }

  /** With git sync off the sidebar is Files, whatever was last chosen. */
  const showGit = git.enabled && view === "git";
  /** The Git view's folders: the Library root, then the added ones. */
  const gitFolders = [
    ...(root !== null && available ? [{ path: root, name: "Library" }] : []),
    ...added
      .filter((a) => a.available)
      .map((a) => ({ path: a.path, name: baseName(a.path) })),
  ];

  /** Where the cloned folder will appear: after the last added folder. */
  const clonePlaceholder = cloning && (
    <button
      type="button"
      title={`Cloning ${cloning.name}…`}
      onClick={(ev) => {
        const b = ev.currentTarget.getBoundingClientRect();
        openMenu(
          {
            label: `Cloning ${cloning.name}`,
            x: b.left,
            y: b.bottom + 4,
            items: [
              { label: "Cancel", onSelect: () => void gitCancel(cloning.opId) },
            ],
          },
          ev.currentTarget,
        );
      }}
      style={{ paddingLeft: 8 }}
      className="mt-2 flex h-[30px] w-full cursor-default items-center gap-2 rounded-[6px] pr-1 text-left whitespace-nowrap text-muted hover:bg-row-hover"
    >
      <span className="flex w-3.5 shrink-0 justify-center text-faint">
        <Icon
          name="spinner"
          size={14}
          className="animate-spin motion-reduce:animate-none"
        />
      </span>
      <span className="min-w-0 flex-1 truncate">Cloning {cloning.name}…</span>
    </button>
  );

  const libraryTree = (
    <LibraryTree
      treeRef={treeRef}
      rows={rows}
      searching={searching}
      isOpen={(p) => tree.expanded.has(p)}
      activePath={activePath}
      revealed={revealed}
      blocked={blockedReason}
      cursor={cursor}
      onCursor={setCursor}
      selected={selectedSet}
      onSelect={select}
      onOpenSelected={openSelected}
      editing={editing}
      editingNew={editing !== null && editingState?.newFile === true}
      onEditing={setEditing}
      pendingTrash={pendingTrash}
      onConfirmTrash={() => {
        setPendingTrash(null);
        if (!pendingTrash) return;
        if (pendingTrash.paths) {
          clearSelection();
          for (const p of pendingTrash.paths) onTrash(p);
        } else if (pendingTrash.count === null) onTrash(pendingTrash.path);
        else onTrash(pendingTrash.path, pendingTrash.count);
      }}
      onCancelTrash={() => setPendingTrash(null)}
      dropTarget={drag.dropTarget}
      dropCopy={drag.dropCopy}
      dragging={drag.dragging}
      dragged={dragged}
      onOpen={onOpen}
      onToggle={onToggle}
      onRename={onRename}
      onRequestTrash={requestTrash}
      onLeave={onLeave}
      onContextMenu={showTreeMenu}
      dragHandlers={(entry) =>
        drag.handlers({ kind: "entry", entry, group: dragGroup(entry) })
      }
      swallowClick={drag.swallowClick}
      footer={clonePlaceholder}
    />
  );

  return (
    <aside
      aria-label="Library sidebar"
      data-z-sidebar=""
      style={{ width }}
      // Its empty top edge moves the window, like the tab bar beside it;
      // on macOS it also clears room for the traffic lights.
      data-tauri-drag-region=""
      className={
        "group/side relative flex h-full shrink-0 flex-col border-r border-hairline bg-side px-2 text-ui-lg select-none " +
        (platform === "mac" ? "pt-11" : "pt-2.5")
      }
    >
      {git.enabled && (
        <SidebarViewSwitch view={view} dirty={git.anyDirty} onView={onView} />
      )}

      {showGit ? (
        <GitView
          git={git}
          folders={gitFolders}
          defaultFolder={gitFolder}
          onSelectFolder={onGitFolder}
          unsavedUnder={unsavedUnder}
          onSaveAll={onSaveAll}
          onOpenDiff={onOpenDiff}
          onOpenFile={onOpenFile}
          onCopyPath={onCopyPath}
          onAddFromGit={onStartClone}
        />
      ) : (
        <>
          <label className="mx-0.5 mb-1 flex h-8 shrink-0 items-center gap-2 rounded-[8px] border border-hairline bg-sunken px-2.5 text-ui text-faint focus-within:border-accent">
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

          <TabList
            label="Recent"
            items={recent}
            activeId={activeId}
            onOpen={onRecentOpen}
          />

          <Pinned
            items={pinned}
            activeId={activeId}
            onOpen={onPinnedOpen}
            onContextMenu={showPinnedMenu}
          />

          <SectionHeading label="LIBRARY">
            {/* Quiet until the sidebar is pointed at or focused; an empty
            Library keeps them up, since its hint points at them. */}
            <span
              className={
                "flex items-center gap-0.5 " +
                (libraryEmpty
                  ? ""
                  : "opacity-0 transition-opacity duration-150 ease-out group-focus-within/side:opacity-100 group-hover/side:opacity-100 motion-reduce:transition-none")
              }
            >
              {root !== null &&
                available &&
                quickActions.map((a) => (
                  <button
                    key={a.what}
                    type="button"
                    aria-label={a.label}
                    title={a.label}
                    onClick={() => void create(root, a.what)}
                    className="flex size-6 items-center justify-center rounded-[5px] text-faint hover:bg-row-hover hover:text-text"
                  >
                    {a.icon}
                  </button>
                ))}
              {available && (
                <button
                  type="button"
                  aria-label="Collapse all"
                  title={`Collapse all (${formatKeys(["Mod", "Shift", "C"], platform)})`}
                  disabled={tree.expanded.size === 0}
                  onClick={onCollapseAll}
                  className="flex size-6 items-center justify-center rounded-[5px] text-faint hover:bg-row-hover hover:text-text disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-faint"
                >
                  <CollapseAllIcon />
                </button>
              )}
              <button
                ref={moreRef}
                type="button"
                aria-label="Library actions"
                title="Library actions"
                data-z-library-more=""
                onClick={toggleMoreMenu}
                className="flex size-6 items-center justify-center rounded-[5px] text-faint hover:bg-row-hover hover:text-text"
              >
                <MoreIcon />
              </button>
            </span>
          </SectionHeading>

          {available ? (
            <>
              {status && (
                <div className="shrink-0 px-2 py-1 text-faint">{status}</div>
              )}
              {libraryTree}
            </>
          ) : (
            <>
              <div
                className={
                  "px-2 py-1 text-muted " +
                  (rows.length > 0 ? "shrink-0" : "min-h-0 flex-1")
                }
              >
                <p className="m-0">The Library folder isn't available.</p>
                {root && (
                  <p className="m-0 mt-1 text-ui-sm break-all text-faint">
                    {root}
                  </p>
                )}
                <div className="mt-3 flex flex-col items-start gap-1.5">
                  <button
                    type="button"
                    onClick={onChooseRoot}
                    className="rounded-[6px] bg-accent px-2.5 py-1 font-medium text-accent-fg"
                  >
                    Choose Library folder…
                  </button>
                  {root && (
                    <button
                      type="button"
                      onClick={onRecreateRoot}
                      className="rounded-[6px] px-2.5 py-1 text-muted hover:bg-row-hover hover:text-text"
                    >
                      Create it again
                    </button>
                  )}
                </div>
              </div>
              {(rows.length > 0 || cloning) && libraryTree}
            </>
          )}

          <ScratchpadList
            items={scratchpads}
            activeId={activeId}
            onActivate={onScratchpadActivate}
            onContextMenu={showScratchpadMenu}
            dragHandlers={(id) => drag.handlers({ kind: "scratchpad", id })}
            draggedId={dragSource?.kind === "scratchpad" ? dragSource.id : null}
            swallowClick={drag.swallowClick}
          />
        </>
      )}

      <WidthHandle width={width} onWidth={onWidth} />

      {drag.ghost && ghostFace && (
        <DragGhost
          ghost={drag.ghost}
          ghostRef={drag.ghostRef}
          onDone={drag.ghostDone}
          {...ghostFace}
        />
      )}

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
      tabIndex={0}
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
      className="absolute top-0 -right-[3px] bottom-0 z-10 w-[6px] cursor-col-resize outline-none focus-visible:bg-accent-soft"
    />
  );
}
