# Nexus — Developer Guide

Technical reference for the Nexus Rails application. Covers file structure, architecture,
frontend controllers, data flow, and deployment.

This is the primary AI context document for future development sessions.

---

## 1. Project Identity

- **App name**: Nexus
- **Stack**: Rails 8.1, PostgreSQL, Puma, Nginx, Stimulus JS
- **Local repo**: `/Users/luke/Projects/WEBSITE/Nexus_Dev`
- **GitHub**: `https://github.com/lukeledesma/Nexus` (branch: `main`)
- **Production server**: `luke@172.232.163.176`, app at `/home/luke/apps/nexus`
- **Ruby**: `3.2.3` (rbenv), path: `/home/luke/.rbenv/versions/3.2.3/bin`

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
│   │       ├── folders_controller.rb
│   │       ├── notes_controller.rb
│   │       ├── task_lists_controller.rb
│   │       ├── tasks_controller.rb
│   │       ├── calculator_controller.rb
│   │       └── settings_controller.rb
│   ├── javascript/
│   │   ├── application.js
│   │   └── controllers/
│   │       ├── index.js
│   │       ├── organizer_controller.js       # Folder tree + item create/delete/rename
│   │       ├── finder_controller.js          # Item selection, main pane open/close
│   │       ├── window_manager_controller.js  # Resize handles, seam drag, animations
│   │       ├── autosave_controller.js        # Live save, organizer label refresh
│   │       ├── title_editor_controller.js    # Click-to-edit title, save trigger
│   │       ├── task_list_editor_controller.js # Add/remove rows, subtasks, notes
│   │       ├── task_list_controller.js       # Legacy task list (older view)
│   │       ├── modal_controller.js           # In-app creation modals
│   │       ├── auth_menu_controller.js       # Auth dropdown
│   │       ├── note_editor_controller.js
│   │       ├── rename_controller.js
│   │       ├── folders_controller.js
│   │       ├── flash_controller.js
│   │       ├── clock_controller.js
│   │       ├── calculator_lite_controller.js
│   │       ├── file_field_controller.js
│   │       ├── recent_docs_controller.js
│   │       ├── organizer_lock_controller.js
│   │       └── item_creator_controller.js
│   ├── models/
│   │   ├── user.rb
│   │   ├── folder.rb     # after_commit disk sync hooks
│   │   └── item.rb       # after_commit disk sync hooks
│   ├── services/
│   │   └── item_storage_sync_lite.rb  # Rebuilds storage/workspace from DB
│   └── views/
│       ├── layouts/application.html.erb
│       ├── organizer/_sidebar.html.erb
│       ├── apps/
│       │   ├── notes/show.html.erb
│       │   └── task_lists/show.html.erb
│       └── items/
│           ├── _new_folder_modal.html.erb
│           ├── _new_note_modal.html.erb
│           └── _new_task_list_modal.html.erb
├── config/
│   ├── routes.rb
│   ├── database.yml          # PostgreSQL config, env-driven
│   ├── puma.rb
│   └── credentials.yml.enc   # Encrypted with config/master.key
├── db/
│   ├── schema.rb
│   └── migrate/
├── storage/
│   └── workspace/            # Disk mirror of organizer state (Notes.nexus, Tasks.nexus, user folders)
└── docs/
    ├── UI_GUIDE.md           # This app's UI behavior reference
    └── DEV_GUIDE.md          # This file
```

---

## 3. Data Model

### User
- `email`, `password_digest` (bcrypt)
- Session-based auth via `sessions_controller.rb`

### Folder
- `name` (string)
- `belongs_to :user`
- `has_many :items`
- `after_commit` → `ItemStorageSyncLite.sync`

### Item
- `name` (string)
- `item_type` (string: `"note"` or `"task_list"`)
- `content` (text, JSON payload)
- `belongs_to :folder`
- `after_commit` → `ItemStorageSyncLite.sync`

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
- Manages the folder tree: expand/collapse, live item count, in-place item delete/insert.
- Handles creation modal submission → inserts new item row inline under its folder.
- Sort: item rows are alphabetically re-sorted after create and rename.
- Delete: removes item row in place, decrements count, keeps folder open.
- Folder collapse: closes selected item in main pane if it belongs to the collapsing folder.

### `finder_controller.js`
- Controls which item is "selected" (open in main pane).
- Item click → open or close main pane.
- Re-clicking same item → close.
- Folder click does NOT trigger finder — folder click is organizer-only.
- Listens for `finder:close-request` events (used by organizer on folder collapse).

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
- On save success: updates matching organizer item labels by data attribute.
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
- Runtime state class toggling in `app/javascript/controllers/finder_controller.js`:
  - `handleScrollActivity(event)`
  - applies/removes `.is-scrolling` with timeout (`scrollFadeDelayMs`)

When adding a new scrollable container:

1. Add the container selector to the scrollbar CSS lists (`scrollbar-width`, `::-webkit-scrollbar*`, and `.is-scrolling` variants).
2. Include the selector in `finder_controller.js` `isTracked` matching logic if fade behavior is desired.
3. Verify on macOS + non-macOS browsers; keep native overlay behavior where it looks better and remains accessible.

---

## 6. Server-Rendered State

`app/views/apps/task_lists/show.html.erb` renders `has-saved-note` and `has-note` classes
directly from stored note content at page load so the note indicator is correct on first render
(before any Stimulus runs).

Pattern:
```erb
<% note_button_classes = ["row-note-toggle"] %>
<% note_button_classes << "has-saved-note" if task["note"].to_s.rstrip.present? %>
```

---

## 7. Disk Mirror — `ItemStorageSyncLite`

- Location: `app/services/item_storage_sync_lite.rb`
- Root: `storage/workspace/`
  - `Notes.nexus`: Singular note document (always present)
  - `Tasks.nexus`: Singular task list document (always present)
  - User folders as subdirectories (no items inside)
- Triggered: `after_commit` on `Folder` and `Item` models.
- Behavior: rebuilds folder directories and `.nexus` files from current DB state.
- File names sanitized, duplicates suffixed with numbers.
- Writes note content and task list content with metadata headers.

This is **app → disk** (one-directional). Disk does not write back to DB automatically.

---

## 8. Routes (Key)

```
GET  /                          → documents#index (organizer shell)
GET  /apps/notes/:id            → apps/notes#show
GET  /apps/task_lists/:id       → apps/task_lists#show
PATCH /apps/notes/:id           → apps/notes#update
PATCH /apps/task_lists/:id      → apps/task_lists#update
DELETE /apps/notes/:id          → apps/notes#destroy
DELETE /apps/task_lists/:id     → apps/task_lists#destroy
GET  /apps/folders/:id          → apps/folders#show
POST /items                     → items#create
PATCH /items/:id                → items#update
DELETE /items/:id               → items#destroy
GET  /login                     → sessions#new
POST /login                     → sessions#create
DELETE /logout                  → sessions#destroy
```

---

## 9. Deployment Flow

### Local → GitHub → Server

**Step 1 — Push to GitHub:**
```bash
/Users/luke/Projects/WEBSITE/deploy/deploy_github.sh
```
Stages all changes, prompts for commit message, pushes to `main`.

**Step 2 — Deploy to server:**
```bash
/Users/luke/Projects/WEBSITE/deploy/deploy_server.sh
```
Does:
1. SSH to `luke@172.232.163.176`
2. `git fetch && git reset --hard origin/main`
3. `bundle install` (production only)
4. `SECRET_KEY_BASE_DUMMY=1 RAILS_ENV=production rails assets:precompile`
5. Runs pending migrations if any
6. `sudo systemctl restart puma`
7. `sudo nginx -t && sudo systemctl reload nginx`
8. Prints commit, puma status, nginx status.

### Server State
- Ruby: rbenv at `/home/luke/.rbenv/versions/3.2.3/bin`
- App: `/home/luke/apps/nexus`
- Puma: systemd service `puma.service` with `RAILS_ENV=production`, `RAILS_MASTER_KEY`, `NEXUS_DATABASE_PASSWORD`
- DB: PostgreSQL, user `alchemy`, database `alchemy_production` (legacy names, still in use)
- Nginx: `/etc/nginx/sites-enabled/alchemy` → proxies to `127.0.0.1:3000`

### Credentials
- `config/credentials.yml.enc` encrypted with `config/master.key`
- `config/master.key` is gitignored — do not commit it
- The server's master key is set in `puma.service` as `RAILS_MASTER_KEY`
- `SECRET_KEY_BASE_DUMMY=1` must be set during `assets:precompile` on the server (skips credential loading)

---

## 10. Local Development

```bash
cd /Users/luke/Projects/WEBSITE/Nexus_Dev
bin/rails server
```

App available at `http://localhost:3000`.

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
- Item content: stored as JSON string in `items.content` column.

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
9. `ALCHEMY_DATABASE_PASSWORD` fallback removed — use `NEXUS_DATABASE_PASSWORD` exclusively.

---

## 14. Known Technical Debt

- DB user and database names are still `alchemy` / `alchemy_production` on the production server (PostgreSQL). Renaming these requires a migration on the live server — deferred.
- Nginx site config still named `alchemy` — functional but can be renamed to `nexus` when convenient.
- `test/integration/documents_import_test.rb` references old test patterns — review before expanding test suite.
