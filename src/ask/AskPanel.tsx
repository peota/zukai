import { useEffect, useMemo, useRef, useState } from "react";
import type { KeyboardEvent, MouseEvent, PointerEvent } from "react";
import { linkKind, renderMarkdown } from "../markdown/render";
import { ASK_MIN_WIDTH, clampTerminalSize } from "../model/settings";
import { CloseIcon, Icon } from "../ui/icons";
import type { Turn } from "./conversation";
import type { UseAsk } from "./useAsk";
import "./ask.css";

export interface AskPanelProps {
  ask: UseAsk;
  /** The scope chip's text ("This note · a.md"), or null with no note. */
  scopeLabel: string | null;
  /** Where questions go, e.g. "Anthropic · claude-sonnet-5-5". */
  providerLabel: string;
  /** The panel's width in px. */
  width: number;
  onWidth(px: number): void;
  onClose(): void;
  /** A web or mail link in an answer was clicked: open it outside the app. */
  onOpenUrl(url: string): void;
  /** Give the keyboard back to the editor. */
  onFocusEditor(): void;
}

const MESSAGES = {
  noNote: "Ask works on text notes for now.",
  tooLong: "This note is too long to ask about.",
} as const;

/** The arrow keys' step, in px. */
const KEY_STEP = 16;

/** The panel's left edge: drag (or arrow keys) to resize, like the terminal's. */
function ResizeEdge({
  width,
  onWidth,
}: {
  width: number;
  onWidth(px: number): void;
}) {
  const press = useRef<{ pointerId: number; at: number; width: number } | null>(
    null,
  );
  // 70% of the row the panel sits in: the same base as its CSS maxWidth.
  const clamp = (el: HTMLElement, px: number) =>
    clampTerminalSize(
      px,
      ASK_MIN_WIDTH,
      el.closest<HTMLElement>("[data-z-ask-panel]")?.parentElement
        ?.clientWidth || window.innerWidth,
    );

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    e.preventDefault();
    press.current = { pointerId: e.pointerId, at: e.clientX, width };
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
    // Dragging left makes the panel wider.
    onWidth(clamp(e.currentTarget, p.width + p.at - e.clientX));
  };
  const end = (e: PointerEvent<HTMLDivElement>) => {
    if (press.current?.pointerId === e.pointerId) press.current = null;
  };
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const step =
      e.key === "ArrowLeft" ? KEY_STEP : e.key === "ArrowRight" ? -KEY_STEP : 0;
    if (step === 0) return;
    e.preventDefault();
    onWidth(clamp(e.currentTarget, width + step));
  };

  return (
    <div className="relative w-px shrink-0 bg-hairline">
      <div
        role="separator"
        aria-label="Resize Ask panel"
        aria-orientation="vertical"
        aria-valuenow={width}
        title="Drag to resize"
        tabIndex={0}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={end}
        onPointerCancel={end}
        onKeyDown={onKeyDown}
        className="absolute top-0 bottom-0 -left-[3px] z-10 w-[7px] cursor-col-resize outline-none hover:bg-accent-soft focus-visible:bg-accent-soft"
      />
    </div>
  );
}

/** An answer: its Markdown as sanitized HTML, or its error. */
function Answer({
  turn,
  onOpenUrl,
}: {
  turn: Turn;
  onOpenUrl(url: string): void;
}) {
  const html = useMemo(() => renderMarkdown(turn.text), [turn.text]);
  const onClick = (e: MouseEvent<HTMLDivElement>) => {
    const a = (e.target as Element).closest?.("a");
    if (!a || !e.currentTarget.contains(a)) return;
    // Never navigate the app's own page.
    e.preventDefault();
    const href = a.getAttribute("href") ?? "";
    if (linkKind(href) === "web") onOpenUrl(href.trim());
  };
  return (
    <div className="z-ask-answer">
      {turn.text && (
        <div
          className="z-md"
          onClick={onClick}
          // Rendered from the provider's answer and sanitized (render.ts).
          dangerouslySetInnerHTML={{ __html: html }}
        />
      )}
      {turn.error && (
        <p className="mt-1 text-ui-sm text-danger" role="alert">
          {turn.error}
        </p>
      )}
    </div>
  );
}

/**
 * The Ask panel: a slim header (the scope, New conversation and ×), the
 * conversation, and the question box. It docks on the right of the editor
 * area.
 */
export function AskPanel({
  ask,
  scopeLabel,
  providerLabel,
  width,
  onWidth,
  onClose,
  onOpenUrl,
  onFocusEditor,
}: AskPanelProps) {
  const { conversation, send, stop, clear } = ask;
  const streaming = conversation.streaming !== null;
  const [text, setText] = useState("");
  const [message, setMessage] = useState<keyof typeof MESSAGES | null>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const turnsRef = useRef<HTMLDivElement>(null);

  useEffect(() => input.current?.focus(), []);

  // Follow the answer as it streams in.
  const last = conversation.turns[conversation.turns.length - 1];
  useEffect(() => {
    const el = turnsRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [conversation.turns.length, last?.text, last?.error]);

  /**
   * What a screen reader hears: the status while asking, then the finished
   * answer once, never each streamed chunk.
   */
  const announce = streaming
    ? `Asking ${providerLabel}…`
    : last?.role === "assistant"
      ? (last.error ?? last.text)
      : "";

  const submit = () => {
    const q = text.trim();
    if (!q) return;
    const r = send(q);
    if (r === "sent") {
      setText("");
      setMessage(null);
    } else if (r === "noNote" || r === "tooLong") {
      setMessage(r);
    }
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      submit();
    } else if (e.key === "Escape") {
      e.preventDefault();
      onFocusEditor();
    }
  };

  return (
    <section
      aria-label="Ask"
      data-z-ask-panel=""
      className="z-ask relative flex min-h-0 min-w-0 shrink-0 flex-row bg-editor"
      style={{ width, minWidth: ASK_MIN_WIDTH, maxWidth: "70%" }}
    >
      <ResizeEdge width={width} onWidth={onWidth} />
      <div className="sr-only" aria-live="polite">
        {announce}
      </div>
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <div className="flex h-9 shrink-0 select-none items-center gap-2 border-b border-hairline bg-chrome pr-1.5 pl-3 text-ui-sm">
          <span className="shrink-0 font-semibold text-text">Ask</span>
          <span
            className="min-w-0 truncate rounded-[5px] bg-sunken px-1.5 py-0.5 text-ui-xs text-muted"
            title={scopeLabel ?? undefined}
          >
            {scopeLabel ?? "No note"}
          </span>
          <div className="ml-auto flex shrink-0 items-center gap-0.5">
            <button
              type="button"
              aria-label="New conversation"
              title="New conversation"
              onClick={() => {
                clear();
                setMessage(null);
                input.current?.focus();
              }}
              className="flex size-6 items-center justify-center rounded-[5px] text-faint hover:bg-row-hover hover:text-text"
            >
              <Icon name="plus" size={15} />
            </button>
            <button
              type="button"
              aria-label="Close Ask panel"
              title="Close"
              onClick={onClose}
              className="flex size-6 items-center justify-center rounded-[5px] text-faint hover:bg-row-hover hover:text-text"
            >
              <CloseIcon size={14} />
            </button>
          </div>
        </div>
        <div
          ref={turnsRef}
          className="min-h-0 flex-1 overflow-y-auto px-3 py-3"
        >
          {conversation.turns.map((t, i) =>
            t.role === "user" ? (
              <p key={i} className="z-ask-question">
                {t.text}
              </p>
            ) : (
              <Answer key={i} turn={t} onOpenUrl={onOpenUrl} />
            ),
          )}
        </div>
        <div className="shrink-0 border-t border-hairline px-3 pt-2 pb-2.5">
          {message && (
            <p className="mb-1.5 text-ui-sm text-danger" role="status">
              {MESSAGES[message]}
            </p>
          )}
          <textarea
            ref={input}
            aria-label="Question"
            placeholder="Ask about this note"
            rows={3}
            value={text}
            onChange={(e) => {
              setText(e.target.value);
              if (message) setMessage(null);
            }}
            onKeyDown={onKeyDown}
            className="block w-full resize-none rounded-[6px] border border-hairline-strong bg-surface px-2 py-1.5 text-ui text-text outline-none placeholder:text-faint focus:border-accent"
          />
          {streaming && (
            <div className="mt-1.5 flex items-center gap-2 text-ui-xs text-faint">
              <span className="min-w-0 flex-1 truncate">{`Asking ${providerLabel}…`}</span>
              <button
                type="button"
                onClick={stop}
                className="shrink-0 rounded-[5px] border border-hairline-strong px-2 py-0.5 text-ui-xs text-muted hover:bg-row-hover hover:text-text"
              >
                Stop
              </button>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
