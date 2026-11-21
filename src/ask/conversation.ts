import type { AskEvent } from "./api";

export interface Turn {
  role: "user" | "assistant";
  text: string;
  noteTitle?: string;
  error?: string;
}

export interface Conversation {
  turns: Turn[];
  /** The id of the request being answered, or null. */
  streaming: number | null;
}

export type Action =
  | { type: "ask"; id: number; question: string; noteTitle: string }
  | { type: "event"; id: number; event: AskEvent }
  | { type: "stop" }
  | { type: "clear" };

export const EMPTY: Conversation = { turns: [], streaming: null };

function editLast(c: Conversation, f: (t: Turn) => Turn): Conversation {
  const i = c.turns.length - 1;
  if (i < 0 || c.turns[i].role !== "assistant") return c;
  const turns = c.turns.slice();
  turns[i] = f(turns[i]);
  return { ...c, turns };
}

export function reduce(c: Conversation, a: Action): Conversation {
  switch (a.type) {
    case "ask":
      return {
        turns: [
          ...c.turns,
          { role: "user", text: a.question, noteTitle: a.noteTitle },
          { role: "assistant", text: "" },
        ],
        streaming: a.id,
      };
    case "event": {
      if (a.id !== c.streaming) return c;
      const e = a.event;
      if (e.kind === "text") {
        return editLast(c, (t) => ({ ...t, text: t.text + e.text }));
      }
      if (e.kind === "done") return { ...c, streaming: null };
      return {
        ...editLast(c, (t) => ({ ...t, error: e.message })),
        streaming: null,
      };
    }
    case "stop":
      return c.streaming === null ? c : { ...c, streaming: null };
    case "clear":
      return EMPTY;
  }
}
