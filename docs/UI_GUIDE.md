# Nexus — UI Guide

How the Nexus interface works. Reference for understanding and using the app.

---

## Overview

Nexus is a split-pane app shell with an **Organizer** on the left and a **Main window** on the right.

- The Organizer shows your folder tree and items.
- Clicking an item opens it in the main window.
- Clicking it again closes the main window.
- Switching to a different item swaps the content without replaying the open animation.

---

## Organizer

The left pane. Contains your folder tree and user controls.

### Folders

- Clicking a folder **expands or collapses** its item list.
- Clicking a folder does **not** open the main pane.
- The `+` button next to a folder opens a creation modal for a new note or task list inside that folder.
- Each folder shows a live item count badge.

### Items (Notes & Task Lists)

- Clicking an item **opens** it in the main pane.
- Clicking the same item again **closes** the main pane.
- Items are always sorted alphabetically within their folder.
- Deleting an item does not collapse the folder — the folder stays open and the item removes in place.
- Renaming an item re-sorts the folder list alphabetically immediately.

### Creation Modal

- Triggered via the `+` button on a folder row.
- Choose: Note or Task List.
- Enter a name and confirm.
- The new item appears inline under its folder and the main pane opens it immediately.

### User / Auth Controls

- The auth area is at the top of the organizer.
- Click to open a dropdown for sign out or account options.

---

## Main Window

The right pane. Opens when you select an item.

### Notes

- A single editable title at the top.
- A text body below.
- Changes autosave as you type (no explicit save needed).
- The organizer label updates immediately after a title change.

### Task Lists

- A single editable title at the top.
- Tasks are added with the **+ Add Task** button.
- Each task row has:
  - A **checkbox** to mark complete.
  - An editable **text label**.
  - A **note toggle** (`≡`) to open an inline note for that task.
  - A **subtask expander** (`∨`) to add and view subtasks.
  - A **delete** button.
- Tasks with all subtasks complete are shown as complete.
- Adding a new subtask closes any open inline notes automatically.

### Task Inline Notes

- Click the `≡` icon on a task row to open an inline note for that task.
- Only one note is open at a time — opening another closes the previous one.
- Notes slide open and closed smoothly.
- Notes persist with the task list on save.
- The `≡` icon stays visible at all times if a note has saved content. It only appears on hover if the note is empty.

### Subtasks

- Click the `+` button on a main task row to add a subtask.
- Subtasks are visually grouped under their parent task.
- Parent task completion is derived from subtask completion when subtasks exist.
- A left-to-right progress fill on the parent row reflects subtask completion ratio.

### Autosave

- Title edits, body edits, task add/remove, and subtask toggles all trigger autosave automatically.
- No manual save button is required (though one is available).

---

## Window Layout & Resize

- The **organizer width** is fixed. The seam between organizer and main window can be dragged.
- Dragging the seam moves the main window's left edge — it does not resize the organizer.
- The organizer performs vertical resize when the main window is open.
- When the main window is collapsed, right-edge handles appear on the organizer for vertical resize.
- The main window enforces a minimum width to keep content readable.

---

## Animations

- The main window **slides in from the seam** when opening an item.
- Closing slides it back.
- Switching between already-open items swaps content without replaying the open animation.
- The rounded right corners are preserved throughout the open/close mask.
- Subtask rows slide in/out vertically.
- Inline task notes slide open/closed.
- Completion fill on main tasks animates smoothly between ratio values.

---

## Tools (Non-item Windows)

Tools (e.g., Conversion Table) open in the main pane like items but are not stored in the organizer tree.

- Selecting a Tool collapses all open folder panels in the organizer for a clean view.

---

## Color Palette (Reference)

The UI uses a dark blue-gray palette:

| Surface | Color |
|---|---|
| Organizer shell | `#13141C` |
| Organizer header | `#151619` |
| Auth dropdown | `#202125` |
| Main window body | `#171823` → `#11121A` gradient |
| Active item highlight | Blue accent |
