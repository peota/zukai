# Ask foundation — follow-ups

Open items left after the Ask foundation (plan 1 of 5, branch `feat/ask-foundation`). The final whole-branch review triaged all of them as safe to follow up. None of them sends the key anywhere or sends text without Enter.

## Before merge: manual check in the real app

These checks need a real provider key, so they couldn't run in CI.

1. On a fresh `ai.json`, open Settings → AI, keep Anthropic, paste a key and press **Save key**. The status shows `Key set`, Mod+J opens the Ask panel, and the model is `claude-sonnet-5-5`.
2. Open a Markdown note with a hidden range and ask "summarise this". The answer streams, and the hidden text isn't in it.
3. Press **Stop** mid-answer: the answer stops and the partial text stays. Hide the panel mid-answer: the answer stops the same way.
4. Quit mid-answer: Zukai exits within 5 s.
5. A wrong key shows the provider's message (for example "Anthropic: invalid x-api-key"), never the key.
6. If Ollama is available, choose OpenAI-compatible with `http://localhost:11434/v1`, no key and a local model, then ask again.
7. Remove the key in Settings while the panel is open: the panel closes, and Mod+J does nothing.

## Rust (`src-tauri/src/ai/`)

- `prepare_in` reads the key twice. If the keychain fails at the wrong moment, the user sees "Ask isn't set up yet" instead of the keychain error.
- A Stop that arrives before the async `ai_ask` body first runs is still lost. The window is now tiny.
- `ai_ask`'s forget-the-id-on-error path has no test, because it needs an AppHandle.
- A corrupt `ai.json` reads as "no config", with no notice.
- The SSE parser doesn't treat a lone `\r` as a line ending. There are no tests for a `\r\n` or a UTF-8 character split across chunks, although the code handles both.
- The ureq error text for a malformed URL may echo the base URL, including any `user:pass@` in it.
- `late_events_after_cancel_are_dropped` relies on sleeps for its timing.

## Webview

- The first run with OpenAI-compatible and no URL yet saves the key under an empty URL. Entering the URL afterwards then asks to forget that key.
- Editing the URL back to the stored value while its confirm is open leaves a stale confirm.
- Removing the key sends `aiCancel` twice. This is harmless.
- The screen-reader announcer reads the answer as raw Markdown.
- A half-typed question is lost when the panel is hidden.
- `redact` has no tests for negative or NaN ranges. CodeMirror never produces them.

## Decided, worth a second look

- With a Terminal focused, Ctrl+J goes to the shell, as every Ctrl+letter key does there. In a shell, Ctrl+J is a line feed and runs the half-typed command.
- A stream that ends cleanly without `[DONE]` counts as finished, for compatible servers that leave it out. A truncated answer then looks complete.
- A question whose answer failed, or was stopped before any text, is left out of the next request's history.
- **Before plan 4 (history writes answers to disk):** provider error text is shown as-is, apart from replacing the key. Check what's stored.
