import { useCallback, useEffect, useState } from "react";
import { useWorkspace } from "./app/useWorkspace";
import { detectPlatform, matchShortcut } from "./app/shortcuts";
import {
  allowsContextMenu,
  blocksBrowserKey,
  isEditorTarget,
} from "./app/browserGuard";
import type { LanguageId } from "./model/types";
import { EditorHost } from "./editor/EditorHost";
import type { FormatResult } from "./editor/jsonFormat";
import { TabBar } from "./ui/TabBar";
import { StatusBar } from "./ui/StatusBar";
import { LanguagePicker } from "./ui/LanguagePicker";
import { FileBar } from "./ui/FileBar";
import { TabContextMenu } from "./ui/TabContextMenu";
import { FileFormatMenu } from "./ui/FileFormatMenu";
import { EncodingPicker } from "./ui/EncodingPicker";
import { convertPatch } from "./ui/encodings";
import { folderHints } from "./ui/tabFolders";
import { pathKey } from "./files/api";
import { Sidebar } from "./ui/Sidebar";

const platform = detectPlatform();
const keyOf = (p: string) => pathKey(p, platform);
const PLATFORM_ENDING = platform === "windows" ? "crlf" : "lf";
const REOPEN_HINT = platform === "mac" ? "⇧⌘T" : "Ctrl+Shift+T";
const BEAUTIFY_HINT = platform === "mac" ? "⇧⌥F" : "Shift+Alt+F";

interface Cursor {
  id: string;
  line: number;
  col: number;
}

export default function App() {
  const w = useWorkspace();
  const { run, updateTab } = w;
  const activeId = w.state.activeId;
  const [cursor, setCursor] = useState<Cursor | null>(null);
  const [picking, setPicking] = useState(false);
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

  const pickLanguage = useCallback(
    (language: LanguageId) => {
      if (activeId) updateTab(activeId, { language, languagePicked: true });
      closePicker();
    },
    [activeId, updateTab, closePicker],
  );

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

  const lib = w.library;

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
        inbox={lib.inbox}
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
        onInboxActivate={(id) => {
          w.activate(id);
          refocus();
        }}
        onInboxMove={(id, dest) => void lib.inboxMove(id, dest)}
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
        />
        {active && (
          <FileBar
            key={active.id}
            tab={active}
            unreadable={unreadable}
            onKeepMine={() => void w.keepMine(active.id)}
            onLoadDisk={() => void w.loadDiskVersion(active.id)}
            onSaveAs={() => void w.saveAs(active.id)}
            onSaveToOriginal={() => void w.saveToOriginal(active.id)}
            onReopenWithEncoding={() =>
              setEncPicker({ mode: "reopen", id: active.id })
            }
            onConvertToUtf8={() =>
              w.convert(active.id, { encoding: "utf-8", bom: false })
            }
          />
        )}
        <main className="min-h-0 flex-1 bg-editor">
          {w.ready && (
            <EditorHost
              tabs={w.state.tabs}
              activeId={activeId}
              loadContent={w.loadContent}
              onChange={w.setContent}
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
            />
          )}
        </main>
        <StatusBar
          line={here.line}
          col={here.col}
          language={active?.language ?? "plaintext"}
          saveStatus={w.saveStatus}
          onPickLanguage={() => (picking ? closePicker() : setPicking(true))}
          platformLineEnding={PLATFORM_ENDING}
          file={
            active?.file
              ? {
                  format: active.file.format,
                  readonly: active.file.held === "readonly" || unreadable,
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
        />
      </div>
      <LanguagePicker
        open={picking}
        current={active?.language ?? "plaintext"}
        onPick={pickLanguage}
        onClose={closePicker}
      />
      {tabMenu && (
        <TabContextMenu
          x={tabMenu.x}
          y={tabMenu.y}
          tabId={tabMenu.tabId}
          tabCount={w.state.tabs.length}
          closed={w.state.closed}
          reopenHint={REOPEN_HINT}
          onClose={(id) => void w.closeTab(id)}
          onCloseOthers={(id) => {
            for (const t of w.state.tabs) {
              if (t.id !== id) void w.closeTab(t.id);
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
