import { Channel, invoke } from "@tauri-apps/api/core";

export type TerminalEvent =
  { kind: "data"; data: string } | { kind: "exit"; code: number | null };

export interface AgentInfo {
  id: string;
  name: string;
  installed: boolean;
}

/** The known agents and whether each one's command is installed. */
export function terminalAgents(): Promise<AgentInfo[]> {
  return invoke<AgentInfo[]>("terminal_agents");
}

/**
 * Opens a shell in `cwd`, or the agent with id `agent` started in it; its
 * output and exit arrive through `onEvent`.
 */
export function terminalOpen(
  cwd: string,
  cols: number,
  rows: number,
  onEvent: (e: TerminalEvent) => void,
  agent?: string,
): Promise<number> {
  const channel = new Channel<TerminalEvent>();
  channel.onmessage = onEvent;
  return invoke<number>("terminal_open", {
    cwd,
    cols,
    rows,
    agent: agent ?? null,
    onEvent: channel,
  });
}

/** Fire-and-forget: the backend queues writes, so call order is kept. */
export function terminalWrite(id: number, data: string): void {
  void invoke("terminal_write", { id, data }).catch(() => {});
}

/**
 * Fire-and-forget: the view has parsed `n` UTF-16 code units (string
 * `length`) of the terminal's output, so the backend may send more.
 */
export function terminalAck(id: number, n: number): void {
  void invoke("terminal_ack", { id, n }).catch(() => {});
}

export function terminalResize(
  id: number,
  cols: number,
  rows: number,
): Promise<void> {
  return invoke("terminal_resize", { id, cols, rows });
}

export function terminalKill(id: number): Promise<void> {
  return invoke("terminal_kill", { id });
}
