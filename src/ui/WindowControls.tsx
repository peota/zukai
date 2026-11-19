import { useEffect, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import type { Platform } from "../app/shortcuts";

/**
 * Minimize, maximize/restore and close, drawn in Zukai's own chrome now
 * that the window has no native title bar. Windows gets its caption
 * buttons (46px wide, a red close); Linux gets round GNOME-style ones;
 * macOS keeps its native traffic lights, so this draws nothing there.
 */
export function WindowControls({ platform }: { platform: Platform }) {
  const maximized = useMaximized();
  if (platform === "mac") return null;

  const win = () => getCurrentWindow();
  const minimize = () => void win().minimize();
  const toggle = () => void win().toggleMaximize();
  // close() goes through onCloseRequested, so pending saves still flush.
  const close = () => void win().close();
  const sizeLabel = maximized ? "Restore" : "Maximize";

  if (platform === "windows") {
    const button =
      "flex h-11 w-[46px] items-center justify-center text-muted hover:bg-row-sel hover:text-text";
    return (
      <div className="flex shrink-0 self-start" data-window-controls="">
        <button
          type="button"
          tabIndex={-1}
          aria-label="Minimize"
          title="Minimize"
          onClick={minimize}
          className={button}
        >
          <Glyph d="M0.5 5.5h10" />
        </button>
        <button
          type="button"
          tabIndex={-1}
          aria-label={sizeLabel}
          title={sizeLabel}
          onClick={toggle}
          className={button}
        >
          {maximized ? (
            <Glyph d="M2.5 2.5v-2h8v8h-2M0.5 2.5h8v8h-8z" />
          ) : (
            <Glyph d="M0.5 0.5h10v10h-10z" />
          )}
        </button>
        <button
          type="button"
          tabIndex={-1}
          aria-label="Close"
          title="Close"
          onClick={close}
          className="flex h-11 w-[46px] items-center justify-center text-muted hover:bg-[#c42b1c] hover:text-white"
        >
          <Glyph d="M0.5 0.5l10 10M10.5 0.5l-10 10" />
        </button>
      </div>
    );
  }

  const round =
    "flex size-6 items-center justify-center rounded-full bg-row-hover text-muted hover:bg-row-sel hover:text-text";
  return (
    <div
      className="flex h-11 shrink-0 items-center gap-2.5 self-start px-3"
      data-window-controls=""
    >
      <button
        type="button"
        tabIndex={-1}
        aria-label="Minimize"
        title="Minimize"
        onClick={minimize}
        className={round}
      >
        <Glyph d="M2.5 5.5h6" />
      </button>
      <button
        type="button"
        tabIndex={-1}
        aria-label={sizeLabel}
        title={sizeLabel}
        onClick={toggle}
        className={round}
      >
        {maximized ? (
          <Glyph d="M3.5 3.5h4v4h-4z" />
        ) : (
          <Glyph d="M2.5 2.5h6v6h-6z" />
        )}
      </button>
      <button
        type="button"
        tabIndex={-1}
        aria-label="Close"
        title="Close"
        onClick={close}
        className={round}
      >
        <Glyph d="M3 3l5 5M8 3l-5 5" />
      </button>
    </div>
  );
}

/** An 11px caption glyph on a 1px stroke, like the system's own. */
function Glyph({ d }: { d: string }) {
  return (
    <svg
      width="11"
      height="11"
      viewBox="0 0 11 11"
      fill="none"
      stroke="currentColor"
      strokeWidth="1"
      aria-hidden="true"
    >
      <path d={d} />
    </svg>
  );
}

/** Whether the window is maximized, kept current as it resizes. */
function useMaximized(): boolean {
  const [maximized, setMaximized] = useState(false);
  useEffect(() => {
    let live = true;
    let unlisten: (() => void) | undefined;
    // Outside Tauri (tests) there is no window; the buttons still render.
    let win: ReturnType<typeof getCurrentWindow>;
    try {
      win = getCurrentWindow();
    } catch {
      return;
    }
    const check = () =>
      win
        .isMaximized()
        .then((m) => live && setMaximized(Boolean(m)))
        .catch(() => {});
    check();
    win
      .onResized(check)
      .then((u) => {
        if (live) unlisten = u;
        else u();
      })
      .catch(() => {});
    return () => {
      live = false;
      unlisten?.();
    };
  }, []);
  return maximized;
}
