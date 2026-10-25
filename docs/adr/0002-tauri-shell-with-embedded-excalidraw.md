# 2. Tauri 2 shell with embedded Excalidraw

Date: 2026-10-25
Status: Accepted

## Context

Zukai needs an Excalidraw-style infinite canvas (freehand drawing, shapes, arrows, connectors, pan and zoom) and must also be "fast enough to replace Notepad." The canvas is by far the most expensive feature to build.

The options we considered:
- **Fully native UI** (WinUI, Qt): fastest startup and the most native feel, but the canvas would have to be built from scratch.
- **Electron with a web UI:** the same Chromium on every platform and a large ecosystem, but large installers (~100 MB), higher memory use at idle, and slower cold start.
- **Tauri 2 with a web UI:** uses the webview already installed on the system (WebView2 on Windows, WKWebView on macOS), produces installers of a few MB, and has a Rust back end.

## Decision

Build Zukai as a Tauri 2 app with a web UI, and embed the MIT-licensed `@excalidraw/excalidraw` React component for Canvas Documents. Canvas Files use the `.excalidraw` format.

## Consequences

- We get the canvas features and a file format other tools understand without building them ourselves.
- The UI is React, because that's what Excalidraw needs.
- Rust handles the parts that touch the operating system: watching open Files for Disk changes, writing autosaves safely, storing Scratchpads, and the global quick-capture shortcut.
- How the app renders depends on the system webview. Windows and macOS are well supported, but WebKitGTK on Linux is weaker and may need workarounds.
- Excalidraw is a large bundle. To keep startup fast, it should be loaded only when the first Canvas Tab opens, so text-only sessions never pay for it.
