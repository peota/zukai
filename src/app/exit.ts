import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";

export const BEFORE_EXIT_EVENT = "zukai://before-exit";

/**
 * Flush pending work before the process exits. Both the Rust-side
 * `before-exit` event and the window close request run `flushAll()` to
 * completion, then ask Rust to exit via `app_exit_after_flush`.
 */
export async function installExitHandshake(
  flushAll: () => Promise<void>,
): Promise<() => void> {
  const flushThenExit = async () => {
    try {
      await flushAll();
    } finally {
      await invoke("app_exit_after_flush");
    }
  };

  const unlistenEvent = await listen(BEFORE_EXIT_EVENT, () => {
    void flushThenExit();
  });
  const unlistenClose = await getCurrentWindow().onCloseRequested(
    async (event) => {
      event.preventDefault();
      await flushThenExit();
    },
  );

  return () => {
    unlistenEvent();
    unlistenClose();
  };
}
