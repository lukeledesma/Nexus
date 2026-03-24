# Copilot Sections

Updated: 2026-03-24
Scope: Major changes only (kept under 10240 chars)

## Latest Major Changes (2026-03-24)
- Restored original NEXUS visual tone for the Organizer/Main split-pane look while keeping the new window-manager behavior:
  - Organizer header spacing tuned to `12px 12px 4px 12px`.
  - Organizer chrome restored to darker original-style palette (`#12141C`, auth controls `#28282C`).
  - Main pane/window body restored to original-style deep gradient (`#171823` -> `#11121A`) with classic border/shadow balance.
  - Sidebar spacing/section rhythm reset to old proportions (header/nav paddings and margins) and active-item blue highlight restored.
  - Initial pane geometry now matches legacy proportions more closely (`320px` organizer width, `top: 60px`, `height: 100vh - 140px`, responsive main width with right margin).
- Window seam behavior tuned for appearance and feel:
  - Organizer now performs vertical resize only when window is open (height changes).
  - Horizontal edge-drag on organizer moves the seam and squishes/expands the main window instead of changing organizer width.
- Organizer right-side resizing enabled when window collapsed:
  - Right-side handles (top-right, right, bottom-right) now appear when organizer is the only visible pane (window collapsed).
  - Right-edge drag moves the seam (affects main window width), not organizer width; organizer width always stays locked.
  - Top-right and bottom-right corners allow vertical resize only (no horizontal stretch); corner drags move seam horizontally and resize vertically.
  - Provides intuitive collapsed UI without breaking the seam-lock constraint.
- Conversion table responsive behavior now follows pane width and preserves two-column layout when room exists:
  - Switched to component-width behavior so conversion layout responds to the window pane, not browser viewport.
  - Standard + Metric cards now render as equal-width columns side-by-side when pane width is sufficient.
  - At narrow pane widths (`@container max-width: 760px`), Metric stacks under Standard instead of hiding.
  - Table columns are normalized to equal widths for cleaner scan/readability.
  - Main pane resize now enforces a conversion-app content minimum width so the window cannot be shrunk below readable column content.
- Shared main-pane minimum width now applies across app windows:
  - Journal/Task List now use the same horizontal minimum width floor as Conversion by default.
  - Added global app-surface variable (`--app-main-min-content-width: 432px`) so future apps inherit the same baseline without extra JS.
  - Window manager now enforces `max(base minimum, shared app minimum, conversion content minimum)` to keep UX consistent while preserving conversion-specific safety.
- Organizer seam drag/resize no-snap refinement:
  - Removed organizer horizontal snapping based on main pane minimum-width constraints.
  - Organizer edge-drag now clamps only to organizer-in-viewport bounds, so seam movement tracks pointer smoothly.
  - Main pane minimum-width floor is still enforced for direct main-window resizing.
- Organizer header divider restoration:
  - Restored only the single gray separator line under the user/auth area above Organizer content.
  - No additional borders were added elsewhere.
- Organizer header spacing fix:
  - Removed the inherited 8px (`0.5rem`) bottom gap from legacy organizer-header styles.
  - Header padding is now exactly `12px 12px 12px 12px`.
- Organizer shell color alignment:
  - Updated `.organizer-window` background to `rgba(18, 19, 28, 0.9)` to match the original organizer tone.
  - This also aligns the user-dropdown outer padding area color with the organizer body.
- Organizer/auth precise color calibration:
  - Organizer shell/body surfaces set to `#13141C` (`.organizer-window` and organizer sidebar within it).
  - User padding/header strip set to `#151619` (`.organizer-header`).
  - User dropdown surfaces set to `#202125` (`.organizer-header .auth-menu-toggle` and `.auth-menu-dropdown`).
- Organizer auth spacing/alignment polish:
  - Restored original-style asymmetric padding (`12px 16px`) for header strip and dropdown button.
  - Email text is now left-aligned in the dropdown button to hug the left side like original.
- Organizer auth control thickness parity:
  - Matched original launcher control metrics for organizer auth button: `padding: 8px 12px`, `font-size: 0.85rem`, `border-radius: 8px`, and lighter border alpha.
  - Added `position: relative` on organizer auth wrapper to mirror original dropdown anchoring context.
- Window depth/shadow layering restoration:
  - Increased split-pane shadow intensity to better match original depth.
  - Set organizer above main pane (`z-index` organizer > main) so organizer shadow visually overlaps seam while main shadow sits underneath.
- Shadow intensity rebalance (final pass):
  - Normalized both organizer and main pane shadows to original intensity (`0 8px 24px rgba(0,0,0,0.4)`).
  - Preserved organizer-over-main seam layering so depth remains visible without organizer overpowering the window shadow.
- Main window shadow visibility pass:
  - Main pane shadow now matches organizer exactly (`0 8px 24px rgba(0,0,0,0.4)`) per final visual parity request.
  - Organizer remains above main (`z-index`) to keep seam layering behavior stable.
- Main shadow now reveals from the seam without clipping its depth.
- Organizer/finder selection-collapse sync:
  - Collapsing a folder now closes the selected/open item if that item belongs to the collapsed folder.
  - Added finder close-request event handling so folder collapse can reliably close app-pane state.
  - Selecting a Tool (e.g., Conversion Table) now collapses all folder panels for consistent organizer behavior.
- Main-pane minimum width stability during off-viewport resize:
  - Fixed resize clamp path that force-fit main window width inside viewport padding.
  - Main window now preserves `minMainWidth` even when dragged/resized partially outside browser bounds.
- Conversion table content restore:
  - Restored missing backend/view wiring for the tool app in deploy repo (`/apps/conversion_chart` route + controller + show view).
  - Fixes empty "Content missing" pane state when selecting Conversion Table.
- Main-window animation polish:
  - Switching between already-open items now swaps content without replaying the seam reveal.
  - Reveal masking now preserves the rounded right corners during open/close, removing the sharp ghost-corner artifact.

## Latest Major Changes (2026-03-22)
- Organizer/Finder behavior now treats folders as inline tree toggles only; item selection is the only action that opens/collapses the Finder pane.
- Added per-folder item creation modal flow (+ on folder row) and immediate inline insertion of created items under that folder.
- Restored single-title inline editing in Note and Task List app windows.
- Implemented live autosave for Note/Task List forms:
  - Renaming title now saves immediately without requiring body/task edits.
  - Task add/remove now triggers autosave automatically.
  - Organizer item labels update immediately after save.
- Added filesystem mirror synchronization for current app model (Folder + Item):
  - New `ItemStorageSyncLite` rebuilds `storage/item_lists` from database state.
  - Folder/item create/update/delete/rename now syncs disk via model `after_commit` callbacks.
  - App behavior now mirrors storage as HMI output for notes/task lists.
- Organizer sidebar behavior refinements:
  - Deleting an item no longer collapses the folder tree (in-place remove, count update, folder remains open).
  - Item rename now re-sorts that folder's item list alphabetically immediately.
  - New item insertion also passes through alphabetical ordering.

## Feature Summary
- Added nested subtasks under main tasks in task list workspaces.
- Main rows can add subtasks and host grouped child rows.
- Parent completion is derived from subtasks when subtasks exist.

## Interaction Model
- Removed checkbox controls/icons from rows.
- Row-click behavior:
  - Main row without subtasks toggles directly.
  - Main row with subtasks toggles expand/collapse (subtasks hidden by default).
  - Subtask row toggles and recalculates parent completion.
- Edit/delete done through modal actions.

## Persistence + Parsing
- In-app data remains nested JSON (tasks + subtasks arrays).
- Disk format is grouped flat lines:
  - - [ ] / - [x] for both main tasks and subtasks.
  - Blank line separates groups.
- Writer and loader were updated in lockstep to preserve round-trip behavior.

## UI Styling Outcomes
- Grouped card behavior:
  - No internal vertical gaps inside a main+subtask group.
  - Clean spacing appears between main task groups.
  - Task list shell now fully collapses when there are zero tasks (no empty padded area).
- Main-row progress fill:
  - Main tasks with subtasks now show a subtle left-to-right completion fill.
  - Fill updates as subtasks toggle and on render/load.
  - Fill now animates smoothly up/down between ratios (e.g., 0% -> 25% -> 50%).
  - Previous completion values are preserved across row rerenders so transitions remain visible.
  - Completion ratio writes are deferred to the next animation frame to prevent snap-to-end updates.
- Alignment:
  - Subtasks stay flush (no indentation drift).
  - Main/subtask text share one left column.
  - Comfortable left padding restored for both.
- Group seams:
  - Child top seam collapsed for connected look.
- Checked visuals:
  - Green fill only; completed rows use neutral borders for calmer visuals.

## Key Files
- app/javascript/controllers/task_list_controller.js
- app/views/documents/edit.html.erb
- app/assets/stylesheets/application.css
- app/services/document_storage_sync_lite.rb
- app/services/document_disk_loader.rb

## Validation
- No diagnostics errors reported on the latest related UI/CSS changes.

## Ongoing Rule
- Keep this file concise and below 10240 characters after every update/change.
- Record only major behavior changes and final state.
