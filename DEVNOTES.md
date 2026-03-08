Alchemy Ruby V1 - Developer Notes

Purpose
- This file is the central technical reference for future developers.
- It captures current behavior, architecture, feature rules, and code ownership areas.
- Scope is "as implemented" in the current V1 codebase.

Table of Contents
1. Product Summary
2. High-Level Architecture
3. Data Model and Persistence
4. Routes and Endpoints
5. Home + Organizer Experience
6. Workspace (Tag Table) Experience
7. Data Type System and Mapping
8. Save Pipeline and Delta Updates
9. Import Pipeline
10. Export Pipeline
11. Storage Synchronization
12. Naming and Collision Rules
13. Status/Validation/Highlight Rules
14. Deletion Behavior
15. Security and Request Conventions
16. Key Files by Responsibility
17. Developer Workflow and Safe Change Guidance
18. Known Constraints / Assumptions
19. Regression Checklist
20. LAST UPDATE

1) Product Summary
- Alchemy is a Rails app for Modbus/Uticor XML tag-list workflows.
- Primary flows:
  - Import XML tag lists.
  - Create new folders and new PLC tag-list files.
  - Organize files into folders.
  - Rename/delete folders and files from the organizer.
  - Open a file in workspace and edit a table of tag rows.
  - Save continuously (delta and full save paths).
  - Export XML with preloads rebuilt from current rows.

2) High-Level Architecture
- Backend: Ruby on Rails (controller-driven HTML + JSON responses).
- Frontend behavior: Stimulus controllers attached to server-rendered views.
- Data storage:
  - Primary state in Postgres `documents` table.
  - XML file mirror on disk under `storage/tag_lists`.
- Domain conversion logic:
  - `app/services/tag_xml.rb` for import/export mapping and preload calculation.
  - `app/services/document_storage_sync.rb` for disk synchronization and naming rules.

3) Data Model and Persistence
Main model: `Document` (`app/models/document.rb`)
- Supports both folder and file records using `is_folder` flag.
- Hierarchy:
  - `belongs_to :parent, class_name: "Document", optional: true`
  - `has_many :children, class_name: "Document", foreign_key: :parent_id`
- Scopes:
  - `folders` and `files`
- Important fields:
  - `records` (array of row hashes for file documents)
  - `metadata_filename`
  - `metadata_ip`
  - `metadata_protocol`
  - `storage_path` (relative path used for disk mirror)
  - `new_untitled_placeholder` (state flag for placeholder workflow)
- Validation and normalization:
  - `records` must be an array.
  - Folder parent must be blank.
  - Folder defaults normalize to no connection metadata and empty records.
  - File defaults normalize to `Untitled` plus default metadata.

Migration of note
- `db/migrate/20260307001000_add_folder_and_storage_path_to_documents.rb`
  - adds `is_folder:boolean` default false
  - adds `storage_path:string`
  - index on `is_folder`

4) Routes and Endpoints (`config/routes.rb`)
- `root "documents#index"`
- `POST /documents/create_root_folder` -> `documents#create_root_folder`
- `resources :documents` with custom actions:
  - collection:
    - `GET /documents/organizer_fragment` -> partial organizer refresh
  - member:
    - `POST /documents/:id/create_file` -> create file inside folder
    - `PATCH /documents/:id/rename` -> rename folder/file
    - `GET /documents/:id/export` -> download XML
    - `GET /documents/:id/file_list` -> partial file-list refresh for one folder

5) Home + Organizer Experience
View entrypoint
- `app/views/documents/index.html.erb`
- Stimulus on home:
  - `folders` controller handles async root-folder creation.
  - `recent-docs` controller handles organizer interactions and animations.

Organizer rendering
- Main organizer partial: `app/views/documents/_organizer.html.erb`
- Folder file-list partial: `app/views/documents/_folder_file_list.html.erb`

Organizer behavior
- Shows folders first, plus optional unfiled file section.
- Folder rows include count of tag lists.
- Folder rows can expand/collapse to show PLC tag lists.
- Header row inside each folder includes:
  - `Import` action (AJAX submit via `import-form` controller)
  - `New` action (create scaffold file)
- File rows include direct open link and always-visible `Rename` and `Delete` buttons.
- Empty folder row text: `No Tag Lists in this folder` with `14px` scale and vertical centering.
- Global empty organizer state displays a call-to-action message.

Organizer controllers
- `app/javascript/controllers/folders_controller.js`
  - creates root folder via AJAX and refreshes organizer fragment.
- `app/javascript/controllers/recent_docs_controller.js`
  - handles expand/collapse, keyboard delete, delete confirmations,
    organizer refresh, file-list refresh, empty-state transitions,
    folder open-state sync, and delete animations.
- `app/javascript/controllers/rename_controller.js`
  - inline rename with optimistic UI,
  - Enter/Tab commit, Escape cancel,
  - backend patch and partial refresh,
  - small FLIP-style motion for visual continuity.
- `app/javascript/controllers/import_form_controller.js`
  - triggers file picker and submits AJAX multipart form,
  - refreshes organizer and scrolls newly created file into view.

Important current rule
- Home organizer lock/unlock was removed.
- Rename/Delete visibility in organizer is no longer tied to any lock state.

6) Workspace (Tag Table) Experience
Workspace view
- `app/views/documents/edit.html.erb` (also used for `show`)
- Form controllers:
  - `workspace-lock`
  - `tag-table`
  - `data-type-picker`

Header area
- Editable metadata fields (when unlocked):
  - filename/title
  - protocol (TCP/RTU)
  - IP
- Toolbar actions:
  - add row
  - select mode toggle
  - workspace lock toggle
  - home button (guarded when needed)
  - export button (save + export flow)
- Status line:
  - status message text
  - tag count

Table area
- Columns:
  - Tag Group
  - Tag Name
  - Data Type
  - Address Start
  - Data Length
  - Scaling
  - Read/Write
- Row template exists hidden and is cloned for row creation.
- Data Type cell uses hidden inputs plus a trigger button that opens popup selector.
- Sorting links are in table header and participate in lock logic.

Workspace lock controller (`workspace_lock_controller.js`)
- Responsible for workspace editability, not organizer visibility.
- Locked state disables table/header edit controls.
- Select mode enables row selection and drives reorder behavior.
- Prevents sort navigation when locked.
- Uses sessionStorage keys to preserve unlock/sort navigation intent:
  - `alchemy_workspace_sort_nav`
  - `alchemy_workspace_unlocked`
  - `alchemy_workspace_path`

7) Data Type System and Mapping (`app/services/tag_xml.rb`)
DataTypeMapper
- Maps `(DATATYPE, ENCODE)` code pairs to UI labels.
- Supports known types (BOOL, INT, UINT, DINT variants, UDINT variants, REAL variants).
- Unknown code combinations map to `Unique`.
- Provides export code mapping from UI label back to code pair.
- Provides Uticor code labels and popup option lists.

Other mappers
- `ScalingMapper`:
  - UI scaling values map to XML EXPR inverse representation.
  - Handles default/fallback values.
- `ReadWriteMapper`:
  - Maps UI values to SUBSCRIBE on/off and back.

Preload calculator
- `PreloadCalculator.calculate_sections(records, func_code)`
- Clusters addresses by function code and computes chunk sections for preload blocks.

Parser
- Reads XML via REXML with normalization/fallback parsing steps.
- Skips `Preload_*` blocks.
- Builds record hashes with UI fields and preserves raw code fields:
  - `_raw_datatype`
  - `_raw_encode`
  - `_raw_verify`

Exporter
- Builds XML by string concatenation.
- Recreates `Preload_Words_*` and `Preload_Bits_*` blocks from current records.
- Emits endpoint tag blocks with derived fields and preload linkage.

8) Save Pipeline and Delta Updates
Controller: `DocumentsController#update`
- Two save paths:
  - Delta update (`handle_delta_update`) for single/targeted edits.
  - Full save for bulk operations / full form payload.
- `RECORD_KEYS` and `RAW_PRESERVE_KEYS` define allowed fields.
- Full save preserves raw fields where available.
- Empty table persists as empty `records` array.
- Metadata fields update when present.
- Marks placeholder status off once meaningful edits occur.
- On success:
  - syncs storage mirror
  - returns `204 No Content` for save path used by JS

Frontend save orchestration
- `tag_table_controller.js` dispatches save calls after relevant events and field changes.
- Integrates validation and status updates with save timing.

9) Import Pipeline
Entry: `DocumentsController#create`
- Accepts uploaded XML (or wrapped archive path resolution logic in controller).
- Parses records through `TagXml::Parser`.
- Extracts metadata from import source.
- Target folder:
  - explicit parent folder when `parent_id` provided
  - otherwise ensures/uses default imported folder
- Filename resolution uses `DocumentStorageSync.resolve_import_filename`.
- Creates `Document` file record and syncs XML to storage.
- Supports XHR and non-XHR response modes.

10) Export Pipeline
Entry: `DocumentsController#export`
- Uses `TagXml::Exporter.export_xml`.
- Returns downloaded XML with derived filename.
- Ensures `.xml` extension.
- Redirects with alert when no tags exist.

11) Storage Synchronization (`app/services/document_storage_sync.rb`)
Storage root
- `storage/tag_lists`

Core responsibilities
- `sync!(document)`:
  - folders: ensure folder directory exists
  - files with empty records: purge file from disk and clear `storage_path`
  - files with records: export XML and write to expected path
- `write_scaffold!(document)`:
  - creates valid empty XML scaffold for new files
- `purge!(document)`:
  - deletes file on disk for a file document
- `purge_folder!(folder)`:
  - removes entire folder tree from storage
- `rename_document!`:
  - delegates to folder/file rename logic with conflict checks

12) Naming and Collision Rules
Finder-style numeric suffix behavior
- Implemented by `next_available_filename`.
- Fills lowest missing suffix:
  - Example: `name.xml`, `name 2.xml`, `name 4.xml` -> next is `name 3.xml`.

Import naming
- `resolve_import_filename` normalizes base/ext and avoids collisions in target folder.

Untitled naming
- `next_untitled_filename` returns collision-free untitled filename in folder context.

Folder/file conflict behavior
- Rename/import/create raise/return conflict errors when target already exists.

13) Status/Validation/Highlight Rules
Primary owner: `tag_table_controller.js`

Validation
- Address Start: numeric only.
- Data Length: numeric only.
- Scaling: numeric/decimal validation.
- IP: IPv4 validation.
- Duplicate detection:
  - Address duplicates by register kind (coil for BOOL, holding otherwise).
  - Tag Name duplicates.

Status system
- Supports simple and detailed status variants.
- Clickable status message toggles detail mode.
- Status metadata drives style/tone and field/row flash targeting.

Highlight and flash behaviors
- Row-level and field-level flash classes for success/warning/error cases.
- Special handling for invalid entries, duplicate conflicts, and transition states.

14) Deletion Behavior
Home organizer deletion (`recent_docs_controller.js`)
- Supports keyboard delete/backspace on focused organizer rows.
- Uses confirmation prompts with different folder/file text.
- Sends DELETE request with CSRF and XHR headers.
- Plays collapse/poof animations, then removes row(s) from DOM.
- Recomputes empty states after removals.

Workspace deletion
- Row-level delete behaviors are handled in table controller logic and save pipeline.

Backend delete (`DocumentsController#destroy`)
- Folder delete:
  - purges child file storage
  - purges folder storage
- File delete:
  - purges file storage
- If all docs are removed, sequence reset logic is applied.

15) Security and Request Conventions
- CSRF token used in fetch calls for mutating actions.
- Server validates inputs and returns `422` for invalid states where appropriate.
- Renames and import errors return user-visible messages.
- Save/update only permits expected fields.

16) Key Files by Responsibility
Backend
- `app/controllers/documents_controller.rb`: primary workflow controller.
- `app/models/document.rb`: folder/file model with normalization rules.
- `app/services/tag_xml.rb`: parse/export and mapping domain logic.
- `app/services/document_storage_sync.rb`: disk sync and naming.
- `config/routes.rb`: endpoint map.

Frontend views
- `app/views/documents/index.html.erb`: home + organizer container.
- `app/views/documents/_organizer.html.erb`: folder + file organizer structure.
- `app/views/documents/_folder_file_list.html.erb`: per-folder file rows and empty state.
- `app/views/documents/edit.html.erb`: workspace editor.

Stimulus controllers
- `recent_docs_controller.js`: organizer interactions/animations.
- `folders_controller.js`: root-folder creation.
- `rename_controller.js`: inline rename and partial refresh.
- `import_form_controller.js`: async import submission.
- `tag_table_controller.js`: validation, status, table editing, save coordination.
- `data_type_picker_controller.js`: datatype popup interaction.
- `workspace_lock_controller.js`: workspace lock/select/sort-guard behavior.

Styling
- `app/assets/stylesheets/application.css`: global/home/organizer/workspace styles.

17) Developer Workflow and Safe Change Guidance
General
- Keep controller/view `data-*` bindings stable unless intentionally refactoring both ends.
- Prefer incremental changes and verify interactions after each small edit.

Organizer-safe change rules
- Preserve row structure and key class names consumed by `recent_docs_controller.js`.
- Preserve `data-recent-docs-target` and folder/file dataset attributes.
- Keep rename/delete button hooks intact unless replacing the controller behavior.

Workspace-safe change rules
- Preserve table input naming shape `records[index][Field Name]`.
- Preserve template row `__INDEX__` pattern behavior.
- Preserve delta payload format expected by `handle_delta_update`.

18) Known Constraints / Assumptions
- README is intentionally minimal; this file is currently the practical deep reference.
- App behavior relies on tight coupling between server-rendered HTML and Stimulus selectors.
- Some flows mix optimistic UI and server refresh partials; avoid changing only one side.
- Storage mirror assumes local filesystem availability under `storage/tag_lists`.

19) Regression Checklist
Home/Organizer
- Create root folder and verify appears immediately.
- Import into specific folder and verify row appears + can open.
- Create new file in folder and verify scaffold behavior.
- Rename folder and file; verify UI and persistence.
- Delete file and folder; verify animations + empty states.
- Confirm Rename/Delete are visible in organizer by default.

Workspace
- Unlock workspace and edit metadata fields.
- Add row, edit cells, validate status messages.
- Validate duplicate address and duplicate tag-name detection.
- Use data type popup and verify code/value updates.
- Sort columns (when unlocked) and verify expected order.
- Export XML and validate resulting content shape.

Persistence
- Reload app and verify edited records persist.
- Verify disk files update under `storage/tag_lists` as expected.
- Verify rename moves file/folder paths on disk without collisions.

20) LAST UPDATE
=====
LAST UPDATE
- 2026-03-08: Removed home organizer lock/unlock feature.
- Header lock toggle on `index` organizer removed.
- Deleted `app/javascript/controllers/organizer_lock_controller.js`.
- Removed lock-related organizer visibility CSS rules.
- Organizer Rename/Delete now always visible by default.
- Empty-folder typography update (`.no-tag-lists` at 14px) remains in place.

Insert future updates here.
=====
