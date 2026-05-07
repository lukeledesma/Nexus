# Nexus Master Blueprint

Version date: 2026-05-06
Purpose: single catch-up document for a memory-reset engineer to understand, operate, and rebuild Nexus end to end.
Canonical status: active reference alongside docs/NEXUS_FULL_REPO_AUDIT_2026-05-06.md.

## 1. Product Definition

Nexus is a Rails desktop-style workspace where one authenticated user operates app windows against a unified document tree.

Primary apps:
- Tasks
- Notes
- Time Card
- Images
- Audio
- Finder (file system browser and save/open host)
- User (security settings)

Core product promise:
- One workspace tree model (Document table)
- Multiple app windows operate on linked documents
- DB state mirrors to disk storage under storage/workspace
- Embedded draft files exist for app-first workflows

## 2. Runtime Stack

From Gemfile and configuration:
- Rails 8.1.x
- Ruby 3.2.3
- PostgreSQL
- Turbo + Stimulus + importmap
- Puma server
- Propshaft assets
- Solid Cache / Queue / Cable
- bcrypt authentication

Primary runtime files:
- config/application.rb
- config/routes.rb
- Gemfile
- db/schema.rb

## 3. Authentication And Session Model

Flow:
1. ApplicationController requires login for all requests by default.
2. SessionsController handles login form submit by email or username.
3. session[:user_id] stores authenticated user id.
4. current_user is memoized per request.

Files:
- app/controllers/application_controller.rb
- app/controllers/sessions_controller.rb
- app/models/user.rb

Important behavior:
- User.find_for_login supports email or username case-insensitive.
- User creation provisions workspace folders and seeds.
- Username changes trigger workspace folder rename synchronization.

## 4. Data Model Blueprint

### 4.1 User table
Fields in active schema:
- id
- email (unique, required)
- password_digest (required)
- username (optional, unique lowercased)
- created_at
- updated_at

Model behavior:
- has_secure_password
- validations for password and username format
- on create: workspace root and Embedded/Finder initialization
- on username change: folder rename sync via service

### 4.2 Document table
This is the center of the application.

Fields in active schema:
- id
- parent_id
- is_folder (boolean)
- title
- content_type (note, task_list, asset)
- content (text payload for notes/time-card note documents)
- tasks (jsonb for task list payload)
- storage_path (disk relative path)
- reset_mode
- reset_days
- last_reset_at
- is_favorited
- created_at
- updated_at

Tree model:
- Folder if is_folder true
- File if is_folder false
- parent_id links tree hierarchy

Important constraints in model:
- parent must reference folder
- title cannot start with period
- folders cannot keep content payload
- files must have valid content type

Disk sync hooks in model:
- after_create -> sync_create_to_disk
- after_update -> sync_update_to_disk
- after_destroy -> sync_destroy_on_disk

Files:
- app/models/document.rb
- db/schema.rb

## 5. Storage And Sync Contract

Nexus maintains dual persistence:
- relational state in PostgreSQL
- mirrored filesystem state in storage/workspace (or storage/workspace_test)

### 5.1 DB -> Disk
Service: DocumentStorageSyncLite

Responsibilities:
- create/move/rename folders and files on disk
- normalize unique names (Untitled, suffix increments)
- serialize notes as RTF
- serialize task lists in Nexus unified text format
- write asset bytes for content_type asset

### 5.2 Disk -> DB
Service: DocumentDiskLoader

Responsibilities:
- crawl storage root recursively
- upsert folders and files into Document rows
- parse supported text formats and task payloads
- ingest supported asset file extensions
- optional purge of missing files/folders

Safety rule currently used in request-time sync:
- purge_missing false to avoid accidental destructive deletes during transient gaps.

Critical draft protection:
- Embedded draft documents are protected from purge_missing deletions so draft ids remain stable.

Files:
- app/services/document_storage_sync_lite.rb
- app/services/document_disk_loader.rb
- app/services/document_persistence.rb

## 6. Workspace Topology

Workspace root identity:
- top-level folder title is username (fallback email)

Under root:
- Embedded
- Finder (container)

Under Finder, section roots are provisioned:
- Tasks (section key documents)
- Notes
- Time Card
- Images
- Audio
- Favorites is logical and represented by favorited files, not required as physical root

Initialization and migration logic:
- FinderWorkspaceInitializer ensures and migrates legacy structures
- legacy names include Documents and Finder behavior transitions

Files:
- app/services/finder_listed_folders.rb
- app/services/finder_workspace_initializer.rb

## 7. Embedded Draft Model

Service: EmbeddedDraftDocument

One canonical draft per app under Embedded folder:
- Task Draft (task_list)
- Note Draft (note)
- Time Card Draft (note)

Key operations:
- fetch_or_create
- clear_draft
- draft_document predicate

Why it exists:
- Opening an app from launcher can start in draft mode before choosing save location.
- Finder save flow persists draft to chosen Finder folder and can clear embedded draft state.

File:
- app/services/embedded_draft_document.rb

## 8. Routes And API Surface

Main route groups:
- Auth: /login /logout
- App windows: /apps/finder, /apps/tasks, /apps/notes, /apps/time_card, /apps/images, /apps/audio, /apps/user
- Draft and save bridge: /apps/tasks/draft_file and /apps/tasks/save_file
- Workspace preferences: /workspace_preferences GET/PATCH
- Document CRUD and file operations under /documents

Source:
- config/routes.rb

High value endpoints:
- GET / -> documents#index shell
- GET /documents/panel_search -> cross-section file search
- POST /documents/:id/upload_images
- GET /documents/:id/asset_file (streams bytes)
- POST /apps/tasks/save_file (linked app save flow)

## 9. Server Controller Behavior By Module

### 9.1 DocumentsController
Capabilities:
- shell load and organizer fragment rendering
- panel search across Finder sections
- create root folder
- create subfolder/create file
- move folder/move file
- rename and delete with policy checks
- favorite toggling
- asset streaming
- upload ingestion

Important patterns:
- request-time disk sync before major read endpoints
- persistence delegated to DocumentPersistence service
- explicit policy checks via DocumentPolicy

File:
- app/controllers/documents_controller.rb

### 9.2 Apps::FinderController
Capabilities:
- section browsing and folder tree payload generation
- favorites virtual view from is_favorited files
- linked file metadata for open-in-app actions
- read-only picker mode for save-as flows

Files:
- app/controllers/apps/finder_controller.rb

### 9.3 Apps::TasksController
Capabilities:
- open linked task document or draft fallback
- normalize tasks for rendering
- save_file endpoint bridge to LinkedAppSaveToDocument
- draft_file endpoint for launcher draft open

Files:
- app/controllers/apps/tasks_controller.rb
- app/services/tasks/save_file.rb

### 9.4 Apps::NotesController
Capabilities:
- open linked note document
- HTML note payload converted to plain text for textarea initialization

File:
- app/controllers/apps/notes_controller.rb

### 9.5 Apps::TimeCardController
Capabilities:
- open linked time-card document
- decode/encode serialized state with TimeCardDocumentCodec

Files:
- app/controllers/apps/time_card_controller.rb
- app/services/time_card_document_codec.rb

### 9.6 Apps::ImagesController and Apps::AudioController
Capabilities:
- open linked asset documents when extension matches allowed kind
- provide linked document labels for window chrome

Files:
- app/controllers/apps/images_controller.rb
- app/controllers/apps/audio_controller.rb

### 9.7 Apps::UserController
Capabilities:
- render user settings app
- update username with password verification
- update password and re-seed session

File:
- app/controllers/apps/user_controller.rb

### 9.8 WorkspacePreferencesController
Capabilities:
- read and update shell/theme/wallpaper state
- currently only Modern shell is active path
- gradient/custom shell editing intentionally removed

Files:
- app/controllers/workspace_preferences_controller.rb
- app/services/workspace_preferences/manager.rb

## 10. Authorization Model

Policy class:
- DocumentPolicy

Key decisions:
- can view/open only inside Finder sections or Embedded subtree
- protected workspace folders are blocked from rename/delete/move
- user workspace root is protected
- file-only favorites
- upload allowed to Finder sections and embedded wallpaper folder rule

File:
- app/policies/document_policy.rb

## 11. Frontend Architecture

Turbo + Stimulus app with eager controller loading.

Boot files:
- app/javascript/application.js
- app/javascript/controllers/index.js

Key controllers:
- organizer_controller.js
  - app launcher behavior
  - open draft on first launch for tasks/notes/time-card
- finder_browser_controller.js
  - tree interactions, create/rename/delete, save-as picker, open-in-app dispatch
- autosave_controller.js
  - serial autosave pipeline and linked document sync
- task_list_editor_controller.js
  - row editing, subtasks, note toggles, drag/drop reorder, payload sync
- window_manager_controller.js
  - workspace theme and wallpaper sync bootstrap

Important event contracts:
- app-window:open
- app-window:toggle
- app-window:close
- app-window:state
- nexus:linked-app-document-saved
- nexus:item-dirty
- nexus:item-saving
- nexus:item-saved

## 12. UI Shell Composition

Layout file contains all desktop windows and turbo frames.

Window frames include:
- finder-pane
- tasks-pane
- notes-pane
- time-card-pane
- images-pane
- audio-pane
- user-pane

Early restore script:
- restores localStorage window bounds, z-index, open state, and frame src
- binds linked document id restoration for certain panes

Files:
- app/views/layouts/application.html.erb
- app/views/shared/_content_windows_boot.html.erb
- app/views/documents/index.html.erb

## 13. App Functionality Matrix

### Tasks
User actions:
- add/remove task
- add/remove subtask
- toggle completion
- inline note per row
- drag reorder
- autosave and save-as into Finder

Persistence:
- documents.content_type task_list
- documents.tasks JSON payload

### Notes
User actions:
- edit note body
- autosave
- save-as into Finder via linked picker

Persistence:
- documents.content_type note
- documents.content text payload (stored and mirrored as RTF on disk)

### Time Card
User actions:
- clock state tracking and notes
- open linked file in Time Card app
- save-through linked flow

Persistence:
- documents.content_type note in Time Card section
- content serialized by TimeCardDocumentCodec

### Images
User actions:
- open image assets
- upload files
- set wallpaper where eligible

Persistence:
- documents.content_type asset
- bytes on disk referenced by storage_path

### Audio
User actions:
- open audio assets
- inline/linked app open flow from Finder

Persistence:
- documents.content_type asset
- bytes streamed via documents#asset_file

## 14. File Formats And Content Contracts

Supported disk file imports:
- .nexus
- .txt
- .md
- .rtf
- asset extensions (.wav .aif .aiff .mp3 .m4a .flac .ogg .jpg .jpeg .png)

Task list serialization:
- checklist lines with optional subtask lines

Note serialization:
- RTF conversion via NoteRtfConverter for disk writes

Time card serialization:
- unified header + body text via TimeCardDocumentCodec

## 15. Diagnostics And Operations

Diagnostics command:
- bin/rake nexus:diagnostics

Diagnostics output:
- docs/audit/diagnostics_YYYYMMDD_HHMMSS.md
- tables, row counts, column lists, max updated_at

Guides:
- docs/COMMANDS.md
- docs/DB_DIAGNOSTICS.md
- docs/NEXUS_FULL_REPO_AUDIT_2026-05-06.md

## 16. Deployment Blueprint

Expected flow:
1. push to GitHub via deploy script
2. deploy to server via deploy script
3. server fetch/reset, install gems, precompile assets, migrate, restart puma, reload nginx

Critical env vars:
- RAILS_MASTER_KEY
- NEXUS_DATABASE_PASSWORD
- NEXUS_DEPLOY_HOST and related deploy vars

References:
- deploy/deploy_github.sh
- deploy/deploy_server.sh
- docs/COMMANDS.md

## 17. Rebuild From Zero Plan

### Phase 1: Platform boot
1. Create Rails app with postgres, turbo, stimulus, importmap.
2. Add User and Document schema exactly.
3. Add auth with sessions and has_secure_password.

### Phase 2: Core document tree
1. Implement Document model with folder/file logic and callbacks.
2. Implement DocumentPersistence service.
3. Implement DocumentStorageSyncLite and DocumentDiskLoader.
4. Validate DB and disk stay in sync.

### Phase 3: Workspace provisioning
1. Implement FinderListedFolders and FinderWorkspaceInitializer.
2. Add Embedded folder support and EmbeddedDraftDocument.
3. Seed default roots and section folders on user create.

### Phase 4: App controllers and routes
1. Implement apps namespace controllers.
2. Implement DocumentsController operations and policy checks.
3. Add linked save flow endpoints and service objects.

### Phase 5: Frontend shell
1. Build desktop layout with content windows and turbo frames.
2. Add Stimulus controllers for organizer, finder browser, autosave, task list editor.
3. Add window restore script and linked-doc persistence.

### Phase 6: Preferences and wallpaper
1. Implement WorkspacePreferences manager and controller.
2. Integrate workspace theme boot payload and wallpaper sync.

### Phase 7: Validation
1. Run full test suite.
2. Run diagnostics snapshot.
3. Smoke test each app and cross-app save/open flow.

## 18. Verification Checklist For Any Change

1. Login and open desktop shell.
2. Open Tasks, Notes, Time Card from launcher (draft path).
3. Save each into Finder folder from picker.
4. Reopen saved documents from Finder open-in-app.
5. Upload image and audio assets and open them.
6. Toggle favorites and verify favorites section.
7. Rename/move/delete allowed docs and confirm protected folders block edits.
8. Refresh page and verify windows restore.
9. Run bin/rake nexus:diagnostics and compare snapshot.

## 19. Known Constraints And Intentional Limitations

- Custom shell editing is disabled.
- Gradient wallpaper apply is disabled.
- Framework-managed routes (ActiveStorage, ActionMailbox, Turbo conductor) are present but not app-owned business logic.
- Legacy migration logic remains in FinderWorkspaceInitializer for compatibility and can be phased down based on owner direction.

## 20. Canonical Source Map

Primary code truth:
- app/models/document.rb
- app/models/user.rb
- app/controllers/documents_controller.rb
- app/controllers/apps/finder_controller.rb
- app/controllers/apps/tasks_controller.rb
- app/services/document_storage_sync_lite.rb
- app/services/document_disk_loader.rb
- app/services/document_persistence.rb
- app/services/embedded_draft_document.rb
- app/services/finder_workspace_initializer.rb
- app/javascript/controllers/organizer_controller.js
- app/javascript/controllers/finder_browser_controller.js
- app/javascript/controllers/autosave_controller.js
- app/javascript/controllers/task_list_editor_controller.js

Primary documentation truth:
- docs/NEXUS_FULL_REPO_AUDIT_2026-05-06.md
- docs/DEV_GUIDE.md
- docs/UI_GUIDE.md
- docs/COMMANDS.md
- docs/DB_DIAGNOSTICS.md

## 21. Maintenance Rule

Whenever product behavior, schema, routes, service contracts, or deployment flow changes:
1. Update this file.
2. Update docs/NEXUS_FULL_REPO_AUDIT_2026-05-06.md latest update log.
3. Run diagnostics snapshot and store output in docs/audit.
