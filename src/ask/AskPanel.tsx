import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { KeyboardEvent, MouseEvent } from "react";
import { linkKind, renderMarkdown } from "../markdown/render";
import { ASK_MIN_WIDTH } from "../model/settings";
import { PanelResizeEdge } from "../ui/PanelResizeEdge";
import { CloseIcon, Icon, fileIcon } from "../ui/icons";
import type { Turn } from "./conversation";
import type { UseAsk } from "./useAsk";
import "./ask.css";

export interface AskPanelProps {
  ask: UseAsk;
  /** The title of the note asked about, or null with no text note open. */
  noteTitle: string | null;
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

/** A finished answer's Copy action; says Copied for a moment. */
function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => setCopied(false), 1500);
    return () => clearTimeout(t);
  }, [copied]);
  return (
    <button
      type="button"
      onClick={() => {
        navigator.clipboard?.writeText(text).then(
          () => setCopied(true),
          () => {},
        );
      }}
      className="z-ask-action"
    >
      <Icon name={copied ? "check" : "copy"} size={13} />
      {copied ? "Copied" : "Copy"}
    </button>
  );
}

/** An answer: its Markdown as sanitized HTML, or its error. */
function Answer({
  turn,
  live,
  onOpenUrl,
}: {
  turn: Turn;
  /** Still streaming in. */
  live: boolean;
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
      {turn.text ? (
        <div
          className="z-md"
          onClick={onClick}
          // Rendered from the provider's answer and sanitized (render.ts).
          dangerouslySetInnerHTML={{ __html: html }}
        />
      ) : (
        live && (
          <span className="z-ask-thinking" aria-hidden="true">
            <span />
            <span />
            <span />
          </span>
        )
      )}
      {turn.error && (
        <p className="z-ask-error" role="alert">
          {turn.error}
        </p>
      )}
      {!live && turn.text && (
        <div className="z-ask-actions">
          <CopyButton text={turn.text} />
        </div>
      )}
    </div>
  );
}

/** What to ask first, offered on an empty conversation. Fills the box only. */
const SUGGESTIONS = [
  "Summarise this note",
  "Walk me through it step by step",
  "What's unclear or missing here?",
];

function EmptyState({
  hasNote,
  onPick,
}: {
  hasNote: boolean;
  onPick(q: string): void;
}) {
  return (
    <div className="z-ask-empty">
      <div className="z-ask-orb" aria-hidden="true" />
      <h2 className="z-ask-empty-title">
        {hasNote ? "Ask about this note" : "Open a text note to ask about it"}
      </h2>
      <p className="z-ask-empty-sub">
        Summaries, walkthroughs and explanations of what's open. Nothing is sent
        until you press Enter.
      </p>
      {hasNote && (
        <div className="z-ask-suggestions">
          {SUGGESTIONS.map((q) => (
            <button
              key={q}
              type="button"
              className="z-ask-suggestion"
              onClick={() => onPick(q)}
            >
              {q}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/** The question box grows with its text up to this height, then scrolls. */
const INPUT_MAX = 200;

/**
 * The Ask panel: a slim header (New conversation and ×), the conversation,
 * and the question box with the note it asks about and the model. It docks
 * on the right of the editor area.
 */
export function AskPanel({
  ask,
  noteTitle,
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

  // The box fits its text.
  useLayoutEffect(() => {
    const el = input.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, INPUT_MAX)}px`;
  }, [text]);

  // Follow the answer as it streams in.
  const turns = conversation.turns;
  const last = turns[turns.length - 1];
  useEffect(() => {
    const el = turnsRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [turns.length, last?.text, last?.error]);

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

  const pick = (q: string) => {
    setText(q);
    setMessage(null);
    input.current?.focus();
  };

  return (
    <section
      aria-label="Ask"
      data-z-right-panel=""
      className="z-ask relative flex min-h-0 min-w-0 shrink-0 flex-row bg-editor"
      style={{ width, minWidth: ASK_MIN_WIDTH, maxWidth: "70%" }}
    >
      <PanelResizeEdge
        label="Resize Ask panel"
        width={width}
        min={ASK_MIN_WIDTH}
        onWidth={onWidth}
      />
      <div className="sr-only" aria-live="polite">
        {announce}
      </div>
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <div className="flex h-9 shrink-0 select-none items-center gap-2 border-b border-hairline bg-chrome pr-1.5 pl-3 text-ui-sm">
          <span className="shrink-0 font-semibold text-text">Ask</span>
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
          className="z-ask-turns min-h-0 flex-1 overflow-y-auto"
        >
          {turns.length === 0 ? (
            <EmptyState hasNote={noteTitle !== null} onPick={pick} />
          ) : (
            turns.map((t, i) =>
              t.role === "user" ? (
                <p key={i} className="z-ask-question">
                  {t.text}
                </p>
              ) : (
                <Answer
                  key={i}
                  turn={t}
                  live={streaming && i === turns.length - 1}
                  onOpenUrl={onOpenUrl}
                />
              ),
            )
          )}
        </div>
        <div className="shrink-0 px-3 pt-1 pb-3">
          {message && (
            <p className="z-ask-error mb-1.5" role="status">
              {MESSAGES[message]}
            </p>
          )}
          <div className="z-ask-composer">
            <textarea
              ref={input}
              aria-label="Question"
              placeholder={
                noteTitle ? "Ask about this note…" : "Open a text note first"
              }
              rows={1}
              value={text}
              onChange={(e) => {
                setText(e.target.value);
                if (message) setMessage(null);
              }}
              onKeyDown={onKeyDown}
              className="z-ask-input"
            />
            <div className="flex min-w-0 items-center gap-2">
              <span
                className="z-ask-chip"
                title={noteTitle ? `Asking about ${noteTitle}` : undefined}
              >
                <Icon
                  name={noteTitle ? fileIcon(noteTitle) : "text"}
                  size={13}
                />
                <span className="truncate">{noteTitle ?? "No note"}</span>
              </span>
              <span
                className={
                  "min-w-0 flex-1 truncate text-right text-ui-xs " +
                  (streaming ? "text-muted" : "text-faint")
                }
                title={providerLabel}
              >
                {streaming ? `Asking ${providerLabel}…` : providerLabel}
              </span>
              {streaming ? (
                <button
                  type="button"
                  aria-label="Stop"
                  title="Stop"
                  onClick={stop}
                  className="z-ask-send"
                  data-stop=""
                >
                  <Icon name="square" size={10} strokeWidth={3} />
                </button>
              ) : (
                <button
                  type="button"
                  aria-label="Send"
                  title="Send (Enter)"
                  disabled={text.trim() === ""}
                  onClick={submit}
                  className="z-ask-send"
                >
                  <Icon name="arrowUp" size={15} strokeWidth={2} />
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
