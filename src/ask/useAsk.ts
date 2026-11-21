import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useReducer,
  useRef,
} from "react";
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
  kind: string;
}

export interface UseAsk {
  conversation: Conversation;
  send(question: string): "sent" | "noNote" | "tooLong" | "busy";
  stop(): void;
  clear(): void;
}

export function useAsk(opts: {
  bridge: TextBridge | null;
  activeTab: AskTab | null;
}): UseAsk {
  const [conversation, dispatch] = useReducer(reduce, EMPTY);
  const live = useRef({ conversation, ...opts });
  useLayoutEffect(() => {
    live.current = { conversation, ...opts };
  });

  const cancel = useCallback(() => {
    const id = live.current.conversation.streaming;
    if (id !== null) void aiCancel(id).catch(() => {});
  }, []);

  useEffect(() => cancel, [cancel]);

  const send = useCallback((question: string) => {
    const { conversation: c, bridge, activeTab } = live.current;
    if (c.streaming !== null) return "busy";
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
    for (const t of c.turns) {
      if (t.error || (t.role === "assistant" && !t.text)) continue;
      messages.push({ role: t.role, content: t.text });
    }
    messages.push({ role: "user", content: question });

    const id = nextId++;
    dispatch({ type: "ask", id, question, noteTitle: activeTab.title });
    aiAsk(id, system, messages, (event) =>
      dispatch({ type: "event", id, event }),
    ).catch((e: unknown) =>
      dispatch({
        type: "event",
        id,
        event: { kind: "error", message: String(e) },
      }),
    );
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
