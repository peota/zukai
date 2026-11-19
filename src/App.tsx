import { useCallback, useEffect, useMemo, useState } from "react";
import { useWorkspace } from "./app/useWorkspace";
import { detectPlatform, matchShortcut, type Command } from "./app/shortcuts";
import {
  allowsContextMenu,
  blocksBrowserKey,
  isEditorTarget,
} from "./app/browserGuard";
import type { ImageInfo, LanguageId, TabState } from "./model/types";
import { splitOf } from "./model/split";
import { isUnder, revealLabel } from "./ui/libraryEntries";
import { EditorHost } from "./editor/EditorHost";
import { TabPane, useSlots } from "./app/TabPane";
import { SplitView } from "./ui/SplitView";
import type { FormatResult } from "./editor/jsonFormat";
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
import { asFileError } from "./app/files/context";
import { Sidebar } from "./ui/Sidebar";
import { pinnedItems } from "./ui/Pinned";
import { useColorScheme } from "./ui/useColorScheme";
import { SettingsDialog } from "./ui/SettingsDialog";

const platform = detectPlatform();
const keyOf = (p: string) => pathKey(p, platform);
const PLATFORM_ENDING = platform === "windows" ? "crlf" : "lf";
const REOPEN_HINT = platform === "mac" ? "⇧⌘T" : "Ctrl+Shift+T";
const REVEAL_LABEL = revealLabel(platform);
const BEAUTIFY_HINT = platform === "mac" ? "⇧⌥F" : "Shift+Alt+F";
const SETTINGS_HINT = platform === "mac" ? "⌘," : "Ctrl+,";
const PREVIEW_HINT = platform === "mac" ? "⇧⌘V" : "Ctrl+Shift+V";

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
  const run = useCallback(
    async (cmd: Command) => {
      if (cmd.type === "openSettings") setSettingsOpen(true);
      else await workspaceRun(cmd);
    },
    [workspaceRun],
  );
  const [focusSignal, setFocusSignal] = useState(0);
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
      const cmd = matchShortcut(e, platform);
      if (cmd) {
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
  /** A Markdown Tab's preview; any other Tab is just edited. */
  const previewMode = (isMarkdown && active?.preview) || "edit";
  const theme = useColorScheme(w.settings.theme);
  // The CSS palette follows <html data-theme>.
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);
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

  const { showNotice } = w;
  const onFormatResult = useCallback(
    (r: FormatResult) => {
      if (!r.ok) showNotice(`Invalid JSON at line ${r.line}, col ${r.col}`);
    },
    [showNotice],
  );

  /** Give the keyboard back to the editor. */
  const refocus = useCallback(() => setFocusSignal((n) => n + 1), []);

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
    />
  );

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
        activeId={activeId}
        onOpen={(entry) => void lib.open(entry).then(refocus)}
        onToggle={lib.toggle}
        onCreate={lib.create}
        onRename={lib.rename}
        onMove={(path, dest) => void lib.move(path, dest)}
        onTrash={(path) => void lib.trash(path)}
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
        onPinnedOpen={(id) => {
          if (w.state.tabs.some((t) => t.id === id)) {
            w.activate(id);
            refocus();
          } else {
            // A closed pin comes back as a Tab, still pinned.
            void w.reopenEntry(id).then(refocus);
          }
        }}
        onUnpin={(id) => w.setPinned(id, false)}
        onLeave={refocus}
        platform={platform}
      />
      <div className="flex h-full min-w-0 flex-1 flex-col" data-z-workspace="">
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
          }))}
          onActivate={w.activate}
          onClose={(id) => void w.closeTab(id)}
          onNew={() => void run({ type: "newTab" })}
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
        />
        <main className="min-h-0 flex-1 bg-editor">
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
          preview={
            isMarkdown && active
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
          onCloseOthers={(id) => {
            // Pinned Tabs stay open.
            for (const t of w.state.tabs) {
              if (t.id !== id && !t.pinned) void w.closeTab(t.id);
            }
          }}
          canCloseAll={w.state.tabs.some((t) => !t.pinned)}
          onCloseAll={() => {
            // Pinned Tabs stay open, as with Close other tabs.
            for (const t of w.state.tabs) {
              if (!t.pinned) void w.closeTab(t.id);
            }
          }}
          onReopen={() => void run({ type: "reopenTab" })}
          onReopenEntry={(id) => void w.reopenEntry(id)}
          onDismiss={closeTabMenu}
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
