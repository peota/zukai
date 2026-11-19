# Files Save on Ctrl+S — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** By default a File changes on disk only when the owner saves it; Scratchpads keep autosaving; a "Save files automatically" setting restores today's behaviour.

**Architecture:** The Document writer gains a manual mode. When the setting is off, an autosave tick for a File writes its Shadow file (the same `pending/<tab id>.txt` held Tabs already use) and marks `FileInfo.unsaved`. An explicit save calls the writer in `"save"` mode, which runs today's fingerprinted write. One predicate, `inShadow(file)`, replaces the scattered "held and not readonly" checks that decide where a Tab's text lives. Closing a File Tab with unsaved changes awaits a Save / Don't save / Cancel prompt owned by `useWorkspace`.

**Tech Stack:** React 19 + TypeScript, Vitest + Testing Library, Tauri 2 (no Rust changes).

**Spec:** `docs/superpowers/specs/2026-11-19-manual-save-design.md`

## Global Constraints

- Setting: `Settings.autosaveFiles: boolean`, default `false`. Label **Save files automatically**. Hint: "Scratchpads always save themselves. When off, a file changes on disk only when you save it."
- Close prompt copy: title "Save changes to `<file name>`?", buttons **Save**, **Don't save**, **Cancel**.
- Notices: "Resolve the conflict first"; Save all with skipped conflicts: "Not saved (conflict): a.json, b.json".
- Accessible name and tooltip of an unsaved Tab end with " (unsaved)".
- Quitting never prompts. Closing a held Tab never prompts.
- Turning the setting on never writes Tabs that are already unsaved; only a new edit or a save does.
- UI copy uses the words in `CONTEXT.md` (Tab, File, Scratchpad, Unsaved changes).
- Gates before every commit: `npm run typecheck`, `npm run lint`, `npm test`.

## Review Focus

1. **A restart while a File is unsaved, and the File changed on disk while Zukai was closed.** The owner expects their text back, with a Disk conflict, not a silent reload and not a silent overwrite. Test in Task 4: `restores an unsaved File as a conflict when the disk changed while closed`.
2. **Undo back to the saved text.** The dot should disappear and the shadow should be deleted. Test in Task 3: `manual mode deletes the shadow and clears unsaved when the text matches the disk again`.
3. **Typing, then closing within the 300 ms debounce, before the flag is set.** The close must still prompt. Test in Task 7: `prompts when an edit has not reached the shadow yet`.
4. **Close all with two unsaved Tabs, Cancel on the first.** The second Tab must stay open, and no third prompt should appear. Test in Task 7: `cancel stops the remaining closes`.
5. **A Convert, then a Convert back to the original format, with no text edits.** The Tab should be clean again. Test in Task 5: `converting back to the disk format clears unsaved`.

---

### Task 1: The model: `unsaved`, `diskFormat`, `inShadow`

**Files:**
- Modify: `src/model/types.ts` (`FileInfo`)
- Modify: `src/files/fileState.ts`
- Modify: `src/model/session.ts` (`isFileInfo`, `purgeExpired`)
- Modify: `src/app/useWorkspace.ts` (`heldChanged`, line ~76)
- Test: `src/files/fileState.test.ts`, `src/model/session.test.ts`

**Interfaces:**
- Produces:
  - `FileInfo.unsaved?: true` means the Tab's text or format isn't in the File; its text is in its shadow.
  - `FileInfo.diskFormat?: FileFormat` is the File's format on disk, present only while a Convert is unsaved.
  - `inShadow(file: FileInfo): boolean` in `src/files/fileState.ts` returns `file.unsaved === true || (file.held !== null && file.held !== "readonly")`.
  - `onWriteOutcome(file, {kind:"written"})` returns a FileInfo **without** `unsaved` and `diskFormat`.

- [ ] **Step 1: Write the failing tests.**
  - `fileState.test.ts`: `inShadow` is true for `{unsaved:true, held:null}`, for `held:"conflict"`, `"missing"` and `"unencodable"`; false for `held:null` and for `held:"readonly"`. `onWriteOutcome` on a `written` outcome drops `unsaved` and `diskFormat` (`expect("unsaved" in r).toBe(false)`).
  - `session.test.ts`: a Session tab whose file has `unsaved: true` and a valid `diskFormat` round-trips. A file with `unsaved: "yes"`, or a `diskFormat` missing `encoding`, is rejected the way other malformed FileInfo is today. `purgeExpired` keeps forever a closed File with `held:null` and no `unsaved`, and expires a 31-day-old closed File with `unsaved:true`.
- [ ] **Step 2: Run the tests and confirm they fail.** Run `npx vitest run src/files/fileState.test.ts src/model/session.test.ts`. Expected: FAIL, because `inShadow` isn't exported and the session assertions fail.
- [ ] **Step 3: Implement.**
  - Add the two optional fields to `FileInfo`, plus `inShadow`.
  - `isFileInfo` accepts `unsaved` only when it's absent or `true`, and `diskFormat` only when it's absent or a valid format. Factor the existing format check into `isFileFormat(v)`.
  - `purgeExpired`'s "forever" test becomes `!inShadow(e.tab.file)`.
  - `heldChanged` compares `inShadow(file)` per Tab and entry as well as `held`, so the Session is saved as soon as a Tab becomes, or stops being, unsaved.
- [ ] **Step 4: Run the tests and confirm they pass.** Run the same command. Expected: PASS.
- [ ] **Step 5: Commit** with the message `feat(files): FileInfo records unsaved text and a pending format`.

### Task 2: The setting

**Files:**
- Modify: `src/model/settings.ts`
- Modify: `src/ui/SettingsDialog.tsx` (General section, after "Line numbers")
- Test: `src/model/settings.test.ts`, `src/ui/SettingsDialog.test.tsx`

**Interfaces:**
- Produces: `Settings.autosaveFiles: boolean`, with `DEFAULT_SETTINGS.autosaveFiles === false`.

- [ ] **Step 1: Write the failing tests.**
  - `settings.test.ts`: `parseSettings({autosaveFiles:true}).autosaveFiles === true`, and a missing or non-boolean value gives `false`. Extend the existing "keeps valid values" and "defaults alone" cases.
  - `SettingsDialog.test.tsx`: the checkbox labelled "Save files automatically" is unchecked by default and has the hint text from Global Constraints as its description. Clicking it calls `onSettings({autosaveFiles:true})`.
- [ ] **Step 2: Run the tests and confirm they fail.** Run `npx vitest run src/model/settings.test.ts src/ui/SettingsDialog.test.tsx`. Expected: FAIL.
- [ ] **Step 3: Implement.** Add the field, its default and its parsing. Add the row, copying the `z-wrap-new` row's pattern (label, hint and `aria-describedby`), with id `z-autosave-files`.
- [ ] **Step 4: Run the tests and confirm they pass.** Expected: PASS.
- [ ] **Step 5: Commit** with the message `feat(settings): Save files automatically (off by default)`.

### Task 3: The writer's manual mode

**Files:**
- Modify: `src/files/documentWriter.ts`
- Modify: `src/app/useWorkspace.ts` (`writeDoc`, line ~304)
- Modify: `src/app/files/context.ts` (`FilesInternals`)
- Test: `src/files/documentWriter.test.ts`

**Interfaces:**
- Consumes: `inShadow`, `onWriteOutcome` (Task 1), and `Settings.autosaveFiles` (Task 2).
- Produces:
  - `DocumentWriterDeps.autosaveFiles(): boolean`
  - `DocumentWriterDeps.diskText(id: string): string | undefined`, the text last read from or written to the File (`onDisk`)
  - `type WriteMode = "auto" | "save"`
  - `createDocumentWriter(deps)` returns `(id: string, text: string, mode?: WriteMode) => Promise<void>`, with `mode` defaulting to `"auto"`
  - `FilesInternals.saveNow(id: string, text: string): Promise<void>`, which is `writeDoc(id, text, "save")` under the Tab's lock

Rules for a File Tab that isn't held, in `mode === "auto"` with `autosaveFiles()` false:
- If `text === diskText(id)` and there's no `file.diskFormat`: call `shadowDelete(id)`, and patch `unsaved` away if it was set. Write nothing else.
- Otherwise: call `shadowWrite(id, text)`, and patch `unsaved: true` if it isn't already set. Never call `fileWrite` and never call `onWritten`.

Everything else (Scratchpads, held Tabs, `mode === "save"`, and autosave on) behaves exactly as today.

- [ ] **Step 1: Write the failing tests** in `documentWriter.test.ts`. Default the `autosaveFiles` mock to `false` and `diskText` to `"disk"`, and pass `autosaveFiles: () => true` in the existing tests that expect File writes.
  - `manual mode writes the shadow and marks the File unsaved`: `write("f","typed")` calls `shadowWrite("f","typed")`, doesn't call `fileWrite`, and leaves `tabs.get("f").file.unsaved === true`.
  - `manual mode deletes the shadow and clears unsaved when the text matches the disk again`: start with `unsaved:true`; `write("f","disk")` calls `shadowDelete`, and `unsaved` is absent.
  - `manual mode keeps unsaved while a format change is pending`: with `diskFormat` set, `write("f","disk")` calls `shadowWrite`.
  - `save mode writes the File and clears unsaved and diskFormat`: with `unsaved:true` and `diskFormat` set, `write("f","typed","save")` calls `fileWrite` with the Tab's `format` and fingerprint; then `unsaved` and `diskFormat` are both absent and `shadowDelete` is called.
  - `save mode on a conflict holds and keeps the shadow`: the existing conflict test, run in `"save"` mode.
  - `scratchpads ignore the setting`: a Scratchpad still calls `writeScratchpad` with autosave off.
  - In `src/app/useWorkspace.test.ts`, `turning autosave on doesn't write an unsaved File until its next edit`: with an unsaved File Tab, call `setSettings({autosaveFiles:true})` and then flush the savers. `fileWrite` isn't called. After `setContent` and a 300 ms advance, it is called.
- [ ] **Step 2: Run the tests and confirm they fail.** Run `npx vitest run src/files/documentWriter.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** the writer rules above. In `useWorkspace`, pass the new deps: `autosaveFiles: () => settingsRef.current.autosaveFiles` and `diskText: (tid) => onDisk.get(tid)`. Make `writeDoc` take `mode`, and pass `saveNow` into `useFiles`. The Saver keeps calling `write(id, content)`, so autosave ticks stay `"auto"`.
- [ ] **Step 4: Run the tests and confirm they pass.** Run `npx vitest run src/files/documentWriter.test.ts src/app`. Expected: PASS.
- [ ] **Step 5: Commit** with the message `feat(files): with autosave off, File edits go to the shadow`.

### Task 4: Pending, loading, restore, reload and close go through `inShadow`

**Files:**
- Modify: `src/app/files/context.ts` (`hasPending`)
- Modify: `src/app/files/loading.ts` (`readFileText`, `loadContent`, `afterRestore`)
- Modify: `src/app/files/closeReopen.ts` (`closeFile`, `reopenFile`)
- Modify: `src/app/files/diskChanges.ts` (`reloadLocked`)
- Modify: `src/app/files/save.ts` (`saveTo`'s shadow drop)
- Test: `src/app/useFiles.test.ts`

**Interfaces:**
- Consumes: `inShadow` (Task 1), and the writer's manual mode (Task 3).
- Produces:
  - `hasPending(id)` is also true when `tabOf(id)?.file?.unsaved === true`.

Behaviour:
- `readFileText` for a File with `unsaved` and `held === null`:
  - Read the shadow and read the disk. Set `onDisk` to the disk text.
  - If the disk's hash differs from `file.fingerprint`, patch `held: "conflict"`. If the disk is gone, patch `held: "missing"`.
  - Return the shadow text.
  - If the shadow is absent (`null`), fall back to today's disk path, which also clears `unsaved` through `fileInfoOf`.
- `afterRestore`: a shadow for a File Tab that isn't `inShadow` becomes `unsaved: true` when `fileFingerprint(path)` matches `file.fingerprint`. Otherwise it becomes conflict or missing, as today.
- `closeFile`, `reopenFile`, `reloadLocked`'s shadow drop and `saveTo`'s shadow drop all use `inShadow(file)` where they test held today.

- [ ] **Step 1: Write the failing tests** in `useFiles.test.ts`, following the existing mocks of `files/api`:
  - `hasPending counts an unsaved File that isn't loaded`
  - `restores an unsaved File's text from its shadow and keeps it unsaved`
  - `restores an unsaved File as a conflict when the disk changed while closed`: the Session has fingerprint `"a"` and the disk has `"b"`; expect `held === "conflict"` and the shadow text in contents.
  - `an orphaned shadow on an unchanged File restores as unsaved, not a conflict`
  - `a disk change to an unsaved File becomes a Disk conflict`: `decide` already gets `hasPending`, so assert the outcome.
  - `Load disk version on an unsaved File drops the shadow and clears unsaved`
- [ ] **Step 2: Run the tests and confirm they fail.** Run `npx vitest run src/app/useFiles.test.ts`. Expected: the new tests FAIL.
- [ ] **Step 3: Implement** the behaviour above.
- [ ] **Step 4: Run the tests and confirm they pass.** Run `npm test`. Expected: PASS.
- [ ] **Step 5: Commit** with the message `feat(files): unsaved Files restore, reload and close through their shadow`.

### Task 5: A Convert is an unsaved change

**Files:**
- Modify: `src/app/files/barActions.ts` (`applyTabPatch`)
- Test: `src/app/useFiles.test.ts`

**Interfaces:**
- Consumes: `FileInfo.diskFormat` (Task 1). It needs `autosaveFiles()`, so add `autosaveFiles(): boolean` to `FilesInternals` and pass it from `useWorkspace` (`settingsRef`).

Behaviour: when a Convert changes the format and autosave is off, set `diskFormat` to `cur.diskFormat ?? cur.format`. If the new format `sameFormat`s that `diskFormat`, leave `diskFormat` out. Then `keepAside(id)`, as today, and the writer decides about the shadow.

- [ ] **Step 1: Write the failing tests.**
  - `a Convert with autosave off keeps the File unwritten and marks it unsaved`: `fileWrite` isn't called; `diskFormat` equals the old format; `unsaved` becomes true after the Saver runs (use fake timers and advance 300 ms).
  - `converting back to the disk format clears unsaved`
  - `Save after a Convert writes the new format`: `fileWrite` gets the new `lineEnding`.
- [ ] **Step 2: Run the tests and confirm they fail.** Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run the tests and confirm they pass.** Expected: PASS.
- [ ] **Step 5: Commit** with the message `feat(files): Convert waits for save when autosave is off`.

### Task 6: Save and Save all

**Files:**
- Modify: `src/app/files/save.ts` (`save`, new `saveAll`)
- Modify: `src/app/files/index.ts` (`FilesApi`, wiring `saveToOriginal` into `useSave`)
- Modify: `src/app/useWorkspace.ts` (the `save` command flushes the rich editor first; expose `saveAll`)
- Test: `src/app/useFiles.test.ts`

**Interfaces:**
- Consumes: `FilesInternals.saveNow` (Task 3) and `saveToOriginal` (existing, `barActions.ts`).
- Produces:
  - `FilesApi.save(id: string): Promise<void>`, which keeps its signature
  - `FilesApi.saveAll(): Promise<void>`
  - `Workspace.saveAll(): Promise<void>`

`save(id)` for a File, by `held`:

| `held` | What happens |
|---|---|
| `"conflict"` | Notice "Resolve the conflict first". Nothing is written. |
| `"missing"` | `saveToOriginal(id)` |
| `"unencodable"` | Notice "Can't save: some characters can't be written in `<encoding>`" |
| `"readonly"` | Nothing happens. |
| `null` | `await saver.flush(id)`, then, if `hasPending(id)`, `lock(id, () => saveNow(id, contents.get(id)))`. A rejection shows "Not saved" through the existing status path (`logError("save")`). |

`saveAll()` goes through the open Tabs in tab order and saves each File Tab where `hasPending(id)` is true. It skips conflicts and collects their titles into the notice "Not saved (conflict): …". It doesn't stop on an unencodable Tab.

- [ ] **Step 1: Write the failing tests:**
  - `Mod+S writes an unsaved File and clears the dot`
  - `Mod+S on a clean File writes nothing`
  - `Mod+S on a conflict shows a notice and writes nothing`
  - `Mod+S on a Missing File recreates it`
  - `Save all saves every unsaved File and names skipped conflicts`
- [ ] **Step 2: Run the tests and confirm they fail.** Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run the tests and confirm they pass.** Run `npm test`. Expected: PASS.
- [ ] **Step 5: Commit** with the message `feat(files): Save writes unsaved Files; Save all`.

### Task 7: The close prompt

**Files:**
- Create: `src/ui/SaveChangesDialog.tsx`, `src/ui/SaveChangesDialog.test.tsx`
- Modify: `src/app/useWorkspace.ts` (`closeTab`, `closeSplit`, new `closeTabs`, prompt state)
- Modify: `src/app/files/index.ts` (new `internal.discardUnsaved`)
- Modify: `src/App.tsx` (render the dialog; Close others and Close all call `w.closeTabs`)
- Test: `src/app/useWorkspace.test.ts`

**Interfaces:**
- Consumes: `hasPending`, `save` (Task 6), `inShadow`.
- Produces:
  - `type CloseChoice = "save" | "discard" | "cancel"`
  - `Workspace.closePrompt: { id: string; name: string } | null`
  - `Workspace.answerClosePrompt(choice: CloseChoice): void`
  - `Workspace.closeTabs(ids: string[]): Promise<void>` closes in order and stops at the first Cancel.
  - `closeTab(id): Promise<void>` keeps its signature. Internally, `closeOne(id): Promise<boolean>` returns false when cancelled or when the save fails.
  - `SaveChangesDialog({ name, onChoose }: { name: string; onChoose(c: CloseChoice): void })`. It's a modal `role="alertdialog"`. Save is focused, Esc means Cancel, and the copy is from Global Constraints. Copy the overlay styling from `SettingsDialog`.

Flow in `closeOne`, after `flushRich(id)` and before `setClosing`:
1. If the Tab has a File with `held === null` and `hasPending(id)`, show the prompt and await the choice. Prompts are serialized through one promise chain, so only one is open at a time.
2. On **save**: `await save(id)`. If `hasPending(id)` is still true afterwards (a conflict or a failure), return false.
3. On **discard**: call `internal.discardUnsaved(id)`, then carry on with today's close. The saver's final flush sees clean text, so the writer deletes the shadow.

`FilesInternalApi.discardUnsaved(id: string): void` is new, in `src/app/files/index.ts`, built from the context. It calls `replaceText(id, onDisk.get(id) ?? "")`, which sets `contents` and asks the editor to show the disk text. If `diskFormat` is set, it patches the file's `format` back to `diskFormat` and removes `diskFormat`.
4. On **cancel**: return false.

- [ ] **Step 1: Write the failing tests.**
  - `SaveChangesDialog.test.tsx`: shows "Save changes to config.json?"; each button calls `onChoose` with its choice; Esc calls `onChoose("cancel")`.
  - `useWorkspace.test.ts`, with a File Tab and autosave off:
    - `prompts before closing an unsaved File and keeps it open on cancel`
    - `don't save closes and drops the shadow`
    - `save then closes`
    - `prompts when an edit has not reached the shadow yet` (`setContent`, then close immediately with no timer advance)
    - `cancel stops the remaining closes` (`closeTabs([a,b])`, both unsaved, cancel on a; b stays open, and `closePrompt` is null afterwards)
    - `never prompts for a held Tab or a Scratchpad`
    - `quitting never prompts`: the exit flush runs with an unsaved Tab, and `closePrompt` stays null
- [ ] **Step 2: Run the tests and confirm they fail.** Run `npx vitest run src/ui/SaveChangesDialog.test.tsx src/app/useWorkspace.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.** In `App.tsx`, `onCloseOthers` and `onCloseAll` build the id list, keeping today's pinned-Tab filters, and call `w.closeTabs`. `closeSplit` calls `closeTabs([split.a, split.b])`.
- [ ] **Step 4: Run the tests and confirm they pass.** Run `npm test`. Expected: PASS.
- [ ] **Step 5: Commit** with the message `feat(ui): ask before closing a File with unsaved changes`.

### Task 8: The unsaved dot and the Save all menu item

**Files:**
- Modify: `src/ui/TabBar.tsx` (`TabBarItem`, close-button area at line ~406)
- Modify: `src/ui/TabContextMenu.tsx` (new `onSaveAll`, `canSaveAll`)
- Modify: `src/App.tsx` (tab mapping at line ~475, menu props)
- Test: `src/ui/TabBar.test.tsx`, `src/ui/TabContextMenu.test.tsx`

**Interfaces:**
- Consumes: `inShadow` (Task 1), `Workspace.saveAll` (Task 6).
- Produces:
  - `TabBarItem.unsaved?: boolean`, mapped in App as `t.file ? inShadow(t.file) : false`
  - `TabContextMenuProps.onSaveAll(): void` and `canSaveAll?: boolean`. The item is labelled "Save all", sits above "Close all tabs", and is disabled when `canSaveAll` is false.

Dot rules:
- **Unpinned unsaved Tab:** a dot (a `●` glyph or a 8 px circle in `text-muted`) is shown in the close button's slot whenever the Tab isn't hovered, whether it's active or not. The close button replaces it on hover.
- **Pinned Tab:** the dot is shown after the title, before the pin.
- In both cases the Tab's title attribute and its close button's `aria-label` end with " (unsaved)".

- [ ] **Step 1: Write the failing tests.**
  - `TabBar.test.tsx`: `shows a dot for an unsaved Tab and names it in the close button` (`getByRole("button", {name: "Close a.json (unsaved)"})`, plus a `data-testid="unsaved-dot"` element); `a pinned unsaved Tab shows the dot beside the pin`; `a clean Tab shows no dot`.
  - `TabContextMenu.test.tsx`: `Save all calls onSaveAll`, and `Save all is disabled when nothing is unsaved`.
- [ ] **Step 2: Run the tests and confirm they fail.** Run `npx vitest run src/ui/TabBar.test.tsx src/ui/TabContextMenu.test.tsx`. Expected: FAIL.
- [ ] **Step 3: Implement.** `canSaveAll` is `w.state.tabs.some((t) => t.file && inShadow(t.file))`.
- [ ] **Step 4: Run the tests and confirm they pass.** Expected: PASS.
- [ ] **Step 5: Commit** with the message `feat(ui): unsaved dot on tabs; Save all in the tab menu`.

### Task 9: Docs and a check in the running app

**Files:**
- Create: `docs/adr/0012-files-save-on-ctrl-s.md`
- Modify: `docs/adr/0001-files-autosave-to-disk.md` (status line)
- Modify: `CONTEXT.md` (**File**, **Pending edits**, **Disk conflict**, new **Unsaved changes**, **Shadow file**)
- Modify: `PRODUCT.md` (line 23)

- [ ] **Step 1: Write ADR 0012** in 0001's format: Context (the stray-edit risk), Decision (spec §2 goals and the setting), Consequences (unsaved text lives in Shadow files; the close prompt; the dot; Convert waits; quitting never asks).
- [ ] **Step 2: Update ADR 0001's status** to `Status: Superseded in part by [ADR 0012](0012-files-save-on-ctrl-s.md) (now the "Save files automatically" setting)`.
- [ ] **Step 3: Update `CONTEXT.md`.**
  - **File:** a File changes on disk only when saved, unless Save files automatically is on.
  - **Unsaved changes:** a File Tab's text or format that isn't in its File. It's kept in its Shadow file and shown as a dot.
  - **Pending edits** and **Disk conflict:** include Unsaved changes.
  - **Shadow file:** it now holds an unsaved Tab's text too.
- [ ] **Step 4: Update `PRODUCT.md`.** Replace the saving sentence with: "Scratchpads save themselves and the session restores; a File changes on disk only when you save it (or always, with Save files automatically), and nothing is silently overwritten."
- [ ] **Step 5: Check the gates.** Run `npm run typecheck && npm run lint && npm test`. Expected: all pass.
- [ ] **Step 6: Check in the running app** (use the `run` skill). Open a `.json` File and type: a dot appears and the file on disk is unchanged. Press Ctrl+S: the dot clears and the disk has the edit. Type again and close the Tab: the prompt appears, and Don't save leaves the disk unchanged. Type, then quit and relaunch: the text and the dot come back.
- [ ] **Step 7: Commit** with the message `docs: Files save on Ctrl+S (ADR 0012)`.
