import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useWorkspace } from "./app/useWorkspace";
import { isTerminalTarget, routeKey } from "./terminal/keys";
import { defaultFolder, plusFolder } from "./terminal/defaultFolder";
import { useTerminals } from "./terminal/useTerminals";
import { detectPlatform, matchShortcut, type Command } from "./app/shortcuts";
import {
  allowsContextMenu,
  blocksBrowserKey,
  isEditorTarget,
  richHandled,
} from "./app/browserGuard";
import { effectiveMode } from "./model/markdownMode";
import type {
  ImageInfo,
  LanguageId,
  SplitOrientation,
  TabState,
} from "./model/types";
import { splitOf } from "./model/split";
import { isUnder, revealLabel } from "./ui/libraryEntries";
import { EditorHost } from "./editor/EditorHost";
import { TabPane, useSlots } from "./app/TabPane";
import { SplitView } from "./ui/SplitView";
import { SplitDropZone, dropSide } from "./ui/SplitDropZone";
import type { FormatResult } from "./editor/jsonFormat";
import { WindowControls } from "./ui/WindowControls";
import { TabBar } from "./ui/TabBar";
import { StatusBar } from "./ui/StatusBar";
import { LanguagePicker } from "./ui/LanguagePicker";
import { TabContextMenu } from "./ui/TabContextMenu";
import { FileFormatMenu } from "./ui/FileFormatMenu";
import { EncodingPicker } from "./ui/EncodingPicker";
import { convertPatch } from "./ui/encodings";
import { folderHints } from "./ui/tabFolders";
import { fileReadBytes, openDefault, openUrl, pathKey } from "./files/api";
import { createTextFeed } from "./markdown/MarkdownPreview";
import { baseName, languageRename } from "./files/paths";
import { inShadow } from "./files/fileState";
import { asFileError } from "./app/files/context";
import { Sidebar } from "./ui/Sidebar";
import { SidebarToggle } from "./ui/SidebarToggle";
import { pinnedItems, recentItems } from "./ui/Pinned";
import { useGoneClosed } from "./app/useGoneClosed";
import { useColorScheme } from "./ui/useColorScheme";
import { SaveChangesDialog } from "./ui/SaveChangesDialog";
import { SettingsDialog } from "./ui/SettingsDialog";
import { QuickOpen, type QuickTab } from "./ui/QuickOpen";
import { fileIcon } from "./ui/icons";
import { libraryQuickOpen } from "./library/api";
import { rootOf } from "./library/tree";
import { parentOf } from "./ui/libraryEntries";

const platform = detectPlatform();
const keyOf = (p: string) => pathKey(p, platform);
const PLATFORM_ENDING = platform === "windows" ? "crlf" : "lf";
const REOPEN_HINT = platform === "mac" ? "⇧⌘T" : "Ctrl+Shift+T";
const NEW_HINTS =
  platform === "mac"
    ? { text: "⌘N", canvas: "⇧⌘N" }
    : { text: "Ctrl+N", canvas: "Ctrl+Shift+N" };
const REVEAL_LABEL = revealLabel(platform);
const BEAUTIFY_HINT = platform === "mac" ? "⇧⌥F" : "Shift+Alt+F";
const SETTINGS_HINT = platform === "mac" ? "⌘," : "Ctrl+,";
const PREVIEW_HINT = platform === "mac" ? "⇧⌘V" : "Ctrl+Shift+V";
const RICH_HINT = platform === "mac" ? "⇧⌘M" : "Ctrl+Shift+M";
const NO_TERMINAL_FOLDER = "Choose a Library folder to open a terminal";

// xterm loads with the first terminal, never at startup.
const TerminalPanel = lazy(() =>
  import("./terminal/TerminalPanel").then((m) => ({
    default: m.TerminalPanel,
  })),
);

interface Cursor {
  id: string;
  line: number;
  col: number;
}

export default function App() {
  const w = useWorkspace();
  const { updateTab } = w;
  const activeId = w.state.activeId;
  const [cursor, setCursor] = useState<Cursor | null>(null);
  const [picking, setPicking] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [quickOpen, setQuickOpen] = useState(false);
  /** Edits reach a Markdown preview without re-rendering the App. */
  const [feed] = useState(createTextFeed);
  const { setContent } = w;
  const onEditorChange = useCallback(
    (id: string, text: string) => {
      setContent(id, text);
      feed.publish(id, text);
    },
    [setContent, feed],
  );
  // Settings is the App's own dialog; every other command is the Workspace's.
  const workspaceRun = w.run;
  const [focusSignal, setFocusSignal] = useState(0);
  /** Give the keyboard back to the editor. */
  const refocus = useCallback(() => setFocusSignal((n) => n + 1), []);
  const { showNotice } = w;

  const terms = useTerminals();
  const termState = terms.state;
  const { open: openTerm, show: showTerm, hide: hideTerm } = terms;
  const { root: libRoot, available: libAvailable, added: libAdded } = w.library;
  /** Where a new terminal opens: the active File's folder, else a root. */
  const termFolder = defaultFolder({
    activeFile: w.state.tabs.find((x) => x.id === activeId)?.file?.path,
    root: libRoot,
    rootAvailable: libAvailable,
    added: libAdded,
  });
  /** A new terminal in `cwd`, shown and focused; none without a folder. */
  const openTerminal = useCallback(
    (cwd: string | null) => {
      if (cwd === null) {
        showNotice(NO_TERMINAL_FOLDER);
        return;
      }
      openTerm(cwd).catch((err) =>
        showNotice(`Can't open a terminal: ${asFileError(err).message}`),
      );
    },
    [openTerm, showNotice],
  );
  /**
   * The panel's +: the active terminal's folder while it's still granted.
   * If that folder no longer exists, the default folder instead.
   */
  const plusTerminal = () => {
    const cwd = plusFolder(
      termState.terms.find((x) => x.id === termState.activeId),
      [
        ...(libRoot !== null && libAvailable ? [libRoot] : []),
        ...libAdded.filter((a) => a.available).map((a) => a.path),
      ],
      termFolder,
    );
    if (cwd === null || cwd === termFolder) return openTerminal(cwd);
    openTerm(cwd).catch(() => openTerminal(termFolder));
  };
  // The panel loads with the first terminal and stays mounted after that.
  const [panelLoaded, setPanelLoaded] = useState(false);
  if (!panelLoaded && termState.terms.length > 0) setPanelLoaded(true);

  const run = useCallback(
    async (cmd: Command) => {
      if (cmd.type === "openSettings") setSettingsOpen(true);
      else if (cmd.type === "quickOpen") setQuickOpen(true);
      else if (cmd.type === "toggleTerminal") {
        if (termState.shown) {
          hideTerm();
          refocus();
        } else if (termState.terms.length > 0) {
          // The active terminal takes the keyboard once it's visible.
          showTerm();
        } else {
          openTerminal(termFolder);
        }
        return;
      } else if (cmd.type === "newTerminal") {
        openTerminal(termFolder);
        return;
      } else await workspaceRun(cmd);
      // The other editor takes the keyboard.
      if (cmd.type === "toggleRichMarkdown") refocus();
    },
    [
      workspaceRun,
      refocus,
      termState,
      hideTerm,
      showTerm,
      openTerminal,
      termFolder,
    ],
  );
  /** The side a dragged Tab would split the editor area on, while shown. */
  const [dropZone, setDropZone] = useState<SplitOrientation | null>(null);
  const [tabMenu, setTabMenu] = useState<{
    x: number;
    y: number;
    tabId: string | null;
  } | null>(null);
  const [formatMenu, setFormatMenu] = useState<{
    kind: "encoding" | "lineEnding";
    anchor: DOMRect;
  } | null>(null);
  /** The encoding list, pinned to the Tab it was opened for. */
  const [encPicker, setEncPicker] = useState<{
    mode: "reopen" | "convert";
    id: string;
  } | null>(null);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      // In a terminal the shell owns most keys: no app Command for those.
      if (
        isTerminalTarget(e.target) &&
        routeKey(e, platform, false) !== "app"
      ) {
        if (blocksBrowserKey(e, platform, false)) e.preventDefault();
        return;
      }
      const cmd = matchShortcut(e, platform);
      // A key the rich editor used (Mod+B is bold there) is its own.
      if (cmd && !richHandled(e)) {
        e.preventDefault();
        void run(cmd);
      } else if (blocksBrowserKey(e, platform, isEditorTarget(e.target))) {
        // No reload, print or browser find inside the app.
        e.preventDefault();
      }
    };
    const onContextMenu = (e: MouseEvent) => {
      if (!allowsContextMenu(e.target)) e.preventDefault();
    };
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("contextmenu", onContextMenu);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("contextmenu", onContextMenu);
    };
  }, [run]);

  const active = w.state.tabs.find((t) => t.id === activeId);
  const isCanvas = active?.kind === "canvas";
  const isImage = active?.kind === "image";
  const isMarkdown = active?.kind === "text" && active.language === "markdown";
  const activeMode = active ? effectiveMode(active, w.settings) : null;
  /** A Markdown Tab's preview; any other Tab is just edited. */
  const previewMode = (isMarkdown && active?.preview) || "edit";
  const theme = useColorScheme(w.settings.theme);
  // The CSS palette follows <html data-theme> (light or dark), refined by
  // data-palette (which light or dark theme) and data-accent.
  const palette =
    theme === "dark" ? w.settings.darkTheme : w.settings.lightTheme;
  const accent = w.settings.accent;
  useEffect(() => {
    const root = document.documentElement.dataset;
    root.theme = theme;
    root.palette = palette;
    root.accent = accent;
  }, [theme, palette, accent]);
  const uiFontSize = w.settings.uiFontSize;
  useEffect(() => {
    document.documentElement.style.setProperty(
      "--z-ui-font",
      `${uiFontSize}px`,
    );
  }, [uiFontSize]);
  /** The text editor only sees text (a Canvas is JSON, an Image bytes). */
  const editorTabs = useMemo(
    () => w.state.tabs.filter((t) => t.kind === "text"),
    [w.state.tabs],
  );
  /** The Split the active Tab is in: both its Tabs are shown. */
  const split = useMemo(() => splitOf(w.state, activeId), [w.state, activeId]);
  const visible = useMemo(
    () =>
      (split ? [split.a, split.b] : [activeId]).flatMap((id) =>
        w.state.tabs.filter((t) => t.id === id),
      ),
    [split, activeId, w.state.tabs],
  );
  /** Where the editor puts each shown text Tab's view (its TabPane). */
  const [slots, slotRef] = useSlots();
  /** A reload of an Image Tab from disk (a newer replace) reads it again. */
  const reloadSeqOf = (id: string) =>
    w.replaceRequests.reduce(
      (n, r) => (r.id === id && r.seq > n ? r.seq : n),
      0,
    );
  /**
   * Each Image Tab's size and format, for the image it shows now: a reload
   * starts with none until its image loads.
   */
  const [imageInfo, setImageInfo] = useState<
    Readonly<Record<string, { seq: number; info: ImageInfo | null }>>
  >({});
  const onImageInfo = useCallback(
    (id: string, seq: number, info: ImageInfo | null) =>
      setImageInfo((m) =>
        m[id]?.seq === seq && m[id].info === info
          ? m
          : { ...m, [id]: { seq, info } },
      ),
    [],
  );
  const activeImageInfo = imageInfo[activeId];
  const shownImageInfo =
    isImage &&
    active.file?.held !== "missing" &&
    activeImageInfo?.seq === reloadSeqOf(activeId)
      ? (activeImageInfo.info ?? undefined)
      : undefined;
  // An Image Tab's text is never shown, but loading it records the File's
  // fingerprint and state, so disk changes reach it (and it can go Missing).
  const { loadContent } = w;
  const shownImages = visible
    .filter((t) => t.kind === "image")
    .map((t) => t.id)
    .join("|");
  useEffect(() => {
    if (!shownImages) return;
    for (const id of shownImages.split("|")) loadContent(id).catch(() => {});
  }, [shownImages, loadContent]);
  const here =
    active && cursor?.id === active.id ? cursor : { line: 1, col: 1 };
  const unreadable = !!active && w.shadowUnreadable.has(active.id);
  const folders = folderHints(
    w.state.tabs.flatMap((t) =>
      t.file ? [{ id: t.id, path: t.file.path }] : [],
    ),
    keyOf,
  );
  const pickerTab = encPicker
    ? w.state.tabs.find((t) => t.id === encPicker.id)
    : undefined;

  const onCursor = useCallback(
    (line: number, col: number) => setCursor({ id: activeId, line, col }),
    [activeId],
  );

  const onFormatResult = useCallback(
    (r: FormatResult) => {
      if (!r.ok) showNotice(`Invalid JSON at line ${r.line}, col ${r.col}`);
    },
    [showNotice],
  );

  const closePicker = useCallback(() => {
    setPicking(false);
    refocus();
  }, [refocus]);

  /** A text File whose extension doesn't match `language` can take its. */
  const renameOffer = useCallback(
    (language: LanguageId) =>
      active?.kind === "text" && active.file && active.file.held === null
        ? languageRename(active.file.path, language)
        : null,
    [active],
  );
  const offer = picking && active ? renameOffer(active.language) : null;

  const pickLanguage = useCallback(
    (language: LanguageId) => {
      if (activeId) updateTab(activeId, { language, languagePicked: true });
      // A pick that no longer matches the File keeps the list open on the
      // rename offer; Escape still just closes it.
      if (!renameOffer(language)) closePicker();
    },
    [activeId, updateTab, closePicker, renameOffer],
  );

  const { renameExtension } = w;
  const renameToLanguage = useCallback(() => {
    if (activeId && offer) void renameExtension(activeId, offer.ext);
    closePicker();
  }, [activeId, offer, renameExtension, closePicker]);

  const mainRef = useRef<HTMLElement>(null);
  /** The side of the editor area at x, y, if the dragged Tab could split it. */
  const sideAt = (id: string, x: number, y: number) => {
    const rect = mainRef.current?.getBoundingClientRect();
    if (!rect || id === activeId || split) return null;
    return dropSide(rect, x, y);
  };

  const closeTabMenu = useCallback(() => {
    setTabMenu(null);
    refocus();
  }, [refocus]);
  /** A chosen item that opens the encoding list keeps the focus there. */
  const closeFormatMenu = useCallback(
    (chose = false) => {
      setFormatMenu(null);
      if (!chose) refocus();
    },
    [refocus],
  );
  const closeEncPicker = useCallback(() => {
    setEncPicker(null);
    refocus();
  }, [refocus]);

  const pickEncoding = useCallback(
    (label: string) => {
      if (encPicker?.mode === "reopen") {
        void w.reopenWithEncoding(encPicker.id, label);
      } else if (encPicker?.mode === "convert") {
        w.convert(encPicker.id, convertPatch(label));
      }
      closeEncPicker();
    },
    [closeEncPicker, encPicker, w],
  );

  const { isClosing, shadowUnreadable } = w;
  const tabs = w.state.tabs;
  const isReadOnly = useCallback(
    (id: string) =>
      isClosing(id) ||
      shadowUnreadable.has(id) ||
      tabs.find((t) => t.id === id)?.file?.held === "readonly",
    [isClosing, shadowUnreadable, tabs],
  );
  const onShortcut = useCallback((cmd: Command) => void run(cmd), [run]);

  /** The read-only bar's Open with default app (Rust refuses executables). */
  const openWithDefault = useCallback(
    async (path: string) => {
      try {
        const r = await openDefault(path);
        if (r.kind === "refused_exec") {
          showNotice(
            `${baseName(path)} could run a program, so it isn't opened`,
          );
        }
      } catch (err) {
        showNotice(`Can't open ${baseName(path)}: ${asFileError(err).message}`);
      }
    },
    [showNotice],
  );

  const lib = w.library;

  const closeQuickOpen = useCallback(() => {
    setQuickOpen(false);
    refocus();
  }, [refocus]);
  /** With nothing typed, Quick open lists the other open Tabs. */
  const quickTabs: QuickTab[] = quickOpen
    ? w.state.tabs
        .filter((t) => t.id !== activeId)
        .map((t) => ({
          id: t.id,
          title: t.title,
          detail: t.file ? parentOf(t.file.path) : "Scratchpad",
          icon: t.file
            ? fileIcon(t.file.path)
            : t.kind === "canvas"
              ? "canvas"
              : "scratchpad",
        }))
    : [];
  const added = lib.added;
  /** An added folder's name before its hits' folders; none for the Library. */
  const treeLabel = useCallback(
    (path: string) => {
      const r = rootOf(
        path,
        added.map((a) => a.path),
      );
      return r ? baseName(r.replace(/[\\/]+$/, "")) : null;
    },
    [added],
  );

  /** One Tab's area, alone or as half of a Split. */
  const pane = (tab: TabState) => (
    <TabPane
      tab={tab}
      focused={tab.id === activeId}
      onFocus={() => w.activate(tab.id)}
      slotRef={slotRef}
      unreadable={w.shadowUnreadable.has(tab.id)}
      onKeepMine={() => void w.keepMine(tab.id)}
      onLoadDisk={() => void w.loadDiskVersion(tab.id)}
      onSaveAs={() => void w.saveAs(tab.id)}
      onSaveToOriginal={() => void w.saveToOriginal(tab.id)}
      onReopenWithEncoding={() => setEncPicker({ mode: "reopen", id: tab.id })}
      onConvertToUtf8={() =>
        w.convert(tab.id, { encoding: "utf-8", bom: false })
      }
      onOpenDefault={
        tab.file ? () => void openWithDefault(tab.file!.path) : undefined
      }
      onReveal={
        tab.file && lib.root && isUnder(tab.file.path, lib.root)
          ? () => lib.reveal(tab.file!.path)
          : undefined
      }
      revealLabel={REVEAL_LABEL}
      previewSplit={w.settings.previewSplit}
      onPreviewSplit={(r) => w.setSettings({ previewSplit: r })}
      feed={feed}
      onOpenLink={(url) =>
        void openUrl(url).catch(() => w.showNotice(`Can't open ${url}`))
      }
      tabs={w.state.tabs}
      loadContent={w.loadContent}
      onChange={w.setContent}
      onTabPatch={updateTab}
      replaceRequests={w.replaceRequests}
      isReadOnly={isReadOnly}
      theme={theme}
      onShortcut={onShortcut}
      readBytes={fileReadBytes}
      reloadSeq={reloadSeqOf(tab.id)}
      onImageInfo={onImageInfo}
      mode={effectiveMode(tab, w.settings)}
      bridge={w.bridge}
      fontSize={w.fontSize}
      onRichFallback={(notice) => w.richFallback(tab.id, notice)}
      focusSignal={focusSignal}
      onZoom={w.zoomEditor}
      registerRich={w.registerRich}
      onRichConflict={() => w.richConflict(tab.id)}
    />
  );

  /** Closed Recent entries whose File was deleted (hidden from Recent). */
  const goneClosed = useGoneClosed(w.sidebar.recent, w.state.closed);

  /** Activates an open Tab, or reopens a closed one (a pin stays pinned). */
  const openTabOrClosed = (id: string) => {
    if (w.state.tabs.some((t) => t.id === id)) {
      w.activate(id);
      refocus();
    } else {
      void w.reopenEntry(id).then(refocus);
    }
  };

  return (
    <div className="relative flex h-full bg-chrome text-text">
      <Sidebar
        open={w.sidebar.open}
        width={w.sidebar.width}
        onWidth={w.setSidebarWidth}
        root={lib.root}
        available={lib.available}
        tree={lib.tree}
        rows={lib.rows}
        searching={lib.searching}
        search={lib.search}
        onSearch={lib.setQuery}
        scratchpads={lib.scratchpads}
        activePath={lib.activePath}
        revealed={lib.revealed}
        activeId={activeId}
        onOpen={(entry) => void lib.open(entry).then(refocus)}
        onToggle={lib.toggle}
        onCollapseAll={lib.collapseAll}
        onCreate={lib.create}
        onRename={lib.rename}
        onMove={(path, dest) => void lib.move(path, dest)}
        onTrash={(path) => void lib.trash(path).then(goneClosed.recheck)}
        onReveal={lib.reveal}
        onCopyPath={lib.copyPath}
        onChooseRoot={() => void lib.chooseRoot()}
        onRecreateRoot={() => void lib.recreateRoot()}
        onScratchpadActivate={(id) => {
          w.activate(id);
          refocus();
        }}
        onScratchpadMove={(id, dest) => void lib.scratchpadMove(id, dest)}
        pinned={pinnedItems(w.state.tabs, w.state.closed)}
        onPinnedOpen={openTabOrClosed}
        onUnpin={(id) => w.setPinned(id, false)}
        recent={recentItems(
          w.sidebar.recent,
          w.state.tabs,
          w.state.closed,
          keyOf,
          goneClosed.gone,
        )}
        onRecentOpen={openTabOrClosed}
        onLeave={refocus}
        added={lib.added}
        onAddFolder={() => void lib.addFolder()}
        onLocateFolder={(path) => void lib.locateFolder(path)}
        onRemoveFolder={(path) => void lib.removeFolder(path)}
        onOpenTerminal={openTerminal}
        platform={platform}
      />
      <div className="flex h-full min-w-0 flex-1 flex-col" data-z-workspace="">
        {/* The title bar: the sidebar toggle, tabs, then the window controls
            (none on macOS). */}
        <div className="flex shrink-0 bg-chrome" data-tauri-drag-region="">
          <SidebarToggle
            open={w.sidebar.open}
            platform={platform}
            // macOS draws its traffic lights over the bar's left end.
            inset={platform === "mac" && !w.sidebar.open ? 78 : 0}
            onToggle={w.toggleSidebar}
          />
          <TabBar
            tabs={w.state.tabs.map((t) => ({
              id: t.id,
              title: t.title,
              active: t.id === activeId,
              file: t.file
                ? { missing: t.file.held === "missing", path: t.file.path }
                : undefined,
              locked: w.shadowUnreadable.has(t.id),
              folder: folders.get(t.id),
              pinned: t.pinned,
              kind: t.kind,
              unsaved: t.file ? inShadow(t.file) : false,
            }))}
            onActivate={w.activate}
            onClose={(id) => void w.closeTab(id)}
            onNew={() => void run({ type: "newTab" })}
            onNewCanvas={() => void run({ type: "newCanvas" })}
            newHints={NEW_HINTS}
            onMove={w.moveTab}
            onRename={(id, name) => {
              // A File renames on disk and may report why it couldn't.
              if (w.state.tabs.find((t) => t.id === id)?.file) {
                return w.renameFile(id, name);
              }
              void w.rename(id, name);
            }}
            onContextMenu={(tabId, x, y) => setTabMenu({ tabId, x, y })}
            onUnpin={(id) => w.setPinned(id, false)}
            splits={w.state.splits}
            onCloseSplit={w.closeSplit}
            onDragOut={(id, x, y) => setDropZone(sideAt(id, x, y))}
            onDropOut={(id, x, y) => {
              const side = sideAt(id, x, y);
              setDropZone(null);
              if (side) w.splitWith(activeId, id, side);
            }}
            onDragOutEnd={() => setDropZone(null)}
          />
          <WindowControls platform={platform} />
        </div>
        {/* The editor area and the terminal panel (under it at the bottom,
            right of it at the side). The tab bar keeps its full width. */}
        <div className="flex min-h-0 flex-1 flex-row">
          <div
            className={`flex min-h-0 min-w-0 flex-1 ${
              w.settings.terminalPosition === "side" ? "flex-row" : "flex-col"
            }`}
          >
            <main
              ref={mainRef}
              className="relative min-h-0 min-w-0 flex-1 bg-editor"
            >
              {dropZone && <SplitDropZone side={dropZone} />}
              {w.ready && (
                <div className="hidden">
                  <EditorHost
                    tabs={editorTabs}
                    activeId={active?.kind === "text" ? activeId : ""}
                    shown={visible
                      .filter((t) => t.kind === "text")
                      .map((t) => t.id)}
                    slots={slots}
                    loadContent={w.loadContent}
                    onChange={onEditorChange}
                    onTabPatch={updateTab}
                    onCursor={onCursor}
                    isClosing={w.isClosing}
                    focusSignal={focusSignal}
                    findRequest={w.findRequest}
                    formatRequest={w.formatRequest}
                    convertRequest={w.convertRequest}
                    replaceRequests={w.replaceRequests}
                    shadowUnreadable={w.shadowUnreadable}
                    onFormatResult={onFormatResult}
                    fontSize={w.fontSize}
                    onZoom={w.zoomEditor}
                    lineNumbers={w.settings.lineNumbers}
                    bridgeRef={w.bridgeRef}
                  />
                </div>
              )}
              {w.ready &&
                (split && visible.length === 2 ? (
                  <SplitView
                    orientation={split.orientation}
                    ratio={split.ratio}
                    onRatio={(r) => w.setSplitRatio(split.a, r)}
                    focus={split.focus}
                    first={pane(visible[0])}
                    second={pane(visible[1])}
                  />
                ) : (
                  visible[0] && pane(visible[0])
                ))}
            </main>
            {panelLoaded && (
              <Suspense fallback={null}>
                <TerminalPanel
                  t={terms}
                  position={w.settings.terminalPosition}
                  size={
                    w.settings.terminalPosition === "side"
                      ? w.settings.terminalWidth
                      : w.settings.terminalHeight
                  }
                  onSize={(px) =>
                    w.setSettings(
                      w.settings.terminalPosition === "side"
                        ? { terminalWidth: px }
                        : { terminalHeight: px },
                    )
                  }
                  onPosition={(p) => w.setSettings({ terminalPosition: p })}
                  onNew={plusTerminal}
                  fontSize={w.fontSize}
                  palette={palette}
                  platform={platform}
                  onOpenUrl={(url) =>
                    void openUrl(url).catch(() =>
                      showNotice(`Can't open ${url}`),
                    )
                  }
                  onFocusEditor={refocus}
                />
              </Suspense>
            )}
          </div>
        </div>
        <StatusBar
          line={here.line}
          col={here.col}
          language={active?.language ?? "plaintext"}
          saveStatus={w.saveStatus}
          kindLabel={isCanvas ? "Canvas" : isImage ? "Image" : undefined}
          image={shownImageInfo}
          onPickLanguage={() => (picking ? closePicker() : setPicking(true))}
          platformLineEnding={PLATFORM_ENDING}
          file={
            active?.file
              ? {
                  format: active.file.format,
                  readonly:
                    active.file.held === "readonly" || unreadable || isImage,
                }
              : undefined
          }
          openMenu={formatMenu?.kind ?? null}
          onEncodingMenu={(anchor) =>
            formatMenu?.kind === "encoding"
              ? closeFormatMenu()
              : setFormatMenu({ kind: "encoding", anchor })
          }
          onLineEndingMenu={(anchor) =>
            formatMenu?.kind === "lineEnding"
              ? closeFormatMenu()
              : setFormatMenu({ kind: "lineEnding", anchor })
          }
          showFormat={active?.language === "json"}
          onFormat={w.requestFormat}
          onFormatClose={refocus}
          beautifyHint={BEAUTIFY_HINT}
          notice={w.notice ?? undefined}
          onSettings={() => setSettingsOpen(true)}
          settingsHint={SETTINGS_HINT}
          markdownMode={
            active && activeMode
              ? {
                  mode: activeMode,
                  hint: RICH_HINT,
                  onChange: (mode) => {
                    void w.setMarkdownMode(active.id, mode).then(refocus);
                  },
                }
              : undefined
          }
          preview={
            isMarkdown && active && activeMode !== "rich"
              ? {
                  mode: previewMode,
                  hint: PREVIEW_HINT,
                  onChange: (mode) =>
                    w.setPreview(active.id, mode === "edit" ? null : mode),
                }
              : undefined
          }
        />
      </div>
      {settingsOpen && (
        <SettingsDialog
          settings={w.settings}
          fontSize={w.fontSize}
          platform={platform}
          onSettings={w.setSettings}
          onFontSize={w.setFontSize}
          onClose={() => {
            setSettingsOpen(false);
            refocus();
          }}
        />
      )}
      {w.closePrompt && (
        <SaveChangesDialog
          name={w.closePrompt.name}
          onChoose={(choice) => {
            w.answerClosePrompt(choice);
            refocus();
          }}
        />
      )}
      {quickOpen && (
        <QuickOpen
          search={libraryQuickOpen}
          tabs={quickTabs}
          treeLabel={treeLabel}
          platform={platform}
          onClose={closeQuickOpen}
          onActivate={(id) => {
            setQuickOpen(false);
            w.activate(id);
            refocus();
          }}
          onOpen={(entry) => {
            setQuickOpen(false);
            void lib.open(entry).then(refocus);
          }}
        />
      )}
      <LanguagePicker
        open={picking}
        current={active?.language ?? "plaintext"}
        onPick={pickLanguage}
        onClose={closePicker}
        rename={offer}
        onRename={renameToLanguage}
      />
      {tabMenu && (
        <TabContextMenu
          x={tabMenu.x}
          y={tabMenu.y}
          tabId={tabMenu.tabId}
          tabCount={w.state.tabs.length}
          closed={w.state.closed}
          reopenHint={REOPEN_HINT}
          pinned={
            w.state.tabs.find((t) => t.id === tabMenu.tabId)?.pinned ?? false
          }
          onTogglePin={(id) => {
            const tab = w.state.tabs.find((t) => t.id === id);
            if (tab) w.setPinned(id, !tab.pinned);
          }}
          onClose={(id) => void w.closeTab(id)}
          onCloseOthers={(id) =>
            // Pinned Tabs stay open.
            void w.closeTabs(
              w.state.tabs
                .filter((t) => t.id !== id && !t.pinned)
                .map((t) => t.id),
            )
          }
          canCloseAll={w.state.tabs.some((t) => !t.pinned)}
          onCloseAll={() =>
            // Pinned Tabs stay open, as with Close other tabs.
            void w.closeTabs(
              w.state.tabs.filter((t) => !t.pinned).map((t) => t.id),
            )
          }
          canSaveAll={w.state.tabs.some((t) => t.file && inShadow(t.file))}
          onSaveAll={() => void w.saveAll()}
          onReopen={() => void run({ type: "reopenTab" })}
          onReopenEntry={(id) => void w.reopenEntry(id)}
          onDismiss={closeTabMenu}
          splitCandidates={w.state.tabs
            .filter((t) => t.id !== tabMenu.tabId && !splitOf(w.state, t.id))
            .map((t) => ({ id: t.id, title: t.title }))}
          split={(() => {
            const sp =
              tabMenu.tabId === null
                ? undefined
                : splitOf(w.state, tabMenu.tabId);
            return sp && { orientation: sp.orientation };
          })()}
          onSplitWith={(id, other) => w.splitWith(id, other)}
          onUnsplit={w.unsplit}
          onSwap={w.swapSplit}
          onOrientation={w.setSplitOrientation}
          onCloseSplit={w.closeSplit}
        />
      )}
      {formatMenu && active?.file && (
        <FileFormatMenu
          kind={formatMenu.kind}
          anchor={formatMenu.anchor}
          format={active.file.format}
          pending={w.hasPending(active.id)}
          readonly={active.file.held === "readonly"}
          unreadable={unreadable}
          onReopenWithEncoding={() =>
            setEncPicker({ mode: "reopen", id: active.id })
          }
          onConvertTo={() => setEncPicker({ mode: "convert", id: active.id })}
          onConvert={(patch) => {
            w.convert(active.id, patch);
            refocus();
          }}
          onDismiss={closeFormatMenu}
        />
      )}
      {encPicker && pickerTab?.file && (
        <EncodingPicker
          key={`${encPicker.mode}:${encPicker.id}`}
          title={
            encPicker.mode === "reopen" ? "Reopen with encoding" : "Convert to"
          }
          current={pickerTab.file.format.encoding}
          onPick={pickEncoding}
          onClose={closeEncPicker}
        />
      )}
    </div>
  );
}
