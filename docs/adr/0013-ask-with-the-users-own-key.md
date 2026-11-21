# 13. Ask: AI with the user's own key

Date: 2026-11-21
Status: Accepted. This overrides the vision's "defer … AI features" (section 6) and adds a milestone ahead of the remaining v1 work (ADR 0010).

## Context

The owner wants AI in Zukai without it becoming a platform. The candidates were inline code completion, document summaries, a text-to-speech file reader (ElevenLabs) and more. Each one would add surface, and some fight the product principles: everything local, saving never surprising, stay a notebook.

Engineers already have AI completion in their IDE. Zukai's weak spot is the second half of its purpose, finding a note again later. Its other use is understanding material: a note you're learning from, or a repository you opened.

## Decision

- **One feature: Ask.** A single docked **Ask panel** answers questions in one of three **Ask scopes**: **This note**, **This folder** (a Library folder or an Added folder, such as a repository) or **Library**. Completion, a text-to-speech reader and per-feature popups are out.
- **The user's own key.** The user picks one **AI provider**: Anthropic, OpenAI, or any OpenAI-compatible URL (Ollama, LM Studio, OpenRouter and so on). A local model keeps every note on the machine. The key is stored by Rust in the OS keychain and never in `settings.json`, which is plain text and meant to be shared in dotfiles.
- **Agentic search, no index.** The model gets read-only tools that Rust runs inside the folder grants: list a folder, search text, read a File. There's no embeddings index and no background upload. Only what a question actually reads is sent, and each step shows in the panel.
- **Nothing leaves without Enter.** No suggestions while you type and no background calls. While a request runs, the panel names the provider and model.
- **Secrets stay home.** Hidden text is sent as `[hidden]`. Ask's tools refuse secret-shaped files (`.env*`, `*.pem`, `*.key`, `id_rsa*`, `.npmrc`, `credentials*`), anything `.gitignore` excludes, and the user's own "Excluded from Ask" patterns.
- **Edits are proposed, then reviewed.** Ask can propose changes to Files inside the grants and propose new notes or Canvases. A proposal opens in Compare, and accepted chunks become ordinary undoable edits, so the usual saving rules, Snapshots and Disk conflicts apply. Nothing is written that the user hasn't seen.
- **Diagrams as Mermaid.** Ask draws in Mermaid, rendered in the panel. **Open as Canvas** converts a diagram into an editable Canvas with `@excalidraw/mermaid-to-excalidraw`, which loads only when used.
- **Short history.** The last ~20 conversations are kept in the app data folder for 30 days. **Save as note** turns one into a Markdown File or Scratchpad. Conversations are never filed into the Library by themselves.
- **Invisible until a key is set.** Without a key there's no panel, shortcut or icon, only the AI section in Settings.

## Consequences

- Principle 4 ("no cloud connection") now reads: no cloud connection unless the user sets an AI key, and then only when they press Enter. A local provider keeps it fully local.
- Rust gains a keychain store, the Ask tools (reusing the grants, the find code and a new exclusion check) and an HTTP client for the providers. The webview never sees the key.
- The Markdown preview and the Rich editor must render ```` ```mermaid ```` blocks, so a saved answer still shows its diagrams.
- Questions over a large Library are slower and use more tokens than an index would. That's the price of no background upload.
- The tools must hold the same line as the rest of Zukai: no path outside the grants, no links that escape, no executables run.
