import { useCallback, useMemo, useReducer, useRef } from "react";
import {
  terminalAck,
  terminalKill,
  terminalOpen,
  terminalWrite,
  type TerminalEvent,
} from "./api";
import { initialTermState, termReducer } from "./model";

type Sink = (e: TerminalEvent) => void;

/** The most early output kept per terminal, in characters. */
const EARLY_LOG_LIMIT = 256 * 1024;

/**
 * The open terminals and the panel's state. A shell's output reaches its view
 * through `register`. Until the first input, each terminal's output (the
 * prompt, ConPTY's cursor-position query) is also logged and replayed to
 * every view that registers, so a view that mounts twice (StrictMode) or
 * after its first output still sees it all, once. Views ack the output they
 * parse (the backend holds back output while too much is unacked); output
 * dropped here for want of a view is acked here.
 */
export function useTerminals() {
  const [state, dispatch] = useReducer(termReducer, initialTermState);
  const sinks = useRef(new Map<number, Sink>());
  /** Early output by id; gone once the terminal has had input. */
  const logs = useRef(
    new Map<number, { events: TerminalEvent[]; size: number }>(),
  );
  /** Killed terminals: whatever they still send is ignored. */
  const killed = useRef(new Set<number>());

  const deliver = useCallback((id: number, e: TerminalEvent) => {
    if (killed.current.has(id)) return;
    if (e.kind === "exit") dispatch({ type: "exited", id, code: e.code });
    const sink = sinks.current.get(id);
    const log = logs.current.get(id);
    // Logged while early, or whenever no view is there to take it.
    if (log || !sink) {
      const l = log ?? { events: [], size: 0 };
      const size = e.kind === "data" ? e.data.length : 0;
      if (l.size + size <= EARLY_LOG_LIMIT) {
        l.events.push(e);
        l.size += size;
      } else if (!sink && e.kind === "data") {
        // No view will ever ack it: ack it here, or the backend waits forever.
        terminalAck(id, size);
      }
      logs.current.set(id, l);
    }
    sink?.(e);
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
    // Gone at once: its Exit (and a dimmed "Process exited" line) may come
    // before the kill returns, and must not show.
    killed.current.add(id);
    sinks.current.delete(id);
    logs.current.delete(id);
    dispatch({ type: "killed", id });
    // Exited sessions stay in Rust's map until killed, so always kill.
    void terminalKill(id).catch(() => {});
  }, []);

  /** Replays the early output to `sink`, then sends it live; returns its undo. */
  const register = useCallback((id: number, sink: Sink) => {
    sinks.current.set(id, sink);
    for (const e of logs.current.get(id)?.events ?? []) sink(e);
    return () => {
      if (sinks.current.get(id) === sink) sinks.current.delete(id);
    };
  }, []);

  const activate = useCallback(
    (id: number) => dispatch({ type: "activate", id }),
    [],
  );
  const show = useCallback(() => dispatch({ type: "show" }), []);
  const hide = useCallback(() => dispatch({ type: "hide" }), []);
  const write = useCallback((id: number, data: string) => {
    // Input means a live view has the output: the early log is done.
    logs.current.delete(id);
    terminalWrite(id, data);
  }, []);

  return useMemo(
    () => ({ state, open, kill, activate, show, hide, write, register }),
    [state, open, kill, activate, show, hide, write, register],
  );
}
