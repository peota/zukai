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
    constructor(opts: Record<string, unknown>) {
      this.options = { ...opts };
      h.term = this as never;
    }
    loadAddon() {}
    open() {}
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
vi.mock("./api", () => ({ terminalResize: vi.fn() }));

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
    register: vi.fn(),
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
});
