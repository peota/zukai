import { useCallback, useMemo, useReducer, useRef } from "react";
import {
  terminalKill,
  terminalOpen,
  terminalWrite,
  type TerminalEvent,
} from "./api";
import { initialTermState, termReducer } from "./model";

type Sink = (e: TerminalEvent) => void;

/**
 * The open terminals and the panel's state. A shell's output reaches its view
 * through `register`; whatever arrives before the view registers (the prompt,
 * ConPTY's cursor-position query) is kept and replayed then.
 */
export function useTerminals() {
  const [state, dispatch] = useReducer(termReducer, initialTermState);
  const sinks = useRef(new Map<number, Sink>());
  const pending = useRef(new Map<number, TerminalEvent[]>());

  const deliver = useCallback((id: number, e: TerminalEvent) => {
    if (e.kind === "exit") dispatch({ type: "exited", id, code: e.code });
    const sink = sinks.current.get(id);
    if (sink) {
      sink(e);
      return;
    }
    const queue = pending.current.get(id);
    if (queue) queue.push(e);
    else pending.current.set(id, [e]);
  }, []);

  const open = useCallback(
    async (cwd: string) => {
      // Events can come before the id does: keep them until it's known.
      let id: number | null = null;
      const early: TerminalEvent[] = [];
      const onEvent = (e: TerminalEvent) => {
        if (id === null) early.push(e);
        else deliver(id, e);
      };
      // 80×24 until the view's first fit resizes it.
      id = await terminalOpen(cwd, 80, 24, onEvent);
      dispatch({ type: "opened", id, cwd });
      for (const e of early) deliver(id, e);
    },
    [deliver],
  );

  const kill = useCallback((id: number) => {
    // Exited sessions stay in Rust's map until killed, so always kill.
    void terminalKill(id)
      .catch(() => {})
      .then(() => {
        sinks.current.delete(id);
        pending.current.delete(id);
        dispatch({ type: "killed", id });
      });
  }, []);

  const register = useCallback((id: number, sink: Sink) => {
    sinks.current.set(id, sink);
    const queue = pending.current.get(id);
    pending.current.delete(id);
    for (const e of queue ?? []) sink(e);
  }, []);

  const activate = useCallback(
    (id: number) => dispatch({ type: "activate", id }),
    [],
  );
  const show = useCallback(() => dispatch({ type: "show" }), []);
  const hide = useCallback(() => dispatch({ type: "hide" }), []);
  const write = useCallback(
    (id: number, data: string) => terminalWrite(id, data),
    [],
  );

  return useMemo(
    () => ({ state, open, kill, activate, show, hide, write, register }),
    [state, open, kill, activate, show, hide, write, register],
  );
}
