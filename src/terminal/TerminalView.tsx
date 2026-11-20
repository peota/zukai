import { useEffect, useLayoutEffect, useRef, type MouseEvent } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";
import "@xterm/xterm/css/xterm.css";
import type { Platform } from "../app/shortcuts";
import { terminalResize, type TerminalEvent } from "./api";
import { routeKey } from "./keys";
import { xtermTheme, type Palette } from "./xtermTheme";

export interface TerminalViewProps {
  id: number;
  visible: boolean;
  exited: number | null | undefined;
  fontSize: number;
  palette: Palette;
  platform: Platform;
  onData(data: string): void;
  register(id: number, sink: (e: TerminalEvent) => void): void;
  onClose(): void;
  onOpenUrl(url: string): void;
}

const cssVar = (name: string) =>
  getComputedStyle(document.documentElement).getPropertyValue(name).trim();

export function TerminalView(props: TerminalViewProps) {
  const { visible, exited, fontSize, palette } = props;
  const rootRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const sizeRef = useRef<{ cols: number; rows: number } | null>(null);
  const live = useRef(props);
  useLayoutEffect(() => {
    live.current = props;
  });
  const wroteExit = useRef(false);

  const refit = () => {
    const term = termRef.current;
    const root = rootRef.current;
    if (!term || !root || !live.current.visible) return;
    if (root.clientWidth === 0 && root.clientHeight === 0) return;
    try {
      fitRef.current?.fit();
    } catch {
      return;
    }
    const last = sizeRef.current;
    if (last && last.cols === term.cols && last.rows === term.rows) return;
    sizeRef.current = { cols: term.cols, rows: term.rows };
    void terminalResize(live.current.id, term.cols, term.rows).catch(() => {});
  };

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const term = new Terminal({
      scrollback: 5000,
      fontFamily: cssVar("--z-font-mono") || "monospace",
      fontSize: live.current.fontSize,
      theme: xtermTheme(live.current.palette, cssVar),
    });
    const fit = new FitAddon();
    termRef.current = term;
    fitRef.current = fit;
    term.loadAddon(fit);
    term.loadAddon(new WebLinksAddon((_e, url) => live.current.onOpenUrl(url)));
    // Wired first: ConPTY waits for the cursor-position reply sent here.
    term.onData((d) => live.current.onData(d));
    term.attachCustomKeyEventHandler((e) => {
      if (live.current.exited !== undefined) {
        if (e.type === "keydown") live.current.onClose();
        return false;
      }
      const route = routeKey(e, live.current.platform, term.hasSelection());
      if (route === "shell") return true;
      if (route === "copy" && e.type === "keydown") {
        void navigator.clipboard.writeText(term.getSelection());
        term.clearSelection();
      }
      // Paste is left alone: the native paste reaches xterm's textarea.
      return false;
    });
    live.current.register(live.current.id, (ev) => {
      if (ev.kind === "data") term.write(ev.data);
    });
    term.open(root);
    const ro = new ResizeObserver(refit);
    ro.observe(root);
    refit();
    return () => {
      ro.disconnect();
      term.dispose();
      termRef.current = null;
      fitRef.current = null;
    };
    // The terminal lives as long as the component; props are read via `live`.
  }, []);

  // The app writes data-theme/-palette/-accent on <html> in a parent effect,
  // after this component's effects run, so the tokens are read from an
  // observer (a microtask after the attributes change), not from [palette].
  useEffect(() => {
    const apply = () => {
      const term = termRef.current;
      if (term) {
        term.options.theme = xtermTheme(live.current.palette, cssVar);
      }
    };
    apply();
    const mo = new MutationObserver(apply);
    mo.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-theme", "data-palette", "data-accent"],
    });
    return () => mo.disconnect();
  }, [palette]);

  useEffect(() => {
    const term = termRef.current;
    if (!term) return;
    term.options.fontSize = fontSize;
    refit();
  }, [fontSize]);

  useEffect(() => {
    if (!visible) return;
    refit();
    termRef.current?.focus();
  }, [visible]);

  useEffect(() => {
    if (exited === undefined || wroteExit.current) return;
    wroteExit.current = true;
    termRef.current?.write(
      `\r\n\x1b[2mProcess exited with code ${exited ?? "?"}\x1b[0m\r\n`,
    );
  }, [exited]);

  const onContextMenu = (e: MouseEvent) => {
    e.preventDefault();
    const term = termRef.current;
    if (!term) return;
    if (term.hasSelection()) {
      void navigator.clipboard.writeText(term.getSelection());
      term.clearSelection();
    } else {
      void navigator.clipboard.readText().then((t) => term.paste(t));
    }
  };

  return (
    <div
      ref={rootRef}
      data-z-terminal=""
      onContextMenu={onContextMenu}
      style={{
        width: "100%",
        height: "100%",
        display: visible ? "block" : "none",
      }}
    />
  );
}
