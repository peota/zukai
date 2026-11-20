import { useRef } from "react";
import type { KeyboardEvent, PointerEvent } from "react";
import type { Platform } from "../app/shortcuts";
import {
  clampTerminalSize,
  TERMINAL_MIN_HEIGHT,
  TERMINAL_MIN_WIDTH,
  type TerminalPosition,
} from "../model/settings";
import { CloseIcon, Icon, type IconName } from "../ui/icons";
import { tabLabels } from "./labels";
import { TerminalView } from "./TerminalView";
import type { useTerminals } from "./useTerminals";
import type { Palette } from "./xtermTheme";

export interface TerminalPanelProps {
  t: ReturnType<typeof useTerminals>;
  position: TerminalPosition;
  /** The height at the bottom, or the width at the side, in px. */
  size: number;
  onSize(px: number): void;
  onPosition(p: TerminalPosition): void;
  /** The + button: a new terminal (App picks the folder). */
  onNew(): void;
  fontSize: number;
  palette: Palette;
  platform: Platform;
  onOpenUrl(url: string): void;
  /** Give the keyboard back to the editor (the panel hid). */
  onFocusEditor(): void;
}

/** The arrow keys' step, in px. */
const KEY_STEP = 16;

/**
 * The panel's drag edge: its top at the bottom, its left at the side. It
 * looks like the Split divider.
 */
function ResizeEdge({
  bottom,
  size,
  onSize,
}: {
  bottom: boolean;
  size: number;
  onSize(px: number): void;
}) {
  const press = useRef<{ pointerId: number; at: number; size: number } | null>(
    null,
  );
  const min = bottom ? TERMINAL_MIN_HEIGHT : TERMINAL_MIN_WIDTH;
  /** The window's height, or the workspace's width. */
  const available = (el: HTMLElement) =>
    bottom
      ? window.innerHeight
      : el.closest<HTMLElement>("[data-z-workspace]")?.clientWidth ||
        window.innerWidth;
  const clamp = (el: HTMLElement, px: number) =>
    clampTerminalSize(px, min, available(el));

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    e.preventDefault();
    press.current = {
      pointerId: e.pointerId,
      at: bottom ? e.clientY : e.clientX,
      size,
    };
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      // No capture: moves over the edge still resize.
    }
  };
  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    const p = press.current;
    if (!p || p.pointerId !== e.pointerId) return;
    if ((e.buttons & 1) === 0) {
      press.current = null; // the release was missed
      return;
    }
    // Dragging up (or left) makes the panel bigger.
    const delta = p.at - (bottom ? e.clientY : e.clientX);
    onSize(clamp(e.currentTarget, p.size + delta));
  };
  const end = (e: PointerEvent<HTMLDivElement>) => {
    if (press.current?.pointerId === e.pointerId) press.current = null;
  };
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const [grow, shrink] = bottom
      ? ["ArrowUp", "ArrowDown"]
      : ["ArrowLeft", "ArrowRight"];
    const step = e.key === grow ? KEY_STEP : e.key === shrink ? -KEY_STEP : 0;
    if (step === 0) return;
    e.preventDefault();
    onSize(clamp(e.currentTarget, size + step));
  };

  return (
    <div
      className={`relative shrink-0 bg-hairline ${bottom ? "h-px" : "w-px"}`}
    >
      <div
        role="separator"
        aria-label="Resize terminal"
        aria-orientation={bottom ? "horizontal" : "vertical"}
        aria-valuenow={size}
        title="Drag to resize"
        tabIndex={0}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={end}
        onPointerCancel={end}
        onKeyDown={onKeyDown}
        className={`absolute z-10 outline-none hover:bg-accent-soft focus-visible:bg-accent-soft ${
          bottom
            ? "left-0 -top-[3px] right-0 h-[7px] cursor-row-resize"
            : "top-0 -left-[3px] bottom-0 w-[7px] cursor-col-resize"
        }`}
      />
    </div>
  );
}

function HeaderButton({
  label,
  icon,
  onClick,
}: {
  label: string;
  icon: IconName;
  onClick(): void;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      className="flex size-6 shrink-0 items-center justify-center rounded-[5px] text-faint hover:bg-row-hover hover:text-text"
    >
      <Icon name={icon} size={15} />
    </button>
  );
}

/**
 * The terminal panel: a slim header (the terminals' tabs, then New, Kill,
 * Move and Hide) over the active terminal. Its tree is the same in both
 * positions and when hidden, so no terminal is ever remounted.
 */
export function TerminalPanel({
  t,
  position,
  size,
  onSize,
  onPosition,
  onNew,
  fontSize,
  palette,
  platform,
  onOpenUrl,
  onFocusEditor,
}: TerminalPanelProps) {
  const bottom = position === "bottom";
  const { terms, activeId, shown } = t.state;
  const labels = tabLabels(terms.map((x) => x.cwd));

  /** Killing the last terminal hides the panel: the editor takes the keys. */
  const kill = (id: number) => {
    t.kill(id);
    if (terms.length === 1) onFocusEditor();
  };

  return (
    <section
      aria-label="Terminal"
      data-z-terminal-panel=""
      className={`relative flex min-h-0 min-w-0 shrink-0 bg-editor ${bottom ? "flex-col" : "flex-row"}`}
      style={{
        display: shown ? "flex" : "none",
        ...(bottom
          ? { height: size, minHeight: TERMINAL_MIN_HEIGHT, maxHeight: "70vh" }
          : { width: size, minWidth: TERMINAL_MIN_WIDTH, maxWidth: "70%" }),
      }}
    >
      <ResizeEdge bottom={bottom} size={size} onSize={onSize} />
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <div className="flex h-8 shrink-0 select-none items-center gap-2 border-b border-hairline bg-chrome pr-1.5 pl-1.5 text-ui-sm">
          <div
            role="tablist"
            aria-label="Terminals"
            className="z-no-scrollbar flex min-w-0 flex-1 items-center gap-0.5 overflow-x-auto"
          >
            {terms.map((x, i) => {
              const active = x.id === activeId;
              const exited = x.exited !== undefined;
              const [name, ...rest] = labels[i].split(" · ");
              return (
                <div
                  key={x.id}
                  role="tab"
                  aria-selected={active}
                  data-exited={exited ? "" : undefined}
                  title={x.cwd}
                  onClick={() => t.activate(x.id)}
                  onMouseDown={(e) => {
                    if (e.button === 1) e.preventDefault(); // no autoscroll
                  }}
                  onAuxClick={(e) => {
                    if (e.button === 1) kill(x.id);
                  }}
                  className={
                    "group flex h-6 max-w-[200px] shrink-0 cursor-default items-center gap-1.5 rounded-[5px] pr-0.5 pl-2 " +
                    (active
                      ? "bg-editor text-text"
                      : "text-muted hover:bg-row-hover hover:text-text") +
                    (exited ? " opacity-60" : "")
                  }
                >
                  <Icon
                    name="shell"
                    size={13}
                    className={active && !exited ? "text-accent" : "text-faint"}
                  />
                  <span className="min-w-0 truncate">
                    {name}
                    {rest.length > 0 && (
                      <span className="text-faint">{` · ${rest.join(" · ")}`}</span>
                    )}
                  </span>
                  <button
                    type="button"
                    aria-label={`Kill ${labels[i]}`}
                    title="Kill terminal"
                    tabIndex={-1}
                    onClick={(e) => {
                      e.stopPropagation();
                      kill(x.id);
                    }}
                    className={
                      "flex size-5 shrink-0 items-center justify-center rounded-[4px] text-faint hover:bg-row-sel hover:text-text " +
                      (active ? "" : "opacity-0 group-hover:opacity-100")
                    }
                  >
                    <CloseIcon size={12} />
                  </button>
                </div>
              );
            })}
          </div>
          <div className="flex shrink-0 items-center gap-0.5">
            <HeaderButton label="New terminal" icon="plus" onClick={onNew} />
            <HeaderButton
              label="Kill terminal"
              icon="trash"
              onClick={() => {
                if (activeId !== null) kill(activeId);
              }}
            />
            <HeaderButton
              label={bottom ? "Move to side" : "Move to bottom"}
              icon={bottom ? "panelRight" : "panelBottom"}
              onClick={() => onPosition(bottom ? "side" : "bottom")}
            />
            <HeaderButton
              label="Hide panel"
              icon={bottom ? "chevronDown" : "chevronRight"}
              onClick={() => {
                t.hide();
                onFocusEditor();
              }}
            />
          </div>
        </div>
        <div className="relative min-h-0 flex-1">
          <div className="absolute inset-0 py-1 pr-1 pl-2">
            {terms.map((x) => (
              <TerminalView
                key={x.id}
                id={x.id}
                visible={shown && x.id === activeId}
                exited={x.exited}
                fontSize={fontSize}
                palette={palette}
                platform={platform}
                onData={(d) => t.write(x.id, d)}
                register={t.register}
                onClose={() => kill(x.id)}
                onOpenUrl={onOpenUrl}
              />
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
