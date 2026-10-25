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
  let inFlight: Promise<void> | null = null;
  let failedOnce = false;

  // Concurrent triggers share one in-flight flush. A failed first flush keeps
  // the app open; any later attempt exits whatever the flush result.
  const flushThenExit = (): Promise<void> => {
    if (inFlight) return inFlight;
    inFlight = (async () => {
      try {
        await flushAll();
      } catch (err) {
        console.error("flush before exit failed", err);
        if (!failedOnce) {
          failedOnce = true;
          return;
        }
      }
      await invoke("app_exit_after_flush");
    })().finally(() => {
      inFlight = null;
    });
    return inFlight;
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
