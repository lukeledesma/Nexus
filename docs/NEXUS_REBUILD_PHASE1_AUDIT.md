# Nexus Rebuild Phase 1 Audit

Date: 2026-04-25
Scope: Understand-before-touch audit for a disciplined rebuild. No production code changes in this phase.

## 1) Public Feature Map (Contract to Preserve)

### Authentication and session lifecycle
- GET /login: renders sign-in UI.
- POST /login: accepts identifier (email or username) + password; authenticates and sets session user id; failure rerenders with validation message.
- DELETE /logout: resets session and redirects to login.

### Root and organizer surface
- GET /: renders organizer and content windows shell; attempts request-time disk->DB sync before showing organizer.
- GET /documents/organizer_fragment: returns organizer partial for async refresh.
- POST /documents/create_root_folder: creates top-level untitled folder and returns updated organizer partial.

### Document CRUD and structure operations
- GET /documents/:id and /documents/:id/edit: opens editor view for file documents; folder edit redirects.
- PATCH /documents/:id: updates title and body/tasks depending on content_type.
- DELETE /documents/:id: deletes document (and descendants for folders) unless protected workspace roots.
- POST /documents/:id/create_subfolder: creates named subfolder under folder.
- POST /documents/:id/create_file: creates note/task file in folder with generated title.
- POST /documents/:id/move_folder: reparents folder within Finder subtree with cycle prevention.
- POST /documents/:id/move_file: reparents file within Finder subtree.
- PATCH /documents/:id/rename: renames file/folder with validations.
- PATCH /documents/:id/toggle_favorite: toggles is_favorited for files.
- GET /documents/:id/file_list: partial listing of files under folder.
- GET /documents/:id/asset_file: streams asset bytes from disk path.
- POST /documents/:id/upload_images: ingests uploaded files into allowed folders (Finder sections or Embedded wallpaper folder), supports asset and text-like imports.

### Finder app (workspace tree and picker)
- GET /apps/finder: shows sectioned file tree and picker modes.
- Sections are materialized under a Finder container: Tasks (key documents), Notes, Time Card, Images, Audio, and virtual Favorites.
- Read-only picker mode constrains selectable/openable content by frame id.
- Favorites section is virtual, derived from is_favorited files.

### Linked editors and embedded drafts
- GET /apps/tasks: opens linked task document or embedded task draft fallback.
- POST /apps/tasks/save_file: saves to selected folder; can create new from embedded draft; can clear draft after save.
- GET /apps/tasks/draft_file: fetches or creates embedded persistent draft for tasks/notes/time-card.
- GET /apps/notes: opens linked note document if openable from allowed workspace subtree.
- GET /apps/time_card: opens note-backed time card document with codec handling.

### Media picker apps
- GET /apps/images: image-asset browser view.
- GET /apps/audio: audio-asset browser view.
- GET /apps/wallpaper_iimage/files: JSON list of eligible wallpaper image assets.

### User account app
- GET /apps/user: account UI.
- PATCH /apps/user/username: validates current password, updates username, and triggers workspace folder rename flow.
- PATCH /apps/user/password: validates current password and updates password.

### Workspace preferences
- GET /workspace_preferences: returns theme/wallpaper payload (backed by per-user files under storage/workspace/<username>/Embedded).
- PATCH /workspace_preferences: applies allowed theme and wallpaper image selection with eligibility checks.

## 2) Side-Effect Inventory

### Database writes
- Document lifecycle writes across CRUD, reparenting, favorite toggles, folder creation, upload import.
- User creation/update writes plus provisioning callbacks.
- Finder migration behavior can move/reparent/destroy folders during requests.

### Filesystem writes and reads
- Bidirectional DB<->disk sync for documents.
- Upload byte reads and persisted asset file writes.
- Organizer and finder behavior depend on on-disk structure and parsing.
- Workspace preferences read/write JSON files in user Embedded folder.
- Username changes can move workspace directory tree on disk.

### Background jobs, mailers, external APIs
- No active jobs beyond base skeleton.
- No active mailers beyond base skeleton.
- No outbound HTTP integration found in current server-side Ruby paths.

## 3) Patch Catalogue and Structural Debt

### High-risk reliability debt
- Broad rescue blocks that return nil/false or only log in critical flows (sync, draft retrieval, workspace setup), creating silent failure modes.
- File I/O is coupled to Document model callbacks (after_create/update/destroy), making cross-system consistency fragile.
- Request-time sync and migration logic occurs inside controller paths, increasing latency and race risk.

### Architectural concentration debt
- DocumentsController and FinderController are large orchestration + business logic hybrids (querying, migration, validation, policy-like checks, response shaping).
- Shared domain rules are repeated across controllers/services (finder subtree checks, protected folder checks, content-type routing).
- Runtime section migration logic in Finder mixes one-time data migrations into normal request handling.

### Data/query debt
- Raw SQL recursive CTE usage in Finder tree/favorites paths is hand-assembled and hard to evolve.
- Runtime feature-detection checks (for example favorites column availability) suggest schema/version drift handling in request paths.
- Name generation logic is not transaction-safe under concurrency.

### Security and authorization debt
- Authorization is implicit and distributed; many paths rely on subtree checks instead of centralized policy objects.
- Strong params are not consistently used across all document update operations.
- Direct id lookups are common before user-scope checks.

### Performance debt
- Sync and heavy tree construction are in request cycle.
- Recursive traversal and per-request migration checks can amplify latency under larger document trees.
- No pagination strategy on list endpoints; tree loading is eager.

## 4) Test Coverage and Risk Register

### Existing coverage (what is actually tested)
- Integration tests for select document import/rename/sync behavior.
- Service tests for disk loader parsing/purge behavior.
- Service tests for note RTF converter.
- Service tests for time card codec serialization.
- System smoke tests for editors and selected UI interactions.

### Major untested behavior (explicit risk)
- Authentication/session edge cases and security regressions.
- Most controller actions in DocumentsController, FinderController, TasksController, UserController, WorkspacePreferencesController.
- Authorization boundaries across workspace sections and embedded subtree.
- Callback-driven file sync failure paths and partial-failure consistency.
- Finder runtime migration idempotency and concurrent access behavior.
- Draft lifecycle stability under sync/purge pressure.
- Workspace folder rename rollback and data integrity.

Risk severity summary:
- Critical: silent failure paths, callback-coupled file sync consistency, broad controller behavior mostly untested.
- High: authorization distribution, finder runtime migrations, draft stability.
- Medium: performance under scale, preferences file corruption/recovery behavior.

## 5) Constraints and Non-Regression Contract

The following external contracts must remain stable unless intentionally upgraded with compatibility:
- Route URLs and HTTP verbs in current routes.
- JSON response shapes used by linked app save/draft and favorites toggles.
- Finder section semantics (including virtual favorites behavior).
- Embedded draft UX semantics (fetch/create/clear lifecycle) unless upgraded additively.
- Disk-backed document storage semantics and supported file extensions.

## 6) Rebuild Entry Plan (post-Phase 1)

Execution order (small safe slices):
1. Error taxonomy and operation result objects (typed failures instead of rescue-and-ignore).
2. Extract explicit document persistence orchestration (DB + disk) and remove callback coupling.
3. Extract Finder section initialization/migration into idempotent service with one-time execution marker.
4. Centralize authorization in policy/service layer and enforce in all controllers.
5. Stabilize embedded draft identity and purge protections.
6. Expand test harness around refactored services and controller integration paths.

## 7) Source Files Inspected for This Audit

Primary routing and controllers:
- config/routes.rb
- app/controllers/application_controller.rb
- app/controllers/sessions_controller.rb
- app/controllers/documents_controller.rb
- app/controllers/workspace_preferences_controller.rb
- app/controllers/apps/finder_controller.rb
- app/controllers/apps/tasks_controller.rb
- app/controllers/apps/user_controller.rb

Primary models/services:
- app/models/document.rb
- app/models/user.rb
- app/services/document_disk_loader.rb
- app/services/document_storage_sync_lite.rb
- app/services/embedded_draft_document.rb
- app/services/linked_app_save_to_document.rb
- app/services/workspace_document_access.rb

Representative tests:
- test/integration/documents_sync_test.rb
- test/integration/documents_import_test.rb
- test/integration/documents_rename_test.rb
- test/services/document_disk_loader_test.rb
- test/services/note_rtf_converter_test.rb
- test/services/time_card_document_codec_test.rb
- test/system/*.rb

---
Phase 1 complete when this audit is accepted as the non-regression contract for the rebuild.
