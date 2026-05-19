# Nexus User Manual

Last updated: 2026-05-19
Audience: End users and onboarding admins

This guide explains how to use every active Nexus application feature from a user point of view.

## 1. Before You Start

Nexus is a browser workspace with app windows and a Finder-style file system.

Core ideas:
- Finder is where you organize files.
- Apps open files from Finder.
- Changes autosave in supported apps.
- Realtime sync keeps multiple sessions/devices updated.

Active app surfaces:
- Finder
- Tasks
- Quartz
- Calendar
- Images
- Audio
- User (account panel)
- Workspace Preferences (theme + wallpaper controls)

Retired surfaces (do not expect these):
- Notes app
- Time Card app

## 2. Finder (Full Function Breakdown)

Finder is the central file manager.

### 2.1 Finder Sections (left panel)

Sections shown:
- Tasks
- Quartz
- Images
- Audio
- Favorites
- Trash

How sections behave:
- Clicking a section loads that section's content list on the right.
- Favorites and Trash are special sections:
  - Favorites is a virtual list of favorited files.
  - Trash is a file recovery and permanent-delete area.

### 2.2 Opening files

- Click a file row to open it in the appropriate app.
- If no app exists for that file type yet, the row can appear as non-openable.

### 2.3 Create functions

You can create from folder rows:
- Create subfolder.
- Create new file (type depends on section/workflow).

Expected result:
- New item appears in the list.
- Lists stay alphabetically ordered.

### 2.4 Rename functions

- Use the rename action on folder/file rows.
- Blank names are rejected.
- Names starting with a period are rejected.
- Some workspace/system folders are protected and cannot be renamed.

### 2.5 Move functions

- Files and folders can be moved inside allowed Finder sections.
- Cross-section moves are controlled by workspace rules.

### 2.6 Favorites functions

- Click star action on a file to add/remove favorite.
- Favorites applies to files (not folders).
- Favorites section shows only favorited files.
- In Favorites section, removing favorite removes the row immediately.

### 2.7 Delete functions (important)

Nexus has two delete paths:

1. File delete from normal sections:
- Action: delete button on file row, or drag file row onto Trash section.
- Result: file is moved to Trash (not permanently removed immediately).

2. Folder delete:
- Action: delete button on folder row.
- Result: permanent delete of the folder and everything inside it after confirmation.
- Folder delete does not go through Trash.

Protected folders:
- Workspace layout folders are protected and cannot be deleted from UI.

### 2.8 Trash functions

Trash is for file recovery and final deletion.

Inside Trash, each file has:
- Restore action: moves file back to previous valid location.
- Delete permanently action: permanently removes file after confirmation.

Rules:
- Permanent delete only works on files currently in Trash.
- Restored files disappear from Trash list immediately.

### 2.9 Finder drag-and-drop to Trash

- Drag a file row onto Trash in sidebar to trash it quickly.
- Drag-to-Trash is file-only behavior.

## 3. Tasks App (Full Function Breakdown)

Tasks manages checklist-style documents.

Main functions:
- Create/edit task rows.
- Toggle completion for tasks and subtasks.
- Add subtasks under a task.
- Rename task/subtask rows.
- Delete task/subtask rows.
- Reorder tasks via drag-and-drop.

Behavior details:
- Parent completion reflects subtask completion when subtasks exist.
- Progress display updates as subtasks change.
- Changes autosave automatically.

## 4. Quartz App (Full Function Breakdown)

Quartz is the unified note-style editor surface.

Main functions:
- Open and edit note-style files.
- Autosave linked documents.
- Support shorthand entry patterns in top-level lines.

Known shorthand behavior:
- `10-` expands to `10:00-`.
- `1345-` expands to `13:45-`.
- `now-` expands to current rounded time.

Notes:
- Quartz replaces old Notes/Time Card app flows.
- In standalone mode, editing can be shown without linked persistence context.

## 5. Calendar App (Full Function Breakdown)

Calendar supports event planning views and modal editing.

Main functions:
- Navigate by today/previous/next.
- Switch view: Month, Week, Day.
- Open event modal.
- Create event with title/date/all-day/time/calendar/color.
- Save event.
- Delete event.

Sidebar functions:
- Mini calendar navigation.
- Calendar list display.

Persistence behavior:
- Calendar events save to embedded calendar storage.

## 6. Images App (Full Function Breakdown)

Images displays image assets selected from Finder.

Main functions:
- Open image file from Finder.
- Render full image in image stage.

If no image is selected:
- App shows an empty-state prompt to select an image.

## 7. Audio App (Full Function Breakdown)

Audio plays supported audio files from Finder.

Main functions:
- Open audio file from Finder.
- Play/pause transport control.
- Seek via waveform interaction.
- Drag/drop audio files into the audio surface (supported by controller behavior).

If no audio is selected:
- App shows an empty-state prompt.

## 8. User App (Account Functions)

User panel functions:
- View username and email.
- Open security reset options.
- Log out.

Security update functions:
- Update username (requires current password).
- Update password (requires current password and confirmation).

## 9. Workspace Preferences

Workspace preference functions:
- Get current workspace preference payload.
- Update theme.
- Apply wallpaper image.

Current constraint:
- Theme gradient wallpaper mode is retired and rejected.

## 10. Realtime and Autosave Expectations

Users should expect:
- Changes in one session appear in other active sessions quickly.
- Supported editor surfaces save without manual save button workflows.
- Finder structure updates propagate across open Finder windows.

## 11. Common Warnings and Limits

- Some system folders cannot be renamed or deleted.
- Only files can be favorited.
- Only files in Trash can be permanently deleted.
- Folder delete is destructive and does not route through Trash.

## 12. Quick User Onboarding Checklist

1. Open Finder and review sections: Tasks, Quartz, Images, Audio, Favorites, Trash.
2. Create a test file in Tasks.
3. Favorite and unfavorite the file.
4. Delete the file, open Trash, restore it.
5. Delete again and permanently delete from Trash.
6. Open Quartz and edit a note.
7. Open Calendar and create/delete a test event.
8. Open User panel and verify account info.
9. Change theme/wallpaper preferences and confirm persistence.

## 13. Admin Handoff Notes

When handing Nexus to users, provide:
- This manual.
- Basic account/login instructions.
- Any organization-specific naming conventions for folders/files.
- A backup/recovery policy for permanently deleted folders/files.
