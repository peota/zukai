import { render } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => {
  const state = {
    term: null as null | {
      write: ReturnType<typeof vi.fn>;
      options: Record<string, unknown>;
      emitData(d: string): void;
      keyHandler: ((e: unknown) => boolean) | null;
      disposed: boolean;
      opened: boolean;
    },
  };
  return state;
});

vi.mock("@xterm/xterm/css/xterm.css", () => ({}));
vi.mock("@xterm/xterm", () => ({
  Terminal: class {
    cols = 80;
    rows = 24;
    write = vi.fn();
    options: Record<string, unknown>;
    dataCb: ((d: string) => void) | null = null;
    keyHandler: ((e: unknown) => boolean) | null = null;
    disposed = false;
    opened = false;
    constructor(opts: Record<string, unknown>) {
      this.options = { ...opts };
      h.term = this as never;
    }
    loadAddon() {}
    open() {
      this.opened = true;
    }
    focus() {}
    hasSelection() {
      return false;
    }
    getSelection() {
      return "";
    }
    clearSelection() {}
    paste() {}
    onData(cb: (d: string) => void) {
      this.dataCb = cb;
      return { dispose() {} };
    }
    emitData(d: string) {
      this.dataCb?.(d);
    }
    attachCustomKeyEventHandler(fn: (e: unknown) => boolean) {
      this.keyHandler = fn;
    }
    dispose() {
      this.disposed = true;
    }
  },
}));
vi.mock("@xterm/addon-fit", () => ({
  FitAddon: class {
    fit() {}
  },
}));
vi.mock("@xterm/addon-web-links", () => ({
  WebLinksAddon: class {},
}));
vi.mock("./api", () => ({ terminalResize: vi.fn(), terminalAck: vi.fn() }));

import * as api from "./api";
import { TerminalView } from "./TerminalView";

function props(over: Record<string, unknown> = {}) {
  return {
    id: 1,
    visible: true,
    exited: undefined as number | null | undefined,
    fontSize: 14,
    palette: "paper" as const,
    platform: "windows" as const,
    onData: vi.fn(),
    register: vi.fn(() => () => {}),
    onClose: vi.fn(),
    onOpenUrl: vi.fn(),
    ...over,
  };
}

beforeEach(() => {
  h.term = null;
  globalThis.ResizeObserver = class {
    observe() {}
    disconnect() {}
    unobserve() {}
  } as never;
});

describe("TerminalView", () => {
  it("forwardsTypedDataToOnData", () => {
    const p = props();
    render(<TerminalView {...p} />);
    h.term!.emitData("ls\r");
    expect(p.onData).toHaveBeenCalledWith("ls\r");
    expect(p.register).toHaveBeenCalledWith(1, expect.any(Function));
  });

  it("registersOnlyOnceOpenedAndUnregistersOnUnmount", () => {
    const unregister = vi.fn();
    let openedAtRegister: boolean | undefined;
    const p = props({
      register: vi.fn(() => {
        openedAtRegister = h.term?.opened;
        return unregister;
      }),
    });
    const r = render(<TerminalView {...p} />);
    // Replayed output is written to an xterm that's already open.
    expect(openedAtRegister).toBe(true);
    expect(unregister).not.toHaveBeenCalled();
    r.unmount();
    expect(unregister).toHaveBeenCalledTimes(1);
  });

  it("acksOutputOnceXtermHasParsedIt", () => {
    let sink: ((e: unknown) => void) | null = null;
    const p = props({
      register: vi.fn((_id: number, s: (e: unknown) => void) => {
        sink = s;
        return () => {};
      }),
    });
    vi.mocked(api.terminalAck).mockClear();
    render(<TerminalView {...p} />);
    sink!({ kind: "data", data: "héllo \u{1F600}" });
    const [data, parsed] = h.term!.write.mock.calls[0];
    expect(data).toBe("héllo \u{1F600}");
    // Nothing is acked until xterm calls back.
    expect(api.terminalAck).not.toHaveBeenCalled();
    (parsed as () => void)();
    // In UTF-16 code units, as the backend counts.
    expect(api.terminalAck).toHaveBeenCalledWith(1, 8);
  });

  it("exitedTerminalClosesOnAnyKey", () => {
    const p = props({ exited: 0 });
    render(<TerminalView {...p} />);
    expect(h.term!.write).toHaveBeenCalledWith(
      "\r\n\x1b[2mProcess exited with code 0\x1b[0m\r\n",
    );
    h.term!.keyHandler!({ type: "keydown", key: "a" });
    expect(p.onClose).toHaveBeenCalled();
  });

  it("appKeysAreNotSentToShell", () => {
    render(<TerminalView {...props()} />);
    const r = h.term!.keyHandler!({
      type: "keydown",
      key: "`",
      code: "Backquote",
      ctrlKey: true,
      metaKey: false,
      altKey: false,
      shiftKey: false,
    });
    expect(r).toBe(false);
  });

  it("fontSizeChangeUpdatesOptions", () => {
    const p = props();
    const { rerender } = render(<TerminalView {...p} />);
    rerender(<TerminalView {...p} fontSize={18} />);
    expect(h.term!.options.fontSize).toBe(18);
  });

  it("reThemesWhenTheRootThemeAttributesChange", async () => {
    const root = document.documentElement;
    root.style.setProperty("--z-editor", "#111111");
    render(<TerminalView {...props()} />);
    expect((h.term!.options.theme as { background: string }).background).toBe(
      "#111111",
    );
    root.style.setProperty("--z-editor", "#222222");
    root.setAttribute("data-accent", "violet");
    await Promise.resolve();
    expect((h.term!.options.theme as { background: string }).background).toBe(
      "#222222",
    );
    root.removeAttribute("data-accent");
    root.style.removeProperty("--z-editor");
  });
});
