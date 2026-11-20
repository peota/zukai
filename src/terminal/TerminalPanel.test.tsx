import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { useTerminals } from "./useTerminals";
import type { TermState } from "./model";

const h = vi.hoisted(() => ({ constructed: 0 }));

vi.mock("@xterm/xterm/css/xterm.css", () => ({}));
vi.mock("@xterm/xterm", () => ({
  Terminal: class {
    cols = 80;
    rows = 24;
    options: Record<string, unknown> = {};
    constructor() {
      h.constructed++;
    }
    loadAddon() {}
    open() {}
    focus() {}
    write() {}
    hasSelection() {
      return false;
    }
    onData() {
      return { dispose() {} };
    }
    attachCustomKeyEventHandler() {}
    dispose() {}
  },
}));
vi.mock("@xterm/addon-fit", () => ({
  FitAddon: class {
    fit() {}
  },
}));
vi.mock("@xterm/addon-web-links", () => ({ WebLinksAddon: class {} }));
vi.mock("./api", () => ({
  terminalOpen: vi.fn(),
  terminalWrite: vi.fn(),
  terminalResize: vi.fn(async () => {}),
  terminalKill: vi.fn(async () => {}),
}));

import { TerminalPanel, type TerminalPanelProps } from "./TerminalPanel";

type T = ReturnType<typeof useTerminals>;

function fakeT(state: Partial<TermState> = {}): T {
  return {
    state: {
      terms: [{ id: 7, cwd: "C:\\L\\proj", exited: undefined }],
      activeId: 7,
      shown: true,
      ...state,
    },
    open: vi.fn(async () => {}),
    kill: vi.fn(),
    activate: vi.fn(),
    show: vi.fn(),
    hide: vi.fn(),
    write: vi.fn(),
    register: vi.fn(),
  };
}

function props(over: Partial<TerminalPanelProps> = {}): TerminalPanelProps {
  return {
    t: fakeT(),
    position: "bottom",
    size: 280,
    onSize: vi.fn(),
    onPosition: vi.fn(),
    onNew: vi.fn(),
    fontSize: 14,
    palette: "paper",
    platform: "windows",
    onOpenUrl: vi.fn(),
    onFocusEditor: vi.fn(),
    ...over,
  };
}

beforeEach(() => {
  h.constructed = 0;
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as never;
});

describe("TerminalPanel", () => {
  it("positionSwitchKeepsTerminalMounted", () => {
    const p = props();
    const r = render(<TerminalPanel {...p} />);
    expect(h.constructed).toBe(1);
    fireEvent.click(screen.getByRole("button", { name: "Move to side" }));
    expect(p.onPosition).toHaveBeenCalledWith("side");

    r.rerender(<TerminalPanel {...p} position="side" />);
    expect(screen.getByRole("button", { name: "Move to bottom" })).toBeTruthy();
    expect(h.constructed).toBe(1);

    const hidden = {
      ...p,
      position: "side" as const,
      t: fakeT({ shown: false }),
    };
    r.rerender(<TerminalPanel {...hidden} />);
    const panel = r.container.firstElementChild as HTMLElement;
    expect(panel.style.display).toBe("none");
    r.rerender(<TerminalPanel {...p} position="side" />);
    expect(panel.style.display).not.toBe("none");
    expect(h.constructed).toBe(1);
  });

  it("headerButtonsKillAndHide", () => {
    const p = props();
    render(<TerminalPanel {...p} />);
    fireEvent.click(screen.getByRole("button", { name: "Kill terminal" }));
    expect(p.t.kill).toHaveBeenCalledWith(7);
    fireEvent.click(screen.getByRole("button", { name: "Hide panel" }));
    expect(p.t.hide).toHaveBeenCalled();
    expect(p.onFocusEditor).toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "New terminal" }));
    expect(p.onNew).toHaveBeenCalled();
  });

  it("tabs activate, and × or middle-click kills", () => {
    const t = fakeT({
      terms: [
        { id: 1, cwd: "C:\\a\\docs", exited: undefined },
        { id: 2, cwd: "C:\\b\\docs", exited: 0 },
      ],
      activeId: 1,
    });
    render(<TerminalPanel {...props({ t })} />);
    const tabs = screen.getAllByRole("tab");
    expect(tabs.map((el) => el.textContent)).toEqual(["docs · a", "docs · b"]);
    expect(tabs[0]).toHaveAttribute("aria-selected", "true");
    expect(tabs[1]).toHaveAttribute("data-exited", "");
    fireEvent.click(tabs[1]);
    expect(t.activate).toHaveBeenCalledWith(2);
    fireEvent(
      tabs[1],
      new MouseEvent("auxclick", { bubbles: true, button: 1 }),
    );
    expect(t.kill).toHaveBeenCalledWith(2);
    fireEvent.click(screen.getByRole("button", { name: "Kill docs · a" }));
    expect(t.kill).toHaveBeenCalledWith(1);
  });

  it("the top edge resizes at the bottom, clamped to the window", () => {
    const p = props();
    render(<TerminalPanel {...p} />);
    const edge = screen.getByRole("separator", { name: "Resize terminal" });
    fireEvent.pointerDown(edge, { button: 0, pointerId: 1, clientY: 500 });
    fireEvent.pointerMove(edge, { pointerId: 1, buttons: 1, clientY: 400 });
    expect(p.onSize).toHaveBeenLastCalledWith(380);
    fireEvent.pointerMove(edge, { pointerId: 1, buttons: 1, clientY: 5000 });
    expect(p.onSize).toHaveBeenLastCalledWith(120);
  });
});
