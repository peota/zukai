# 6. v1 ships on Windows, macOS and Linux together

Date: 2026-10-25
Status: Accepted

## Context

Tauri 2 (ADR 0002) can build for Windows, macOS and Linux, but each platform brings its own work. Each has a different webview (WebView2, WKWebView, WebKitGTK), different modifier keys and shortcut conventions, its own app data folder, different tray behavior, and its own installer signing. We considered shipping Windows first and porting later.

## Decision

v1 is built, tested and released on Windows, macOS and Linux at the same time.

## Consequences

- Shortcuts are defined in terms of `Mod` (Ctrl on Windows and Linux, Cmd on macOS) and follow each platform's conventions.
- Storage paths always come from Tauri's path APIs. Nothing hard-codes `%APPDATA%`.
- CI builds and tests all three targets. Releases need Windows code signing and Apple notarization.
- WebKitGTK on Linux is the riskiest webview, especially for Excalidraw's performance on the canvas, and has to be tested early.
- Tray icons and global shortcuts aren't uniformly available on Linux. GNOME hides tray icons without an extension, and Wayland doesn't let apps register global shortcuts. To cover this, `zukai --capture` triggers Quick capture from any desktop's own shortcut settings, and running `zukai` again brings up the hidden window when there's no tray icon.
- Every polish pass and bug fix has to be checked on all three platforms.
