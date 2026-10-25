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
import { TabBar } from "./ui/TabBar";
import { StatusBar } from "./ui/StatusBar";
import { LanguagePicker } from "./ui/LanguagePicker";

const platform = detectPlatform();

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

  const onCursor = useCallback(
    (line: number, col: number) => setCursor({ id: activeId, line, col }),
    [activeId],
  );

  const closePicker = useCallback(() => {
    setPicking(false);
    setFocusSignal((n) => n + 1);
  }, []);

  const pickLanguage = useCallback(
    (language: LanguageId) => {
      if (activeId) updateTab(activeId, { language, languagePicked: true });
      closePicker();
    },
    [activeId, updateTab, closePicker],
  );

  return (
    <div className="relative flex h-full flex-col bg-chrome text-text">
      <TabBar
        tabs={w.state.tabs.map((t) => ({
          id: t.id,
          title: t.title,
          active: t.id === activeId,
        }))}
        onActivate={w.activate}
        onClose={(id) => void w.closeTab(id)}
        onNew={() => void run({ type: "newTab" })}
        onMove={w.moveTab}
        onRename={(id, name) => void w.rename(id, name)}
      />
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
          />
        )}
      </main>
      <StatusBar
        line={here.line}
        col={here.col}
        language={active?.language ?? "plaintext"}
        saveStatus={w.saveStatus}
        onPickLanguage={() => (picking ? closePicker() : setPicking(true))}
      />
      <LanguagePicker
        open={picking}
        current={active?.language ?? "plaintext"}
        onPick={pickLanguage}
        onClose={closePicker}
      />
    </div>
  );
}
