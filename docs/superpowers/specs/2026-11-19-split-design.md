# Zukai — Split

Date: 2026-11-19
Status: Draft, waiting for approval

Background reading: the glossary [`CONTEXT.md`](../../../CONTEXT.md) (**Split**, **Tab**, **Kind**, **Markdown preview**) and [ADR 0010](../../adr/0010-v1-milestone-order.md) (Split is part of M5).

## 1. Intent

The owner wants two things on screen at once, for example an Excalidraw flow beside its notes. The vision already fixes the shape: a **Split** is exactly two Tabs joined into one tab in the single tab bar. This slice builds it, and adds a **top and bottom** layout, with side by side as the default. Compare, the other half of M5, is not part of this slice.

## 2. Decisions (approved 2026-11-19)

1. A Split pairs exactly **two** Tabs. There is no grid and no nesting, and there can be several Splits, each its own pair.
2. A Split shows in the **single tab bar** as one joined tab: `flow.excalidraw | note.md`. There is no second tab bar.
3. A Tab belongs to **at most one** Split, and the same Tab can't be shown on both sides.
4. **Side by side** by default. **Top and bottom** is the other orientation, chosen per Split.
5. There are **three ways** to make a Split:
   - **Split with ▸** in a tab's right-click menu
   - **Mod+\\**
   - dragging a tab onto the edge of the editor area

## 3. Behaviour

**Making and ending a Split**

- **Split with ▸** (in a Tab's menu) lists the other open Tabs that aren't in a Split. Picking one makes a Split with the right-clicked Tab first: left, or top.
- **Mod+\\** on a Tab outside a Split splits it with the Tab that was active just before it. If there's none, it does nothing. On a Split, Mod+\\ unsplits it.
- **Dragging a Tab onto the editor area** shows a drop zone on the side it would take: the right edge for side by side, the bottom edge for top and bottom. Dropping makes a Split of the shown Tab and the dragged one, with the dragged Tab on that side.
- **Unsplit** (from the joined tab's menu, or Mod+\\) turns the pair back into two ordinary Tabs, next to each other, with the focused one active.

**The joined tab**

- It sits where the pair's first Tab was. Both members stay next to each other in the tab order and move together when dragged.
- It shows both titles; the focused half's title is brighter.
- Its × closes **both** Tabs. Each goes to Recently Closed as usual, and reopening brings them back as ordinary Tabs.
- Its right-click menu has these items:
  - **Unsplit**
  - **Swap sides**
  - **Side by side** / **Top and bottom**
  - **Close split**
  - the usual Pin and Recently Closed items
- Pinning a Split pins both members.

**Using a Split**

- **Focus.** One half has focus. Clicking in a half focuses it, and its Tab becomes the active Tab. Every command, the status bar and Settings act on the focused half, so nothing else in the app has to know about Splits. The focused half has a thin accent line.
- **Selecting the joined tab** shows the Split and focuses the half that last had focus.
- **Mod+W** closes the focused half only. The other becomes an ordinary Tab.
- **Each half is a full Tab.** It keeps its own Kind (text, canvas or image), cursor, word wrap, Language, file bar and Markdown preview. A Markdown note in preview Split inside a Split shows three columns; that's allowed.
- **The divider.** Drag it, use the arrow keys, or double-click it to go back to half and half. Each half keeps at least 20%. The ratio is stored per Split.
- **Keys.**
  - App shortcuts reach a canvas half as they do today. Excalidraw's own keys reach only the canvas that has focus.
  - An image half reacts to zoom keys only while focused.
- **Opening a file.** Files opened from the sidebar, or a new Tab, go **after the joined tab**, never inside it.

**Session**

- Splits are stored in the Session: the two member ids, the orientation, the ratio and the focused side.
- On restore, a Split whose member is gone, appears twice, or isn't a Tab any more is dropped. Its Tabs stay as ordinary Tabs.
- Members found apart are moved next to each other.

## 4. Design

- **Model.** `WorkspaceState` gains `splits: Split[]`:
  - each Split is `{ a, b, orientation: "row" | "column", ratio, focus: "a" | "b" }`
  - `activeId` stays the focused half's Tab, so existing commands are unchanged
  - pure functions in `model/workspace.ts` keep the rules: members next to each other, at most one Split per Tab, and pins shared between members
  - `closeTab`, `moveTab`, `reopenClosed` and `setPinned` follow those rules
- **Editor.** `EditorHost` can show **two** views at once. App passes `slots`, a map from Tab id to the element its view should sit in. Each view keeps its own undo history across Split and Unsplit, because nothing is destroyed.
- **Canvas and Image.** One `CanvasHost` or `ImageHost` per visible half, keyed by Tab. Only the focused one takes keyboard input.
- **Layout.** A new `SplitView` lays out two halves and the divider for an orientation. `SplitHandle` gains a vertical form. Each half is a `TabPane` (editor slot, canvas, image, Markdown preview and file bar). The single-Tab case is a lone `TabPane`.
- **Tab bar.** `TabBar` takes joined items, `{ kind: "split", … }`. Dragging a Tab out over the editor area is reported to App, which shows the drop zones.

## 5. Out of scope

- Compare (diff) Splits
- a Tab on both sides
- more than two halves
- splitting from the Command palette (there isn't one yet)
- reopening a closed Split as a Split

## 6. Testing

- **Model.** Make, unsplit, swap, set the orientation and set the ratio. The rules still hold through moving, closing, pinning and reopening. Session round trip, and dropping malformed Splits.
- **Hooks.** Mod+\\ with and without a previous Tab, and on a Split. Closing the focused half. New Tabs land after the joined tab.
- **UI.**
  - the joined tab's titles, menu and ×
  - **Split with ▸**
  - the drop zones
  - the divider in both orientations
  - two text views at once, each keeping its own undo
  - a canvas beside text
  - image keys only while focused
- **Browser check.** Side by side and top and bottom, in light and dark.
