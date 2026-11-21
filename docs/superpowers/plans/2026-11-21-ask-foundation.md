# Ask Foundation Implementation Plan (Ask, plan 1 of 5)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A docked Ask panel that answers questions about the open note, streamed from the user's own AI provider, with the key held in the OS keychain.

**Architecture:** Rust owns everything secret or networked. It stores the provider config in `ai.json`, keeps the key in the OS keychain, and makes the HTTP request, streaming answer text to the webview over a Tauri `Channel`. The webview never sees the key and, under the CSP, can't reach the network anyway. The webview builds the prompt from the active Tab's text with Hidden text redacted, renders answers with the existing `renderMarkdown`, and docks the panel on the right of the editor area.

**Tech Stack:** Tauri 2, Rust (`ureq` 3 with rustls, `keyring` 3), React 19, TypeScript, Vitest.

**Spec:** [ADR 0013](../../adr/0013-ask-with-the-users-own-key.md) and the **Ask** section of [CONTEXT.md](../../../CONTEXT.md).

## Global Constraints

- Providers: `anthropic`, `openai`, `compatible` (an OpenAI-compatible base URL). One is active at a time.
- The key is stored only in the OS keychain (service `Zukai`), never in `settings.json`, `session.json`, `ai.json` or any log. No command ever returns it to the webview.
- A key belongs to one provider and URL. Changing the provider or the `compatible` URL forgets the stored key, so a changed URL can never receive the old key.
- Nothing is sent until the user presses Enter in the Ask panel. No background or as-you-type calls.
- Hidden text is sent as `[hidden]`, always.
- Without a key (or, for `compatible`, without a URL) there is no panel, no Mod+J and no icon. Only Settings → AI shows.
- UI copy uses the CONTEXT.md words: Ask panel, Ask scope, This note, AI provider. Never "chat", "assistant" or "copilot".
- The panel docks to the right of the editor area. Its width is a setting, `askWidth`: default 400, minimum 280, at most 70% of the available width (reuse `clampTerminalSize`).
- Mod+J toggles the Ask panel.
- Default models: Anthropic `claude-sonnet-5-5`. For `openai` and `compatible` the model field is required and has no default.
- The Anthropic request uses `POST https://api.anthropic.com/v1/messages` with headers `x-api-key` and `anthropic-version: 2023-06-01`, `max_tokens: 4096`, `stream: true`. OpenAI and compatible use `POST {base}/chat/completions` with `Authorization: Bearer <key>` (omitted when the key is empty), `stream: true`. The OpenAI base is `https://api.openai.com/v1`.
- This note is limited to 200,000 characters after redaction. Above that the panel says "This note is too long to ask about" and sends nothing.

## Review Focus

1. **A wrong key or an unreachable host.** A 401, a 404 model or a refused connection must show the provider's message in the panel ("Anthropic: invalid x-api-key"), never a hang, and the key must never appear in it. Owner: Task 3.
2. **Switching Tabs while an answer streams.** The answer keeps going into the conversation it started in, and the next question uses the newly active Tab. Owner: Task 6.
3. **Closing the panel, or quitting, mid-answer.** The request is cancelled and its thread ends; quitting isn't held up. Owner: Tasks 3 and 7.
4. **Hidden ranges that touch, overlap, arrive unsorted or run past the end of the text.** Every hidden character is still replaced, and nothing else is. Owner: Task 4.
5. **A local server with no key** (Ollama at `http://localhost:11434/v1`). It must work with an empty key and send no `Authorization` header. Owner: Tasks 1 and 2.

---

## File Structure

**Rust, `src-tauri/src/ai/`** (new module, registered in `lib.rs`)
- `mod.rs`: `AiError` and its `Serialize` (same shape as `FileError`: `{ kind, message }`).
- `config.rs`: `AiConfig`, the `Provider` enum, loading and saving `ai.json`, and `key_account`.
- `keychain.rs`: the `SecretStore` trait, `KeyringStore` (OS keychain) and `MemoryStore` (tests).
- `sse.rs`: an incremental Server-Sent Events line parser.
- `provider.rs`: building the request per provider, and turning SSE events into `Delta`s.
- `ask.rs`: `stream_answer`, the blocking loop that sends a request and forwards deltas, with cancellation.
- `commands.rs`: Tauri commands and the `Asks` state (running requests by id).

**TypeScript, `src/ask/`** (new)
- `api.ts`: `invoke` wrappers and types.
- `redact.ts`: `redact(text, hidden)`.
- `prompt.ts`: the system prompt, the note context and the size limit.
- `conversation.ts`: the pure conversation reducer.
- `useAsk.ts`: the hook joining the reducer, the API and the active Tab.
- `AskPanel.tsx`: the panel UI.
- `ask.css`: the panel's styles (answer typography reuses the Markdown preview's classes).

**Modified**
- `src/ui/AiSettings.tsx` (new) and `src/ui/SettingsDialog.tsx`: the AI section.
- `src/model/settings.ts`: `askWidth`.
- `src/app/shortcuts.ts` and `src/app/shortcutList.ts`: `toggleAsk`, Mod+J.
- `src/editor/EditorHost.tsx`: `TextBridge.hidden(id)`.
- `src/App.tsx`: the panel in the layout, dispatching `toggleAsk`, cancelling on exit.
- `CONTEXT.md`: Mod+J and the right-hand dock.

---

### Task 1: AI config and key store (Rust)

**Files:**
- Create: `src-tauri/src/ai/mod.rs`, `src-tauri/src/ai/config.rs`, `src-tauri/src/ai/keychain.rs`, `src-tauri/src/ai/commands.rs`
- Modify: `src-tauri/Cargo.toml` (add `keyring = { version = "3", features = ["apple-native", "windows-native", "sync-secret-service", "crypto-rust"] }`), `src-tauri/src/lib.rs` (add `mod ai;`, `.manage(ai::commands::Asks::default())`, and register the commands)
- Test: inline `#[cfg(test)] mod tests` in `config.rs` and `commands.rs`

**Interfaces:**
- Produces:
  - `#[serde(rename_all = "lowercase")] enum Provider { Anthropic, Openai, Compatible }`
  - `struct AiConfig { provider: Provider, base_url: Option<String>, model: String }` (serde camelCase, so `baseUrl` in JSON)
  - `fn key_account(c: &AiConfig) -> String` returns `"anthropic"`, `"openai"` or `"compatible:<base_url trimmed of a trailing />"`
  - `fn load(dir: &Path) -> Option<AiConfig>` and `fn save(dir: &Path, c: &AiConfig) -> Result<(), AiError>`, file `ai.json`, written with `storage::atomic::atomic_write`
  - `trait SecretStore: Send + Sync { fn get(&self, account: &str) -> Result<Option<String>, AiError>; fn set(&self, account: &str, secret: &str) -> Result<(), AiError>; fn delete(&self, account: &str) -> Result<(), AiError>; }`
  - `struct AiStatus { config: Option<AiConfig>, has_key: bool, ready: bool }` (camelCase). `ready` means a config exists, a model is set, `compatible` has a URL, and a key is stored (except `compatible`, which counts as ready without one)
  - Commands: `ai_status() -> AiStatus`, `ai_config_set(config: AiConfig) -> AiStatus`, `ai_key_set(key: String) -> AiStatus`, `ai_key_remove() -> AiStatus`
  - The command bodies call testable functions taking `(&Path, &dyn SecretStore)`: `status_in`, `config_set_in`, `key_set_in`, `key_remove_in`

- [ ] **Step 1: Write the failing tests**

In `config.rs`: `key_account_per_provider` (with `compatible` and base `http://localhost:11434/v1/`, assert `"compatible:http://localhost:11434/v1"`) and `save_then_load_round_trips` (tempdir).

In `commands.rs`, with `MemoryStore` and a tempdir:
- `config_change_forgets_key`: set an `anthropic` config and key, then set `compatible` with base `http://x`. `status.has_key == false`, and the store has no `"anthropic"` entry.
- `same_config_keeps_key`: setting the identical config again keeps `has_key == true`.
- `compatible_ready_without_key`: `compatible` with a base and model has `ready == true` and `has_key == false`.
- `status_never_contains_key`: `serde_json::to_string(&status)` doesn't contain the key string.
- `key_set_rejects_blank`: `"  "` is rejected with kind `"invalid"`.

- [ ] **Step 2: Run them to verify they fail**

Run: `cd src-tauri && cargo test ai::`
Expected: FAIL to compile (module missing).

- [ ] **Step 3: Implement the config, the store and the commands**

`KeyringStore` uses `keyring::Entry::new("Zukai", account)`. Map `keyring::Error::NoEntry` to `Ok(None)` on get and `Ok(())` on delete. Trim the key before storing it. `ai_config_set` compares `key_account(old)` with `key_account(new)` and deletes the old key when they differ. Run the blocking work through `tauri::async_runtime::spawn_blocking`, as `files::commands::blocking` does.

- [ ] **Step 4: Run them to verify they pass**

Run: `cd src-tauri && cargo test ai::`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src-tauri/Cargo.toml src-tauri/Cargo.lock src-tauri/src/ai src-tauri/src/lib.rs
git commit -m "feat(ai): provider config in ai.json, key in the OS keychain"
```

---

### Task 2: SSE parsing and provider requests (Rust, pure)

**Files:**
- Create: `src-tauri/src/ai/sse.rs`, `src-tauri/src/ai/provider.rs`
- Test: inline tests in both

**Interfaces:**
- Consumes: `AiConfig` and `Provider` (Task 1)
- Produces:
  - `struct SseEvent { event: Option<String>, data: String }`
  - `struct SseParser` with `fn push(&mut self, chunk: &[u8]) -> Vec<SseEvent>`. It handles events split across chunks, `\r\n` line endings, several `data:` lines joined with `\n`, and `:` comment lines.
  - `#[serde(rename_all = "lowercase")] enum Role { User, Assistant }` and `struct Message { role: Role, content: String }`
  - `struct HttpRequest { url: String, headers: Vec<(String, String)>, body: serde_json::Value }`
  - `fn build_request(c: &AiConfig, key: &str, system: &str, messages: &[Message]) -> HttpRequest`
  - `enum Delta { Text(String), Done, Error(String) }`
  - `fn parse_event(p: Provider, e: &SseEvent) -> Option<Delta>`
  - `fn error_message(p: Provider, status: u16, body: &str) -> String`

- [ ] **Step 1: Write the failing tests**

`sse.rs`:
- `split_across_chunks`: `push(b"data: {\"a\"")` returns nothing, then `push(b":1}\n\n")` returns one event with data `{"a":1}`.
- `crlf_and_event_name`: `"event: ping\r\ndata: x\r\n\r\n"` gives `event == Some("ping")`.
- `comments_ignored`: `": keepalive\n\n"` gives no events.

`provider.rs`:
- `anthropic_request`: the URL is `https://api.anthropic.com/v1/messages`. The headers include `x-api-key: k` and `anthropic-version: 2023-06-01`. The body has `"system"`, `"stream": true`, `"max_tokens": 4096` and `"model"`.
- `openai_request_puts_system_first`: `messages[0]` is `{"role":"system", ...}`, and the URL is `https://api.openai.com/v1/chat/completions`.
- `compatible_no_key_no_auth_header`: with key `""`, no header named `Authorization`. With base `http://localhost:11434/v1/`, the URL is `http://localhost:11434/v1/chat/completions`.
- `anthropic_deltas`: a `content_block_delta` with `{"delta":{"type":"text_delta","text":"hi"}}` gives `Text("hi")`. `message_stop` gives `Done`. An `error` event gives `Error(<error.message>)`.
- `openai_deltas`: `{"choices":[{"delta":{"content":"hi"}}]}` gives `Text("hi")`, and data `[DONE]` gives `Done`.
- `error_message_uses_provider_text`: `error_message(Anthropic, 401, r#"{"error":{"message":"invalid x-api-key"}}"#) == "Anthropic: invalid x-api-key"`. A body that isn't JSON gives `"Anthropic: HTTP 401"`.

- [ ] **Step 2: Run them to verify they fail**

Run: `cd src-tauri && cargo test ai::`
Expected: FAIL (functions missing).

- [ ] **Step 3: Implement `SseParser`, `build_request`, `parse_event` and `error_message`**

Provider names in messages are `Anthropic`, `OpenAI` and the URL's host for `compatible`.

- [ ] **Step 4: Run them to verify they pass**

Run: `cd src-tauri && cargo test ai::`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/ai
git commit -m "feat(ai): Anthropic and OpenAI-compatible requests and streaming"
```

---

### Task 3: Streaming answers and cancellation (Rust)

**Files:**
- Create: `src-tauri/src/ai/ask.rs`
- Modify: `src-tauri/Cargo.toml` (add `ureq = { version = "3", default-features = false, features = ["rustls", "json"] }`), `src-tauri/src/ai/commands.rs`, `src-tauri/src/lib.rs` (register the commands; in `app_exit_after_flush`, call `Asks::cancel_all` beside `kill_terminals`)
- Test: inline tests in `ask.rs` against a one-shot `std::net::TcpListener` on `127.0.0.1:0` that writes a canned HTTP response

**Interfaces:**
- Consumes: `build_request`, `parse_event`, `error_message`, `SseParser`, `Message` (Task 2); `SecretStore`, `load`, `key_account` (Task 1)
- Produces:
  - `#[serde(tag = "kind", rename_all = "lowercase")] enum AskEvent { Text { text: String }, Done, Error { message: String } }`
  - `fn stream_answer(req: HttpRequest, provider: Provider, cancel: &AtomicBool, sink: &mut dyn FnMut(AskEvent))`. It always ends with exactly one `Done` or `Error`, or with nothing when cancelled.
  - `#[derive(Default)] struct Asks` with `fn start(&self, id: u32) -> Arc<AtomicBool>`, `fn cancel(&self, id: u32)`, `fn cancel_all(&self)` and `fn finish(&self, id: u32)`
  - Commands: `ai_ask(id: u32, system: String, messages: Vec<Message>, on_event: Channel<AskEvent>) -> Result<(), AiError>` (returns once the request has started; events arrive on the channel) and `ai_cancel(id: u32)`
  - `ai_ask` errors with kind `"not_ready"` when `status.ready` is false

- [ ] **Step 1: Write the failing tests**

- `streams_text_then_done`: the server answers `200` with `content-type: text/event-stream` and two OpenAI chunks, then `[DONE]`. The events are `[Text "a", Text "b", Done]`.
- `http_error_becomes_error_event`: the server answers `401` with `{"error":{"message":"bad key"}}`. The events are `[Error "OpenAI: bad key"]`, and the message doesn't contain the key.
- `refused_connection_is_error`: a URL on a port that was bound and then closed gives exactly one `Error`.
- `cancel_stops_without_done`: the server sends one chunk and then stalls. Set `cancel` to true from another thread after the first `Text`. `stream_answer` returns within 2 s, with no `Done` or `Error` after the cancel.

- [ ] **Step 2: Run them to verify they fail**

Run: `cd src-tauri && cargo test ai::ask`
Expected: FAIL (`stream_answer` missing).

- [ ] **Step 3: Implement `stream_answer`, `Asks` and the commands**

Use a `ureq::Agent` with `http_status_as_error(false)`, so error bodies can be read for `error_message`. Set a 15 s connect timeout and a 60 s timeout between body reads. Read the body in 4 KiB chunks into `SseParser`, and check `cancel` before each read and after each event. `ai_ask` reads the config and key in Rust, calls `Asks::start(id)`, and runs `stream_answer` in `spawn_blocking`, sending each event on the channel, then calls `Asks::finish(id)`.

- [ ] **Step 4: Run them to verify they pass**

Run: `cd src-tauri && cargo test ai::`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src-tauri
git commit -m "feat(ai): stream answers over a channel, cancel on demand and at exit"
```

---

### Task 4: API wrappers, redaction and the prompt (TypeScript)

**Files:**
- Create: `src/ask/api.ts`, `src/ask/redact.ts`, `src/ask/prompt.ts`
- Test: `src/ask/redact.test.ts`, `src/ask/prompt.test.ts`

**Interfaces:**
- Consumes: the Task 1 and Task 3 commands
- Produces:
  - `api.ts`: `type Provider = "anthropic" | "openai" | "compatible"`, `interface AiConfig { provider: Provider; baseUrl?: string; model: string }`, `interface AiStatus { config: AiConfig | null; hasKey: boolean; ready: boolean }`, `type AskEvent = { kind: "text"; text: string } | { kind: "done" } | { kind: "error"; message: string }`, `interface Message { role: "user" | "assistant"; content: string }`, plus `aiStatus()`, `aiConfigSet(c)`, `aiKeySet(key)`, `aiKeyRemove()`, `aiAsk(id, system, messages, onEvent)` (a `Channel`, as in `src/terminal/api.ts`) and `aiCancel(id)`
  - `redact.ts`: `HIDDEN_MARK = "[hidden]"` and `redact(text: string, hidden: readonly [number, number][]): string`
  - `prompt.ts`: `NOTE_LIMIT = 200_000`, `buildSystem(note: { title: string; language: string; text: string }): string | { tooLong: true }`

- [ ] **Step 1: Write the failing tests**

`redact.test.ts`:
- `redact("user: bob pw: hunter2", [[14, 21]])` gives `"user: bob pw: [hidden]"`.
- Unsorted, overlapping and touching ranges `[[10, 12], [0, 3], [2, 5], [5, 6]]` merge into `[0, 6]` and `[10, 12]`, and each merged run becomes one `[hidden]`.
- A range past the end, `[[3, 99]]` on `"abcdef"`, gives `"abc[hidden]"`.
- An empty range `[[2, 2]]` leaves the text unchanged.

`prompt.test.ts`:
- `buildSystem` includes the title, the language and the text, inside a `<note>` … `</note>` block.
- The prompt tells the model to answer from the note, to say when the note doesn't contain the answer, and that `[hidden]` marks text the user hid and it must not guess.
- A text of `NOTE_LIMIT + 1` characters gives `{ tooLong: true }`.

- [ ] **Step 2: Run them to verify they fail**

Run: `pnpm vitest run src/ask`
Expected: FAIL (modules missing).

- [ ] **Step 3: Implement `api.ts`, `redact` and `buildSystem`**

- [ ] **Step 4: Run them to verify they pass**

Run: `pnpm vitest run src/ask`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/ask
git commit -m "feat(ask): API bindings, Hidden text redaction and the note prompt"
```

---

### Task 5: Settings → AI

**Files:**
- Create: `src/ui/AiSettings.tsx`
- Modify: `src/ui/SettingsDialog.tsx` (`type Section = "general" | "ai" | "shortcuts"`, with a SectionTab labelled `AI` between General and Keyboard shortcuts), `src/model/settings.ts` (`askWidth: number`, default 400, `ASK_MIN_WIDTH = 280`, parsed with `storedSize`)
- Test: `src/ui/AiSettings.test.tsx`, `src/model/settings.test.ts`

**Interfaces:**
- Consumes: `aiStatus`, `aiConfigSet`, `aiKeySet`, `aiKeyRemove`, `AiStatus` (Task 4)
- Produces: `AiSettings({ status, onStatus }: { status: AiStatus; onStatus(s: AiStatus): void })`. App owns `AiStatus` (Task 7) and passes it down through `SettingsDialog`'s new props `aiStatus` and `onAiStatus`.

The rows, each one row as the Settings entry in CONTEXT.md describes:
- **Provider**: a dropdown with `Anthropic`, `OpenAI` and `OpenAI-compatible (Ollama, LM Studio, …)`.
- **URL**: shown only for OpenAI-compatible, with placeholder `http://localhost:11434/v1`.
- **Model**: a text field. Its placeholder is `claude-sonnet-5-5` for Anthropic, and it's empty for the others.
- **Key**: when one is stored, the text `Key set` and a `Remove` link. Otherwise a password field and a `Save key` button. For OpenAI-compatible the label is `Key (optional)`.
- A note under the rows: `Ask sends only what you ask about, and only when you press Enter. Hidden text is never sent.`

Changes are saved on blur or Enter (a config change calls `aiConfigSet`), so each keystroke doesn't forget the key.

- [ ] **Step 1: Write the failing tests**

- `settings.test.ts`: `parseSettings({}).askWidth === 400`, and `parseSettings({ askWidth: 100 }).askWidth === 400`.
- `AiSettings.test.tsx`, with the api module mocked:
  - Picking OpenAI-compatible shows the URL field.
  - Typing a key and pressing Save key calls `aiKeySet` with it, then clears the field.
  - With `hasKey: true`, the key's value is never in the DOM, `Key set` shows, and Remove calls `aiKeyRemove`.
  - Changing the provider while `hasKey` is true shows `Changing the provider forgets the saved key.` before `aiConfigSet` runs, and Cancel keeps the old provider.

- [ ] **Step 2: Run them to verify they fail**

Run: `pnpm vitest run src/ui/AiSettings.test.tsx src/model/settings.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement `AiSettings` and wire the section and `askWidth`**

Reuse the existing row components from `SettingsDialog.tsx` (export them if they're file-local).

- [ ] **Step 4: Run them to verify they pass**

Run: `pnpm vitest run src/ui src/model`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/ui src/model
git commit -m "feat(settings): AI section for provider, model and key"
```

---

### Task 6: Conversation state and `useAsk`

**Files:**
- Create: `src/ask/conversation.ts`, `src/ask/useAsk.ts`
- Modify: `src/editor/EditorHost.tsx` (`TextBridge.hidden(id: string): [number, number][]`, read with `hiddenRanges` from that Tab's view state, `[]` when not loaded)
- Test: `src/ask/conversation.test.ts`, `src/ask/useAsk.test.ts`, `src/editor/EditorHost.test.tsx` (one test for `hidden`)

**Interfaces:**
- Consumes: `aiAsk`, `aiCancel`, `Message` (Task 4); `redact`, `buildSystem` (Task 4); `TextBridge` (`text`, `hidden`)
- Produces:
  - `interface Turn { role: "user" | "assistant"; text: string; noteTitle?: string; error?: string }`
  - `interface Conversation { turns: Turn[]; streaming: number | null }`
  - `type Action = { type: "ask"; id: number; question: string; noteTitle: string } | { type: "event"; id: number; event: AskEvent } | { type: "stop" } | { type: "clear" }`
  - `reduce(c: Conversation, a: Action): Conversation`
  - `useAsk(opts: { bridge: TextBridge | null; activeTab: { id: string; title: string; language: string; kind: string } | null }): { conversation: Conversation; send(question: string): "sent" | "noNote" | "tooLong" | "busy"; stop(): void; clear(): void }`

- [ ] **Step 1: Write the failing tests**

`conversation.test.ts`:
- `ask` appends a user turn and an empty assistant turn, and sets `streaming` to the id.
- A `text` event with the matching id appends to the last assistant turn. A different id is ignored, so a stale stream can't write into a cleared conversation.
- `done` sets `streaming` to null.
- `error` keeps any text already received, sets `error` to the message, and clears `streaming`.
- `stop` clears `streaming` and keeps the partial text.
- `clear` while streaming empties the turns (`useAsk` cancels the request).

`useAsk.test.ts`, with `aiAsk` mocked:
- `send` builds `system` from the redacted active Tab text, and `messages` from earlier turns plus the question. The hidden range text isn't in any argument.
- The active Tab changes after `send` while the stream runs. Events still land in the same assistant turn, and the next `send` uses the new Tab's text.
- `send` with `activeTab.kind !== "text"` returns `"noNote"` and doesn't call `aiAsk`.
- `send` while `streaming !== null` returns `"busy"`.
- `clear()` and unmounting call `aiCancel` with the running id.

- [ ] **Step 2: Run them to verify they fail**

Run: `pnpm vitest run src/ask src/editor/EditorHost.test.tsx`
Expected: FAIL

- [ ] **Step 3: Implement `reduce`, `useAsk` and `TextBridge.hidden`**

Ids come from a module-level counter starting at 1. Earlier assistant turns that ended in an error are left out of `messages`.

- [ ] **Step 4: Run them to verify they pass**

Run: `pnpm vitest run src/ask src/editor`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/ask src/editor
git commit -m "feat(ask): conversation state for questions about the open note"
```

---

### Task 7: The Ask panel in the app

**Files:**
- Create: `src/ask/AskPanel.tsx`, `src/ask/ask.css`
- Modify: `src/app/shortcuts.ts` (`| { type: "toggleAsk" }`, Mod+J with no Shift or Alt), `src/app/shortcutList.ts` (group `Panels`, action `Ask panel`, keys `[["Mod", "J"]]`, command `toggleAsk`), `src/App.tsx`, `CONTEXT.md` (Ask panel: "on the right of the editor area; Mod+J shows or hides it")
- Test: `src/ask/AskPanel.test.tsx`, `src/app/shortcuts.test.ts`, `src/app/shortcutList.test.ts`, `src/App.test.tsx`

**Interfaces:**
- Consumes: `useAsk` (Task 6); `AiStatus`, `aiStatus` (Task 4); `renderMarkdown` (`src/markdown/render.ts`); `clampTerminalSize`, `askWidth`, `ASK_MIN_WIDTH` (Task 5)
- Produces: `AskPanel(props: { ask: ReturnType<typeof useAsk>; scopeLabel: string | null; providerLabel: string; width: number; onWidth(px: number): void; onClose(): void; onOpenUrl(url: string): void; onFocusEditor(): void })`

The layout, top to bottom:
- **Header:** the title `Ask`, a scope chip reading `This note · <Title>` (or `No note` when `scopeLabel` is null), `New conversation` (calls `clear`) and `×`.
- **Turns:** questions as plain text, answers as `renderMarkdown` HTML with the Markdown preview's link handling (web links go to `onOpenUrl`).
- **While streaming:** a `Stop` button and, under the input, `Asking <providerLabel>…`, e.g. `Asking Anthropic · claude-sonnet-5-5…`.
- **Input:** a textarea. Enter sends, Shift+Enter adds a newline, Esc calls `onFocusEditor`.
- **Messages:** `noNote` shows `Ask works on text notes for now.` and `tooLong` shows `This note is too long to ask about.`
- **Left edge:** a drag handle for the width, like the Terminal panel's.

App:
- App holds `aiStatus` (loaded once at startup with `aiStatus()`, refreshed through `onAiStatus` from Settings) and `askOpen` (not stored, so it starts closed, like the Terminal panel).
- `toggleAsk` does nothing unless `aiStatus.ready`.
- The panel renders only when `aiStatus.ready && askOpen`. It sits as the last child of the editor-area flex row, so with the Terminal docked at the bottom, the Ask panel spans the editor and the terminal. Wrap the existing editor and terminal block in a column and put Ask beside it.
- The panel is lazy-loaded like `TerminalPanel`.

- [ ] **Step 1: Write the failing tests**

- `shortcuts.test.ts`: Ctrl+J on Windows and Cmd+J on mac give `{ type: "toggleAsk" }`. Ctrl+Shift+J gives null.
- `shortcutList.test.ts`: add `toggleAsk: true` to the command map the test checks.
- `AskPanel.test.tsx`:
  - Enter calls `ask.send` with the text and clears it. Shift+Enter doesn't send.
  - A `noNote` result shows the copy above.
  - While streaming, Stop calls `ask.stop` and `Asking Anthropic · claude-sonnet-5-5…` shows.
  - An answer with `**bold**` renders a `<strong>`.
  - An answer with a `<script>` tag renders no script element.
- `App.test.tsx`:
  - With `aiStatus` mocked to `ready: false`, Mod+J shows no panel, and no element has the accessible name `Ask`.
  - With `ready: true`, Mod+J opens the panel and Mod+J again closes it.

- [ ] **Step 2: Run them to verify they fail**

Run: `pnpm vitest run src/ask src/app src/App.test.tsx`
Expected: FAIL

- [ ] **Step 3: Implement `AskPanel`, the shortcut and the App wiring, and update CONTEXT.md**

- [ ] **Step 4: Run the full checks**

Run: `pnpm test; pnpm typecheck; pnpm lint; cd src-tauri; cargo test; cargo clippy -- -D warnings`
Expected: all PASS, no warnings.

- [ ] **Step 5: Check it in the real app**

Run `pnpm app`, set an Anthropic key in Settings → AI, open a Markdown note with a hidden range, press Mod+J and ask "summarise this". The answer streams. Stop works. Quitting mid-answer exits within 5 s. Then set OpenAI-compatible to a local Ollama (if one is available) with no key and ask again.

- [ ] **Step 6: Commit**

```bash
git add src CONTEXT.md
git commit -m "feat(ask): the Ask panel, Mod+J, questions about the open note"
```

---

## After this plan: Ask plans 2–5

Each one gets its own plan once the one before it ships.

2. **Ask tools and the wider scopes:** the read-only list, search and read tools in Rust inside the grants; Excluded from Ask (the built-in patterns, `.gitignore`, the user's patterns in Settings → AI); the This folder and Library scopes; tool-use loops for both API formats; the step list in the panel.
3. **Mermaid and Open as Canvas:** render ```` ```mermaid ```` in answers, the Markdown preview and the Rich editor; Open as Canvas with `@excalidraw/mermaid-to-excalidraw`, loaded on demand.
4. **Ask history and Save as note:** the last ~20 conversations for 30 days in the app data folder; Save as note into a Markdown File or a Scratchpad.
5. **Proposed edits:** **this is blocked on Compare (M5)**, which isn't built yet (`@codemirror/merge` isn't a dependency). Build Compare first, then proposals, reviewed chunk by chunk, that become ordinary undoable edits, plus proposed new notes and Canvases.
