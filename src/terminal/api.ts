import { Channel, invoke } from "@tauri-apps/api/core";

export type TerminalEvent =
  { kind: "data"; data: string } | { kind: "exit"; code: number | null };

/** Opens a shell in `cwd`; its output and exit arrive through `onEvent`. */
export function terminalOpen(
  cwd: string,
  cols: number,
  rows: number,
  onEvent: (e: TerminalEvent) => void,
): Promise<number> {
  const channel = new Channel<TerminalEvent>();
  channel.onmessage = onEvent;
  return invoke<number>("terminal_open", {
    cwd,
    cols,
    rows,
    onEvent: channel,
  });
}

/** Fire-and-forget: the backend queues writes, so call order is kept. */
export function terminalWrite(id: number, data: string): void {
  void invoke("terminal_write", { id, data }).catch(() => {});
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
