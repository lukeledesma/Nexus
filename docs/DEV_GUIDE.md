# Nexus — Developer Guide

Navigation note:

- Start at docs/README.md for the current docs map.
- For latest status and handoff context, read docs/AI_HANDOFF.md first.
- Use this file for deeper implementation details after reading those two files.

Technical reference for contributors working on the Nexus Rails codebase.

This document covers architecture, file structure, frontend controllers, data flow, and deployment behavior.

If you are just trying to understand what Nexus is, read the root README first.

---

## 1. Project Identity

- **App name**: Nexus
- **Stack**: Rails 8.1, PostgreSQL, Puma, Nginx, Stimulus JS
- **Source repo**: [github.com/lukeledesma/Nexus](https://github.com/lukeledesma/Nexus)
- **Public site**: `https://nxs.tools/`
- **Ruby**: `3.2.3` (typical: rbenv under the deploy user on the server)
- **Deploy**: set `NEXUS_DEPLOY_HOST` and optional variables (see `docs/COMMANDS.md`); do not commit hostnames or SSH identities into the repo. If an old server clone still uses another `origin` URL, update it to the repo above (see **Source repository** in `docs/COMMANDS.md`).

---

## 2. File Structure

```
Nexus_Dev/
├── app/
│   ├── assets/stylesheets/application.css   # All CSS (single file)
│   ├── controllers/
│   │   ├── application_controller.rb
│   │   ├── sessions_controller.rb
│   │   ├── documents_controller.rb
│   │   └── apps/
│   │       ├── base_controller.rb
│   │       ├── notes_controller.rb
│   │       ├── tasks_controller.rb
│   │       ├── finder_controller.rb
│   │       ├── time_card_controller.rb
│   │       ├── images_controller.rb
│   │       ├── audio_controller.rb
│   │       ├── wallpaper_iimage_controller.rb
│   │       └── user_controller.rb
│   ├── javascript/
│   │   ├── application.js
│   │   └── controllers/
│   │       ├── index.js
│   │       ├── organizer_controller.js       # Folder tree + item create/delete/rename
│   │       ├── finder_browser_controller.js  # Finder file list behavior + actions
│   │       ├── window_manager_controller.js  # Resize handles, seam drag, animations
│   │       ├── autosave_controller.js        # Live save, organizer label refresh
│   │       ├── title_editor_controller.js    # Click-to-edit title, save trigger
│   │       ├── task_list_editor_controller.js # Add/remove rows, subtasks, notes
│   │       ├── task_list_controller.js       # Singular task list interactions
│   │       ├── auth_menu_controller.js       # Auth dropdown
│   │       ├── note_editor_controller.js
│   │       ├── rename_controller.js
│   │       ├── folders_controller.js
│   │       ├── flash_controller.js
│   │       ├── clock_controller.js
│   │       ├── file_field_controller.js
│   │       ├── recent_docs_controller.js
│   │       ├── organizer_lock_controller.js
│   │       └── item_creator_controller.js
│   ├── models/
│   │   ├── user.rb
│   │   └── document.rb
│   ├── services/
│   │   ├── document_storage_sync_lite.rb
│   │   ├── document_disk_loader.rb
│   │   ├── embedded_draft_document.rb
│   │   ├── linked_app_save_to_document.rb
│   │   ├── note_rtf_converter.rb
│   │   └── time_card_document_codec.rb
│   └── views/
│       ├── layouts/application.html.erb
│       ├── shared/_desktop_side_panel.html.erb
│       ├── shared/_content_window_chrome.html.erb
│       ├── apps/
│       │   └── singular/task_list.html.erb
│       └── shared/_content_windows_boot.html.erb
├── config/
│   ├── routes.rb
│   ├── database.yml          # PostgreSQL config, env-driven
│   ├── puma.rb
│   └── credentials.yml.enc   # Encrypted with config/master.key
├── db/
│   ├── schema.rb
│   └── migrate/
├── storage/
│   └── workspace/            # Disk mirror of organizer state (Tasks.md, user folders)
└── docs/
    ├── UI_GUIDE.md           # This app's UI behavior reference
    └── DEV_GUIDE.md          # This file
```

---

## 3. Data Model

### User
- `email`, `password_digest` (bcrypt)
- Session-based auth via `sessions_controller.rb`

### Document
- `is_folder` + `parent_id` define the workspace tree.
- `content_type` is one of `note`, `task_list`, or `asset`.
- `content` stores note payload, `tasks` stores task-list payload.
- Disk sync is handled by `DocumentStorageSyncLite` + `DocumentDiskLoader`.

### Legacy Tables (Historical)
- Older migrations may reference `folders` / `items` through migration-local classes.
- Runtime app behavior is document-backed.

### Content format (Note)
```json
{ "body": "..." }
```

### Content format (Task List)
```json
{
  "tasks": [
    { "text": "...", "done": false, "note": "...", "subtasks": [
      { "text": "...", "done": false }
    ]}
  ]
}
```

---

## 4. Stimulus Controllers — Key Behaviors

### `organizer_controller.js`
- Manages app/window launch interactions from the side panel.
- Opens linked app drafts and new app instances from `+` actions.
- Resolves the top-most visible app window for focus/toggle behavior.

### `finder_browser_controller.js`
- Handles Finder file-list interactions and selection/open behavior.
- Owns Finder row actions (create, delete, rename) and refresh flows.

### `window_manager_controller.js`
- Manages resize handles on the main window and organizer seam.
- Seam drag moves the main window's left edge (organizer width stays fixed).
- Main window enforces a minimum content width (`--app-main-min-content-width: 432px`).
- Vertical resize available on organizer when main window is collapsed.
- Animation: main window slides in from seam on open; slides back on close.
- Switching items: content swaps without replaying open animation.

### `autosave_controller.js`
- Listens to `input`, `change`, `focusout` on form fields.
- Serializes requests (no overlapping saves).
- On save success: dispatches save-state events and syncs linked document payloads.
- Forced save via `autosave:trigger` custom event (dispatched by title_editor and task_list_editor).

### `title_editor_controller.js`
- Converts static title into a click-to-edit `<input>`.
- On blur or Enter: commits the edit, syncs hidden form field, dispatches `autosave:trigger`.

### `task_list_editor_controller.js`
- All task row manipulation: add/remove main rows and subtasks.
- Manages note toggle state (`has-saved-note` CSS class for persistence indicator).
- One-note-open-at-a-time: opening a note closes any other open note.
- Adding a new subtask force-closes any open note on the parent row first.
- Subtask add/remove and toggle all dispatch `autosave:trigger`.
- `#syncRowNoteButtonState(row)`: called on input/blur — keeps `has-saved-note` in sync.

---

## 5. CSS Architecture

Single file: `app/assets/stylesheets/application.css`

Key conventions:
- `.task-item-row .row-note-toggle { display: none; }` — hide note button by default.
- `.task-item-row .row-note-toggle.has-saved-note { display: inline-flex; }` — show if note has content (persistent).
- `.row-note-toggle:hover, .row-note-toggle:focus-visible { ... }` — button chrome only on direct hover.
- `--app-main-min-content-width: 432px` — shared minimum width CSS variable.
- Dark palette variables at `:root`.

### Scrollbar UX Standard (Do Not Regress)

Baseline expectation across Nexus scrollable regions:

- Thin scrollbar geometry.
- Theme-matched thumb contrast.
- Reveal on scroll activity, then fade out.

Primary implementation:

- CSS selector block in `app/assets/stylesheets/application.css` under comment:
  - `Subtle theme-matched scrollbars (Safari/Edge/Firefox)`
- Runtime state class toggling in `app/javascript/controllers/finder_browser_controller.js`:
  - `handleScrollActivity(event)`
  - applies/removes `.is-scrolling` with timeout (`scrollFadeDelayMs`)

When adding a new scrollable container:

1. Add the container selector to the scrollbar CSS lists (`scrollbar-width`, `::-webkit-scrollbar*`, and `.is-scrolling` variants).
2. Include the selector in `finder_browser_controller.js` `isTracked` matching logic if fade behavior is desired.
3. Verify on macOS + non-macOS browsers; keep native overlay behavior where it looks better and remains accessible.

---

## 6. Server-Rendered State

`app/views/apps/tasks/show.html.erb` renders `has-saved-note` and `has-note` classes
directly from stored note content at page load so the note indicator is correct on first render
(before any Stimulus runs).

Pattern:
```erb
<% note_button_classes = ["row-note-toggle"] %>
<% note_button_classes << "has-saved-note" if task["note"].to_s.rstrip.present? %>
```

---

## 7. Disk Mirror — `DocumentStorageSyncLite` + `DocumentDiskLoader`

- `DocumentStorageSyncLite` writes document and folder changes from DB to disk.
- `DocumentDiskLoader` ingests supported files/folders from disk into DB.
- Root defaults to `storage/workspace` (or `storage/workspace_test` in test env).
- Runtime sync avoids destructive purge during request-time reads (`purge_missing: false`).

---

## 8. Routes (Key)

```
GET  /                          → documents#index (organizer shell)
GET  /apps/tasks                → apps/tasks#show
POST /apps/tasks/save_file      → apps/tasks#save_file
GET  /apps/tasks/draft_file     → apps/tasks#draft_file
GET  /login                     → sessions#new
POST /login                     → sessions#create
DELETE /logout                  → sessions#destroy
```

---

## 9. Deployment Flow

### Local → GitHub → Server

**Step 1 — Push to GitHub:**
```bash
./deploy/deploy_github.sh
```
Stages all changes, prompts for commit message, pushes to `main`.

**Step 2 — Deploy to server:**
```bash
export NEXUS_DEPLOY_HOST=your.server.hostname.or.ip
./deploy/deploy_server.sh
```
Does:
1. SSH to `$NEXUS_DEPLOY_USER@$NEXUS_DEPLOY_HOST` (defaults in `deploy/deploy_server.sh`)
2. `git fetch && git reset --hard origin/main`
3. `bundle install` (production only)
4. `SECRET_KEY_BASE_DUMMY=1 RAILS_ENV=production rails assets:precompile`
5. Runs pending migrations if any
6. `sudo systemctl restart puma`
7. `sudo nginx -t && sudo systemctl reload nginx`
8. Prints commit, puma status, nginx status.

### Server State
- Ruby: typically rbenv under the deploy user (see `NEXUS_DEPLOY_RUBY`)
- App path: configurable via `NEXUS_DEPLOY_APP`
- Puma: systemd service `puma.service` with `RAILS_ENV=production`, `RAILS_MASTER_KEY`, `NEXUS_DATABASE_PASSWORD`
- DB: PostgreSQL, user `nexus`, database `nexus_production`
- Nginx (active app vhost): `/etc/nginx/sites-enabled/nxs.tools` → proxies to `127.0.0.1:3000`

### Production Realtime + Media Requirements
- Action Cable route must be mounted at `/cable` in Rails routes.
- Nginx must include a dedicated `/cable` location with websocket upgrade headers:
  - `proxy_http_version 1.1`
  - `proxy_set_header Upgrade $http_upgrade`
  - `proxy_set_header Connection "Upgrade"`
- Asset/image delivery should use nginx internal serving via `X-Accel-Redirect`:
  - Rails `DocumentsController#asset_file` validates auth and returns `X-Accel-Redirect` in production.
  - Nginx serves bytes from disk with an internal location `/assets-internal/` aliased to `/home/<user>/apps/nexus/storage/`.
  - This avoids Puma thread blocking for image streaming and significantly improves wallpapers/images responsiveness.
- If `/cable` appears down, confirm nginx and puma are both active and tail `journalctl -u puma` for `Successfully upgraded to WebSocket`.

### Credentials
- `config/credentials.yml.enc` encrypted with `config/master.key`
- `config/master.key` is gitignored — do not commit it
- The server's master key is set in `puma.service` as `RAILS_MASTER_KEY`
- `SECRET_KEY_BASE_DUMMY=1` must be set during `assets:precompile` on the server (skips credential loading)

---

## 10. Local Development

```bash
bin/rails server
```

(App available at `http://localhost:3000` — run from the repository root.)

---

## 11. Testing

```bash
bin/rails test
```

Tests live in `test/`. Integration tests cover document import flows.

---

## 12. Naming Conventions

- Rails: `snake_case` models/controllers/services, `PascalCase` class names.
- Stimulus: `kebab-case` controller file names → `PascalCase` class names.
- CSS classes: `kebab-case`, BEM-like for component scoping.
- Timestamps: UTC.
- Task-list payload: stored in `documents.tasks` as JSONB.

---

## 13. Behavioral Rules (Do Not Break)

1. Folder click does **not** open the main pane.
2. Item click opens; re-click closes.
3. Switching items swaps content without replaying open animation.
4. Delete item does **not** collapse folder.
5. Item list re-sorts alphabetically after create or rename.
6. Folder count updates immediately on item create/delete.
7. Only one inline task note open at a time.
8. `has-saved-note` renders server-side at page load so it survives refresh.
9. Use `NEXUS_DATABASE_PASSWORD` for database auth.

---

## 14. Known Technical Debt

- DB user and database names should be managed via `NEXUS_DB_USER` / `NEXUS_DB_NAME`.
- Nginx vhost duplication should be consolidated to remove repeated warning noise about conflicting server names.
- `test/integration/documents_import_test.rb` references old test patterns — review before expanding test suite.
