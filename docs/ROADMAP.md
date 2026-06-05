# Nexus Roadmap and Open Work

Last updated: 2026-05-19

## Current Priority

Primary objective remains preserving and improving the "live and snappy" experience, with immediate focus now on Finder cleanup and layout workflows.

## Newly Completed Baseline (May 2026)

1. Window movement/snap refresh
- Classic top chrome restored.
- Edge drag affordance retained and polished.
- Delayed title snap ghost and delayed resize snap preview shipped.
- Escape-to-dismiss snap zone behavior shipped.
- Multi-anchor title snap behavior shipped.

2. Finder quality-of-life updates
- Image row "set as desktop wallpaper" quick action shipped.
- Finder last section persistence shipped (`finder.last_section`).

3. Stability
- Window drift on refresh fixed with transform-safe bounds persistence.

## In-Flight / High Priority

1. Finder context menu migration (row cleanup)
- Replace row action buttons with right-click actions: rename, delete, set wallpaper (image only), favorite/unfavorite.
- Keep keyboard-accessible equivalents for all actions.

2. Drag-and-drop favorite flow
- Allow dragging files/folders into Favorites, mirroring trash drop affordance quality.
- Add hover/target states and optimistic UI feedback.

3. Desktop file interactions
- Add drop target support for desktop to accept files/folders.
- Define collision and placement rules so icon layout stays deterministic.

## Near-Term Improvements

1. Workspace app (saved layouts)
- New app to capture, name, and restore workspace window layouts.
- On restore, show clear missing-file diagnostics when saved docs no longer exist.

2. Developer board app
- Project board for ideas, implementation steps, and status tracking.
- Link cards to files/windows/documents to keep context close to work.

3. OS sound system
- Add event-driven sound hooks (open, close, error, complete).
- Gate sounds behind user preferences and provide low-latency preload strategy.

## Medium-Term Direction

1. Nexus-trained AI companion
- Assistant app that can reason over workspace state, create/manage files, and execute constrained workflow actions.
- Start with safe, auditable actions and explicit user confirmation on write/destructive operations.

2. Observability for UX-critical paths
- Lightweight instrumentation around drag/snap/Finder operations to catch regressions quickly.

3. Feature-level reliability checks
- Add smoke checks covering window restore, Finder section restore, and core drag/drop flows.

## Unresolved Questions

1. Should desktop icons be persisted as absolute coordinates, grid slots, or a hybrid model?
2. Should workspace restore reopen all missing docs as placeholders, or skip and summarize missing items?
3. Should context-menu actions be implemented with one shared action bus for Finder and future desktop surfaces?

## Completion Signals

The current phase can be considered complete when:

- cross-device updates are consistently immediate in production for all major apps
- image/wallpaper open latency is reliably low
- deploy process is stable and quiet
- docs remain synchronized with actual behavior
- Finder row actions are consolidated into context menus without discoverability regressions
- users can save/load workspace layouts with explicit missing-file feedback
