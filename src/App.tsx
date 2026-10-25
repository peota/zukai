import { useEffect, useState } from "react";
import type { SyntheticEvent } from "react";
import { useWorkspace } from "./app/useWorkspace";
import { detectPlatform, matchShortcut } from "./app/shortcuts";
import { TabBar } from "./ui/TabBar";
import { StatusBar } from "./ui/StatusBar";

const platform = detectPlatform();

interface Cursor {
  id: string;
  line: number;
  col: number;
}

function cursorOf(el: HTMLTextAreaElement, id: string): Cursor {
  const before = el.value.slice(0, el.selectionEnd);
  const lineStart = before.lastIndexOf("\n") + 1;
  return {
    id,
    line: before.split("\n").length,
    col: before.length - lineStart + 1,
  };
}

export default function App() {
  const w = useWorkspace();
  const { run } = w;
  const [cursor, setCursor] = useState<Cursor | null>(null);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const cmd = matchShortcut(e, platform);
      if (!cmd) return;
      e.preventDefault();
      void run(cmd);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [run]);

  const active = w.state.tabs.find((t) => t.id === w.state.activeId);
  const text = active ? w.contentOf(active.id) : undefined;
  const here =
    active && cursor?.id === active.id ? cursor : { line: 1, col: 1 };

  const trackCursor = (e: SyntheticEvent<HTMLTextAreaElement>) => {
    if (active) setCursor(cursorOf(e.currentTarget, active.id));
  };

  return (
    <div className="flex h-full flex-col bg-chrome text-text">
      <TabBar
        tabs={w.state.tabs.map((t) => ({
          id: t.id,
          title: t.title,
          active: t.id === w.state.activeId,
        }))}
        onActivate={w.activate}
        onClose={(id) => void w.closeTab(id)}
        onNew={() => void run({ type: "newTab" })}
        onMove={w.moveTab}
        onRename={(id, name) => void w.rename(id, name)}
      />
      <main className="min-h-0 flex-1 bg-editor">
        {active && text !== undefined && (
          // Placeholder editor; Task 10 replaces it with CodeMirror.
          <textarea
            key={active.id}
            autoFocus
            spellCheck={false}
            wrap={active.wrap ? "soft" : "off"}
            value={text}
            onChange={(e) => {
              w.setContent(active.id, e.target.value);
              trackCursor(e);
            }}
            onSelect={trackCursor}
            className="z-editor-font block size-full resize-none bg-editor px-6 py-4 text-text outline-none"
          />
        )}
      </main>
      <StatusBar
        line={here.line}
        col={here.col}
        language={active?.language ?? "plaintext"}
        saveStatus={w.saveStatus}
        onPickLanguage={() => {}}
      />
    </div>
  );
}
