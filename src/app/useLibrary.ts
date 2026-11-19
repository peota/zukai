import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  libraryChoose,
  libraryCreateFile,
  libraryCreateFolder,
  libraryFollow,
  libraryList,
  libraryMove,
  libraryRecreate,
  libraryRename,
  libraryReserve,
  libraryResolve,
  libraryResync,
  libraryReveal,
  libraryRoot,
  librarySearch,
  librarySetDropTarget,
  libraryTrash,
  libraryUseDefault,
  libraryWatch,
  onDragDrop,
  onLibraryChanged,
  onLibraryDropped,
  type DragPoint,
  type Entry,
  type RootState,
  type SearchResult,
} from "../library/api";
import { extFor, sanitizeFileName, suggestedFileName } from "../library/names";
import {
  filterRows,
  invalidate,
  rewritePrefix,
  setChildren,
  toggle as toggleDir,
  visibleRows,
  type Row,
  type TreeState,
} from "../library/tree";
import type { FileError } from "../files/api";
import { baseName } from "../files/paths";
import { kindOf } from "../model/kinds";
import type { SidebarState, TabState, WorkspaceState } from "../model/types";
import { movedPath } from "../model/workspace";
import type { ScratchpadItem, NewItem } from "../ui/Sidebar";
import { isUnder, parentOf, splitName } from "../ui/libraryEntries";
import type { SaveAsOptions } from "./files/save";
import { asFileError } from "./files/context";
import { logError } from "./workspaceEffects";

/** The Rust search runs this long after the last keystroke. */
export const SEARCH_DEBOUNCE_MS = 120;
/** While the index is still building, the search is asked again this often. */
export const SEARCH_POLL_MS = 300;

/**
 * The extension of a new item. A plain file has none, like a new document
 * in Notepad++: it's plain text until named ("plan.ts") or given a Language.
 */
const NEW_FILE: Record<Exclude<NewItem, "folder">, string> = {
  file: "",
  canvas: "excalidraw",
};

/** What useLibrary needs from the Workspace. */
export interface LibraryDeps {
  ready: boolean;
  state: WorkspaceState;
  stateRef: { current: WorkspaceState };
  sidebar: SidebarState;
  /** The latest sidebar state (restored before `ready`). */
  sidebarRef: { current: SidebarState };
  patchSidebar(patch: Partial<SidebarState>): void;
  keyOf(path: string): string;
  openPaths(paths: string[]): Promise<void>;
  /** Writes the Tabs' pending text now; rejects if any write fails. */
  flushTabs(ids: string[]): Promise<void>;
  /** Runs `work` holding every Tab's lock (no write lands meanwhile). */
  withTabsLocked<T>(ids: string[], work: () => Promise<T>): Promise<T>;
  rewriteTabPaths(moved: ReadonlyMap<string, string>): Promise<void>;
  /** Compares the Tabs' Files with the disk now (taking their locks). */
  recheckTabs(ids: string[]): Promise<void>;
  saveAs(id: string, opts?: SaveAsOptions): Promise<void>;
  saveTo(id: string, target: string): Promise<boolean>;
  showNotice(text: string): void;
}

/** The Library on the Workspace: what the Sidebar shows and does. */
export interface LibraryApi {
  root: string | null;
  available: boolean;
  tree: TreeState;
  /** What the tree shows: the listing, or search results with their folders. */
  rows: Row[];
  /** The rows are search results. */
  searching: boolean;
  search: { query: string; results: Entry[]; ready: boolean };
  scratchpads: ScratchpadItem[];
  /** The active Tab's File path. */
  activePath: string | null;
  /** A folder toggles; a File opens in a Tab (or its Tab activates). */
  open(entry: Entry): Promise<void>;
  toggle(dir: string): void;
  /** Resolves to the new item's path once its folder's listing shows it. */
  create(parent: string, what: NewItem): Promise<string | null>;
  /** Resolves to an error message, or null when renamed. */
  rename(path: string, name: string): Promise<string | null>;
  move(path: string, destDir: string): Promise<void>;
  trash(path: string): Promise<void>;
  reveal(path: string): void;
  copyPath(path: string): void;
  chooseRoot(): Promise<void>;
  recreateRoot(): Promise<void>;
  setQuery(q: string): void;
  /** `destDir` null: Move to Library… (the save dialog, in the root). */
  scratchpadMove(id: string, destDir: string | null): Promise<void>;
}

const EMPTY_TREE: TreeState = {
  root: null,
  children: {},
  expanded: new Set(),
  selected: null,
};

/** Calls `subscribe` safely: a missing Tauri API in a test must not throw. */
function listenSafely(
  subscribe: () => Promise<() => void>,
  what: string,
): () => void {
  let off: (() => void) | null = null;
  let cancelled = false;
  void Promise.resolve()
    .then(subscribe)
    .then((u) => (cancelled ? u() : (off = u)), logError(what));
  return () => {
    cancelled = true;
    off?.();
  };
}

function fileErrorText(e: FileError, name: string): string {
  if (e.kind === "exists") return `${name} already exists`;
  if (e.kind === "invalid_name") return `${name} isn't a valid name`;
  if (e.kind === "into_self") return "A folder can't move into itself";
  if (e.kind === "not_granted") return `${name} isn't in the Library`;
  return e.message || "something went wrong";
}

/** The folder a drop at (x, y) lands in, or null when it isn't the Library. */
function dropDirAt(p: DragPoint, root: string | null): string | null {
  if (!p || root === null) return null;
  const el = document.elementFromPoint(p.x, p.y);
  if (!el?.closest("[data-z-sidebar]")) return null;
  const row = el.closest<HTMLElement>("[data-row]");
  if (row) {
    if (row.getAttribute("aria-disabled") === "true") return null;
    const path = row.dataset.path ?? null;
    if (path === null) return null;
    return row.dataset.dir === "true" ? path : parentOf(path);
  }
  return el.closest("[data-z-library-tree]") ? root : null;
}

/**
 * The Library: its root, the lazily listed tree, search, the Scratchpads list, and
 * every operation, wired to the Workspace's Tabs (spec 5.1–5.4).
 */
export function useLibrary(d: LibraryDeps): LibraryApi {
  const { ready, state, stateRef, sidebar, sidebarRef, patchSidebar } = d;
  const { keyOf } = d;
  const { openPaths, flushTabs, withTabsLocked, rewriteTabPaths } = d;
  const { recheckTabs } = d;
  const { saveAs, saveTo, showNotice } = d;

  const [rootState, setRootStateRaw] = useState<RootState | null>(null);
  const rootRef = useRef<RootState | null>(null);
  const [tree, setTreeState] = useState<TreeState>(EMPTY_TREE);
  const treeRef = useRef(tree);
  const watchedRoot = useRef<string | null>(null);
  const creatingDefault = useRef(false);
  /** The default root couldn't be created: offer Choose Library folder…. */
  const [defaultFailed, setDefaultFailed] = useState(false);

  const setTree = useCallback((f: (t: TreeState) => TreeState) => {
    const next = f(treeRef.current);
    if (next === treeRef.current) return;
    treeRef.current = next;
    setTreeState(next);
  }, []);

  /**
   * A new root starts an empty tree. The stored root's first answer takes
   * the expanded folders from the Session; `keepExpanded` keeps them across
   * a re-check of the same root.
   */
  const applyRoot = useCallback(
    (rs: RootState, keepExpanded: boolean) => {
      const prev = rootRef.current;
      rootRef.current = rs;
      setRootStateRaw(rs);
      if (prev?.root === rs.root && prev.available === rs.available) return;
      setTree((t) => ({
        ...EMPTY_TREE,
        root: rs.root,
        expanded:
          prev === null
            ? new Set(sidebarRef.current.expanded)
            : keepExpanded
              ? t.expanded
              : new Set(),
      }));
      if (prev?.root !== rs.root) watchedRoot.current = null;
    },
    [setTree, sidebarRef],
  );

  const refreshRoot = useCallback(async () => {
    try {
      applyRoot(await libraryRoot(), true);
    } catch (err) {
      logError("library root")(err);
    }
  }, [applyRoot]);

  /** Lists `dir` into the tree; a folder that can't be listed is dropped. */
  const reload = useCallback(
    async (dir: string) => {
      const root = rootRef.current?.root ?? null;
      try {
        const entries = await libraryList(dir);
        setTree((t) => (t.root === root ? setChildren(t, dir, entries) : t));
      } catch (err) {
        logError("list library folder")(err);
        if (dir === root) return refreshRoot();
        setTree((t) => {
          if (t.root !== root) return t;
          const children = { ...t.children };
          delete children[dir];
          const expanded = new Set(t.expanded);
          expanded.delete(dir);
          return { ...t, children, expanded };
        });
      }
    },
    [refreshRoot, setTree],
  );

  /** Reloads `dir` if the tree has listed it (it's on screen or cached). */
  const reloadIfListed = useCallback(
    (dir: string) => {
      if (Object.prototype.hasOwnProperty.call(treeRef.current.children, dir)) {
        return reload(dir);
      }
    },
    [reload],
  );

  /** The root and every expanded folder, listed afresh. */
  const reloadShown = useCallback(async () => {
    const t = treeRef.current;
    if (t.root === null) return;
    await Promise.all([t.root, ...t.expanded].map((dir) => reload(dir)));
  }, [reload]);

  // The stored root, once the Session is restored.
  useEffect(() => {
    if (!ready) return;
    libraryRoot().then((rs) => applyRoot(rs, true), logError("library root"));
  }, [ready, applyRoot]);

  // The expanded folders go back to the Session whenever they change.
  const { expanded } = tree;
  const known = tree.root !== null;
  useEffect(() => {
    if (known) patchSidebar({ expanded: [...expanded] });
  }, [known, expanded, patchSidebar]);

  // Shown: create the default root the first time, then watch it (once per
  // root: it rebuilds the index) and list what's on screen.
  const open = sidebar.open;
  useEffect(() => {
    if (!ready || !open || rootState === null) return;
    if (rootState.root === null) {
      if (creatingDefault.current) return;
      creatingDefault.current = true;
      void libraryUseDefault()
        .then(
          (rs) => applyRoot(rs, false),
          (err: unknown) => {
            logError("create library")(err);
            setDefaultFailed(true);
          },
        )
        .finally(() => (creatingDefault.current = false));
      return;
    }
    if (!rootState.available) return;
    if (watchedRoot.current !== rootState.root) {
      watchedRoot.current = rootState.root;
      libraryWatch().catch(logError("watch library"));
    }
    if (!(rootState.root in treeRef.current.children)) void reloadShown();
  }, [ready, open, rootState, applyRoot, reloadShown]);

  // --- Search --------------------------------------------------------------

  const [query, setQueryState] = useState("");
  const queryRef = useRef("");
  const [results, setResults] = useState<SearchResult>({
    entries: [],
    ready: true,
  });
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const searchSeq = useRef(0);

  /**
   * Asks Rust for the current query; while the index is still building,
   * asks again every SEARCH_POLL_MS. A newer search (or query) stops it.
   */
  const runSearch = useCallback(async () => {
    const seq = ++searchSeq.current;
    for (;;) {
      const q = queryRef.current.trim();
      if (q === "") return;
      let r: SearchResult;
      try {
        r = await librarySearch(q);
      } catch (err) {
        logError("search library")(err);
        r = { entries: [], ready: true };
      }
      if (seq !== searchSeq.current) return;
      setResults(r);
      if (r.ready) return;
      await new Promise((res) => setTimeout(res, SEARCH_POLL_MS));
      if (seq !== searchSeq.current) return;
    }
  }, []);

  const setQuery = useCallback(
    (q: string) => {
      const wasEmpty = queryRef.current.trim() === "";
      queryRef.current = q;
      setQueryState(q);
      if (searchTimer.current !== null) clearTimeout(searchTimer.current);
      searchTimer.current = null;
      if (q.trim() === "") {
        searchSeq.current++;
        setResults({ entries: [], ready: true });
        return;
      }
      // A fresh search says "Searching…"; later keystrokes keep the last
      // results until the new ones arrive.
      if (wasEmpty) setResults({ entries: [], ready: false });
      searchTimer.current = setTimeout(() => {
        searchTimer.current = null;
        void runSearch();
      }, SEARCH_DEBOUNCE_MS);
    },
    [runSearch],
  );

  useEffect(
    () => () => {
      searchSeq.current++;
      if (searchTimer.current !== null) clearTimeout(searchTimer.current);
    },
    [],
  );

  // --- Outside changes -----------------------------------------------------

  useEffect(
    () =>
      listenSafely(
        () =>
          onLibraryChanged((e) => {
            const { state: next, reload: dirs } = invalidate(
              treeRef.current,
              e.dirs,
            );
            setTree(() => next);
            for (const dir of dirs) void reload(dir);
            if (queryRef.current.trim() !== "") void runSearch();
          }),
        "listen library changes",
      ),
    [reload, runSearch, setTree],
  );

  useEffect(
    () =>
      listenSafely(
        () =>
          onLibraryDropped((e) => {
            if (e.failed.length > 0) {
              showNotice(`Couldn't copy ${e.failed.join(", ")}`);
            }
          }),
        "listen library drops",
      ),
    [showNotice],
  );

  // Windows drops watcher events when its buffer overflows: on focus, list
  // what's shown again and have Rust rebuild a stale index.
  useEffect(() => {
    const onFocus = () => {
      if (watchedRoot.current === null || !rootRef.current?.available) return;
      void reloadShown();
      libraryResync().catch(logError("resync library"));
    };
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [reloadShown]);

  // An OS drag over a sidebar folder: tell Rust, so the drop copies there.
  useEffect(() => {
    let last: string | null = null;
    return listenSafely(
      () =>
        onDragDrop((p) => {
          const dir = dropDirAt(p, rootRef.current?.root ?? null);
          if (dir === last) return;
          last = dir;
          librarySetDropTarget(dir).catch(logError("drop target"));
        }),
      "listen drags",
    );
  }, []);

  // --- Operations ----------------------------------------------------------

  const toggle = useCallback(
    (dir: string) => {
      const t = treeRef.current;
      const expanding = !t.expanded.has(dir);
      setTree((s) => toggleDir(s, dir));
      if (expanding && !Array.isArray(t.children[dir])) {
        setTree((s) => ({
          ...s,
          children: { ...s.children, [dir]: "loading" },
        }));
        void reload(dir);
      }
    },
    [reload, setTree],
  );

  const openEntry = useCallback(
    async (entry: Entry) => {
      if (entry.isDir) return toggle(entry.path);
      // A link that stays inside the Library opens as its target (spec
      // §5.8.3): the Tab, its Session entry and its watcher name the one
      // path Rust grants, and an open Tab for the target is reused. The
      // link stays the tree row for rename, trash and reveal.
      let path = entry.path;
      if (entry.link === "inside") {
        try {
          path = await libraryResolve(entry.path);
        } catch (err) {
          const e = asFileError(err);
          return showNotice(`Can't open ${entry.name}: ${e.message}`);
        }
      }
      await openPaths([path]);
    },
    [openPaths, showNotice, toggle],
  );

  /** Lists `dir` and makes sure it's expanded, so its new item shows. */
  const showIn = useCallback(
    async (dir: string) => {
      const entries = await libraryList(dir);
      setTree((t) => {
        const next = setChildren(t, dir, entries);
        if (dir === t.root || t.expanded.has(dir)) return next;
        return { ...next, expanded: new Set(next.expanded).add(dir) };
      });
    },
    [setTree],
  );

  const create = useCallback(
    async (parent: string, what: NewItem): Promise<string | null> => {
      let path: string;
      try {
        path =
          what === "folder"
            ? await libraryCreateFolder(parent, "New folder")
            : await libraryCreateFile(parent, "Untitled", NEW_FILE[what]);
      } catch (err) {
        const e = asFileError(err);
        showNotice(`Can't create it in ${baseName(parent)}: ${e.message}`);
        return null;
      }
      try {
        await showIn(parent);
      } catch (err) {
        logError("list library folder")(err);
      }
      if (what !== "folder") await openPaths([path]);
      return path;
    },
    [openPaths, showIn, showNotice],
  );

  /** File paths of open Tabs and Recently Closed entries at or under `path`. */
  const heldPaths = useCallback(
    (path: string) => {
      const s = stateRef.current;
      const all = [...s.tabs, ...s.closed.map((e) => e.tab)].flatMap((t) =>
        t.file ? [t.file.path] : [],
      );
      return [
        ...new Set(all.filter((p) => movedPath(p, path, path, keyOf) !== null)),
      ];
    },
    [keyOf, stateRef],
  );

  /** Open Tabs whose File is `path` or inside it. */
  const affectedTabs = useCallback(
    (path: string) =>
      stateRef.current.tabs
        .filter(
          (t) => t.file && movedPath(t.file.path, path, path, keyOf) !== null,
        )
        .map((t) => t.id),
    [keyOf, stateRef],
  );

  /**
   * Flushes the Tabs under `path`, then (holding their locks) runs `op`.
   * Resolves to an error message, or null when it was done.
   */
  const withFlushed = useCallback(
    async (
      path: string,
      verb: string,
      op: () => Promise<string | null>,
    ): Promise<string | null> => {
      const ids = affectedTabs(path);
      try {
        await flushTabs(ids);
      } catch (err) {
        logError("flush before library operation")(err);
        const msg = `Can't ${verb} ${baseName(path)}: an open file in it couldn't be saved`;
        showNotice(msg);
        return msg;
      }
      return withTabsLocked(ids, op);
    },
    [affectedTabs, flushTabs, showNotice, withTabsLocked],
  );

  /**
   * After `from` became `to`: Tabs, closed entries and the tree follow.
   * Rust grants each moved File path and returns it; only those change.
   */
  const relocated = useCallback(
    async (from: string, to: string) => {
      if (to !== from) {
        const paths = heldPaths(from);
        if (paths.length > 0) {
          let now: (string | null)[] = [];
          try {
            now = await libraryFollow(from, to, paths);
          } catch (err) {
            logError("follow moved files")(err);
          }
          const moved = new Map<string, string>();
          paths.forEach((p, i) => {
            const n = now[i];
            if (typeof n === "string") moved.set(p, n);
          });
          await rewriteTabPaths(moved);
        }
        setTree((t) => rewritePrefix(t, from, to));
      }
      const dirs = new Set([parentOf(from), parentOf(to)]);
      await Promise.all([...dirs].map((dir) => reloadIfListed(dir)));
    },
    [heldPaths, reloadIfListed, rewriteTabPaths, setTree],
  );

  const entryOf = useCallback((path: string): Entry | undefined => {
    const list = treeRef.current.children[parentOf(path)];
    return Array.isArray(list) ? list.find((e) => e.path === path) : undefined;
  }, []);

  const rename = useCallback(
    (path: string, name: string): Promise<string | null> => {
      const entry = entryOf(path);
      const isDir = entry?.isDir ?? false;
      const { ext } = splitName(entry?.name ?? baseName(path), isDir);
      // Rust keeps a File's extension and takes only the stem.
      const arg =
        !isDir && ext && name.toLowerCase().endsWith(ext.toLowerCase())
          ? name.slice(0, -ext.length)
          : name;
      // A file with no extension takes the typed one: it may not turn into
      // a drawing or an image, which its open Tab couldn't show or save.
      const newName = arg + ext;
      if (!isDir && kindOf(newName) !== kindOf(baseName(path))) {
        return Promise.resolve(`A text file can't become ${newName}`);
      }
      return withFlushed(path, "rename", async () => {
        let to: string;
        try {
          to = await libraryRename(path, arg);
        } catch (err) {
          return fileErrorText(asFileError(err), isDir ? arg : arg + ext);
        }
        await relocated(path, to);
        return null;
      });
    },
    [entryOf, relocated, withFlushed],
  );

  const move = useCallback(
    async (path: string, destDir: string) => {
      await withFlushed(path, "move", async () => {
        let to: string;
        try {
          to = await libraryMove(path, destDir);
        } catch (err) {
          const msg = `Can't move ${baseName(path)}: ${fileErrorText(asFileError(err), baseName(path))}`;
          showNotice(msg);
          return msg;
        }
        await relocated(path, to);
        return null;
      });
    },
    [relocated, showNotice, withFlushed],
  );

  const trash = useCallback(
    async (path: string) => {
      const ids = affectedTabs(path);
      const failed = await withFlushed(path, "delete", async () => {
        try {
          await libraryTrash(path);
        } catch (err) {
          const msg = `Can't move ${baseName(path)} to the Trash: ${asFileError(err).message}`;
          showNotice(msg);
          return msg;
        }
        // Open Files under it become Missing through the File watcher.
        setTree((t) => {
          const gone = (p: string) => p === path || isUnder(p, path);
          if (![...t.expanded].some(gone)) return t;
          return {
            ...t,
            expanded: new Set([...t.expanded].filter((p) => !gone(p))),
          };
        });
        await reloadIfListed(parentOf(path));
        return null;
      });
      // Watchers don't report the Files of a folder moved away: check them
      // now, so they become Missing at once (their text kept in shadows).
      if (failed === null) await recheckTabs(ids);
    },
    [
      affectedTabs,
      recheckTabs,
      reloadIfListed,
      setTree,
      showNotice,
      withFlushed,
    ],
  );

  const reveal = useCallback(
    (path: string) => {
      libraryReveal(path).catch((err: unknown) =>
        showNotice(`Can't show ${baseName(path)}: ${asFileError(err).message}`),
      );
    },
    [showNotice],
  );

  const copyPath = useCallback((path: string) => {
    void Promise.resolve()
      .then(() => navigator.clipboard.writeText(path))
      .catch(logError("copy path"));
  }, []);

  const chooseRoot = useCallback(async () => {
    try {
      applyRoot(await libraryChoose(), false);
    } catch (err) {
      showNotice(`Can't use that folder: ${asFileError(err).message}`);
    }
  }, [applyRoot, showNotice]);

  const recreateRoot = useCallback(async () => {
    try {
      applyRoot(await libraryRecreate(), true);
    } catch (err) {
      showNotice(
        `Can't create the Library folder: ${asFileError(err).message}`,
      );
    }
  }, [applyRoot, showNotice]);

  const tabOf = useCallback(
    (id: string): TabState | undefined =>
      stateRef.current.tabs.find((t) => t.id === id),
    [stateRef],
  );

  const scratchpadMove = useCallback(
    async (id: string, destDir: string | null) => {
      const tab = tabOf(id);
      if (!tab || tab.file) return;
      if (destDir === null) {
        const root = rootRef.current?.root;
        return saveAs(id, {
          dir: root ?? undefined,
          suggested: suggestedFileName(tab),
        });
      }
      let target: string;
      try {
        target = await libraryReserve(
          destDir,
          sanitizeFileName(tab.title),
          extFor(tab).slice(1),
        );
      } catch (err) {
        return showNotice(
          `Can't save ${tab.title} in ${baseName(destDir)}: ${asFileError(err).message}`,
        );
      }
      const saved = await saveTo(id, target);
      // The reserved file stays empty: put it in the Trash, not just leave it.
      if (!saved) await libraryTrash(target).catch(logError("trash reserved"));
      await reloadIfListed(destDir);
    },
    [reloadIfListed, saveAs, saveTo, showNotice, tabOf],
  );

  // --- What the Sidebar shows ---------------------------------------------

  const root = rootState?.root ?? null;
  const searching = query.trim() !== "";
  const rows = useMemo(
    () =>
      searching
        ? root === null
          ? []
          : filterRows(results.entries, root)
        : visibleRows(tree),
    [searching, root, results.entries, tree],
  );
  const search = useMemo(
    () => ({ query, results: results.entries, ready: results.ready }),
    [query, results],
  );
  const { tabs, activeId } = state;
  const scratchpads = useMemo(
    () =>
      tabs
        // A pinned Scratchpad is listed under Pinned instead.
        .filter((t) => !t.file && !t.pinned)
        .map((t) => ({ id: t.id, title: t.title, kind: t.kind })),
    [tabs],
  );
  const activePath = tabs.find((t) => t.id === activeId)?.file?.path ?? null;

  return {
    root,
    // Not known yet, or the default root being created: no "missing" panel.
    available:
      rootState === null ||
      rootState.available ||
      (rootState.root === null && !defaultFailed),
    tree,
    rows,
    searching,
    search,
    scratchpads,
    activePath,
    open: openEntry,
    toggle,
    create,
    rename,
    move,
    trash,
    reveal,
    copyPath,
    chooseRoot,
    recreateRoot,
    setQuery,
    scratchpadMove,
  };
}
