# Nexus Feature Catalog

This document maps each app feature to behavior, routes, and implementation anchors.

## Design Principles Across Features

- Real-time by default when possible.
- Persist user intent clearly and predictably.
- Avoid request storms and excessive write frequency.
- Keep interactions fast and obvious.

## Core Workspace Shell

### Organizer / Desktop / Windowing

Purpose:
- Provides OS-like shell, app launching, pane behavior, and window interactions.

Implementation anchors:
- app/views/layouts/application.html.erb
- app/views/shared/
- app/javascript/controllers/window_manager_controller.js
- app/javascript/controllers/organizer_controller.js
- app/javascript/controllers/finder_browser_controller.js

Expected behavior:
- Stable open/close/toggle interactions.
- No unnecessary animation replay when switching content.
- Responsive resize and pane interactions.

## Finder

Purpose:
- Browse folders/files and perform common file operations.

Routes:
- GET /apps/finder
- POST/PATCH document member actions via /documents/:id/*

Implementation anchors:
- app/controllers/apps/finder_controller.rb
- app/controllers/documents_controller.rb
- app/views/apps/finder/show.html.erb

Expected behavior:
- Folder and file operations reflect quickly.
- Changes should propagate to relevant views/devices.

## Tasks

Purpose:
- Task list editing with subtasks.

Routes:
- GET /apps/tasks
- POST /apps/tasks/save_file
- GET /apps/tasks/draft_file

Implementation anchors:
- app/controllers/apps/tasks_controller.rb
- app/javascript/controllers/task_list_editor_controller.js
- app/views/apps/tasks/

Expected behavior:
- Fast edits and consistent save state.
- Live update propagation across active clients.

## Images

Purpose:
- Open and display image assets from workspace documents.

Routes:
- GET /apps/images
- GET /documents/:id/asset_file

Implementation anchors:
- app/controllers/apps/images_controller.rb
- app/controllers/documents_controller.rb
- app/views/apps/images/show.html.erb

Expected behavior:
- Image asset loading is fast in production.
- Asset bytes are served efficiently by nginx in production path.

## Wallpaper and Theme Preferences

Purpose:
- Manage wallpaper/image selection and workspace visual settings.

Routes:
- GET /apps/wallpaper_iimage/files
- GET /workspace_preferences
- PATCH /workspace_preferences

Implementation anchors:
- app/controllers/apps/wallpaper_iimage_controller.rb
- app/controllers/workspace_preferences_controller.rb

Expected behavior:
- Wallpaper file listing remains responsive.
- Preference changes persist and apply reliably.

## Audio

Purpose:
- Audio app surface and asset playback related workflows.

Routes:
- GET /apps/audio

Implementation anchors:
- app/controllers/apps/audio_controller.rb
- app/views/apps/audio/

## User Settings

Purpose:
- Account-facing settings and identity updates.

Routes:
- GET /apps/user
- PATCH /apps/user/username
- PATCH /apps/user/password

Implementation anchors:
- app/controllers/apps/user_controller.rb
- app/views/apps/user/

## Realtime Sync Feature Layer

Purpose:
- Keep multiple active clients in sync with minimal refresh dependency.

Implementation anchors:
- app/channels/user_sync_channel.rb
- app/javascript/lib/nexus_sync_channel.js
- app/controllers/documents_controller.rb (broadcast call points)
- app/controllers/user_app_states_controller.rb

Expected behavior:
- State and content changes flow to subscribed clients quickly.
- Realtime path remains healthy in production through /cable.

## Feature Removal History

Clock app removal:
- App-level clock feature routes/views/controllers were removed in recent work.
- Desktop clock utility behavior may still exist as shell-level controller.
