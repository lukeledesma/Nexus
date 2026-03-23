# Copilot Sections

Updated: 2026-03-22
Scope: Major changes only (kept under 10240 chars)

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
