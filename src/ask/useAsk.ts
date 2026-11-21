import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useReducer,
  useRef,
} from "react";
import type { Kind } from "../model/kinds";
import type { TextBridge } from "../editor/EditorHost";
import { aiAsk, aiCancel, type Message } from "./api";
import { EMPTY, reduce, type Conversation } from "./conversation";
import { buildSystem } from "./prompt";
import { redact } from "./redact";

let nextId = 1;

export interface AskTab {
  id: string;
  title: string;
  language: string;
  kind: Kind;
}

export interface UseAsk {
  conversation: Conversation;
  send(question: string): "sent" | "noNote" | "tooLong" | "busy";
  stop(): void;
  clear(): void;
}

/** The backend rejects with `{ kind, message }`, not an Error. */
function errorMessage(e: unknown): string {
  if (typeof e === "object" && e !== null) {
    const m = (e as { message?: unknown }).message;
    if (typeof m === "string") return m;
  }
  return String(e);
}

export function useAsk(opts: {
  bridge: TextBridge | null;
  activeTab: AskTab | null;
}): UseAsk {
  const [conversation, dispatch] = useReducer(reduce, EMPTY);
  const live = useRef({ conversation, ...opts });
  /** Set the moment a send starts, so two sends in one event can't both run. */
  const busy = useRef(false);
  useLayoutEffect(() => {
    live.current = { conversation, ...opts };
    busy.current = conversation.streaming !== null;
  });

  const cancel = useCallback(() => {
    const id = live.current.conversation.streaming;
    if (id !== null) void aiCancel(id).catch(() => {});
  }, []);

  useEffect(() => cancel, [cancel]);

  const send = useCallback((question: string) => {
    const { conversation: c, bridge, activeTab } = live.current;
    if (busy.current || c.streaming !== null) return "busy";
    if (!bridge || !activeTab || activeTab.kind !== "text") return "noNote";
    const raw = bridge.text(activeTab.id);
    if (raw === null) return "noNote";
    const system = buildSystem({
      title: activeTab.title,
      language: activeTab.language,
      text: redact(raw, bridge.hidden(activeTab.id)),
    });
    if (typeof system !== "string") return "tooLong";

    const messages: Message[] = [];
    // History goes in as user/assistant pairs; a pair whose answer failed or
    // is empty is dropped whole, so roles strictly alternate.
    for (let i = 0; i + 1 < c.turns.length; i += 2) {
      const [q, a] = [c.turns[i], c.turns[i + 1]];
      if (a.error || !a.text) continue;
      messages.push({ role: "user", content: q.text });
      messages.push({ role: "assistant", content: a.text });
    }
    messages.push({ role: "user", content: question });

    const id = nextId++;
    busy.current = true;
    dispatch({ type: "ask", id, question, noteTitle: activeTab.title });
    const fail = (e: unknown) =>
      dispatch({
        type: "event",
        id,
        event: { kind: "error", message: errorMessage(e) },
      });
    try {
      aiAsk(id, system, messages, (event) =>
        dispatch({ type: "event", id, event }),
      ).catch(fail);
    } catch (e) {
      fail(e);
    }
    return "sent";
  }, []);

  const stop = useCallback(() => {
    cancel();
    dispatch({ type: "stop" });
  }, [cancel]);

  const clear = useCallback(() => {
    cancel();
    dispatch({ type: "clear" });
  }, [cancel]);

  return { conversation, send, stop, clear };
}
