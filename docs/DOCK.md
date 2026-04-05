# Dock behavior and persistence

The bottom dock has three parts (left to right): **Launcher**, **pinned** shortcuts, a **divider** (only when needed), and **running** apps (open windows that are not pinned).

## Open vs closed

Whether an app appears with the “open” highlight is driven by **visible app windows in the DOM**: each render, `window-manager` scans `section.content-window.os-window` elements and reads `data-content-window-app-key-value` plus the `is-hidden` class.

That scan runs on every dock refresh (including after `app-window:state`). It fixes full-page reloads: Stimulus connects **child** `content-window` controllers **before** the body `window-manager`, so early `app-window:state` events can fire before the dock listener exists—DOM sync does not rely on those events alone.

## localStorage

| Key | Purpose |
|-----|---------|
| `nexus.dock.pinnedApps` | JSON array of app keys in **pinned strip order** (set from the launcher pin control and from drag between pinned/running). |
| `nexus.dock.runningOrder` | JSON array defining **order of icons in the running strip** for apps that are open and not pinned. Newly opened apps are merged onto the end; closed apps drop out; order is preserved for apps that stay open. |

Both use the same app key strings as `ApplicationHelper#launcher_grid_entries` (`finder`, `singular-note`, etc.). Apps not in the dock icon map (e.g. ad-hoc windows) are not tracked in the dock.

## Pin position

- **Pinned**: order is exactly the array in `nexus.dock.pinnedApps`.
- **Running**: order is `mergeOpenRunningOrder(readDockRunningOrder(), openUnpinnedKeys)` so stored order is kept for still-running apps and new opens append.

Drag from **pinned → running** removes the key from `pinnedApps`. Drag **running → pinned** inserts in the pinned strip; on drop, `pinnedApps` is rewritten from the dock DOM order (filtered to pinnable keys).

## Interaction (dock strip)

- **Pointer drag** (not native HTML5 drag): after a small movement threshold, a **floating** copy of the icon follows the cursor; the source slot goes transparent. Dragging **out of the dock** collapses the slot (width animates to 0). **Within pinned or within running**, icons **slide** with a FLIP animation as you cross midpoint neighbors (macOS-like insertion).
- **Cross-zone** (pinned ↔ running): the dragged icon is inserted into the target strip with the same **FLIP** slide as in-zone reorder (including the **divider** between pinned and running). On release, storage is updated from DOM order and the dock re-renders with **FLIP** from the previous layout snapshot (same idea when pins change from the **launcher**).
