# Nexus Refactor Progress

Date: 2026-07-25

## Safe Refactor Mode Status

- External behavior preserved for all applied changes.
- No function signatures changed.
- Business logic was not altered; only structural/readability refactors were applied.

## What Was Analyzed

### Repo and baseline health
- Reviewed project structure and core docs (`README.md`, `docs/AI_HANDOFF.md`).
- Checked large/high-risk files to prioritize safe incremental cleanup.
- Ran baseline quality checks:
  - `bin/rubocop` ✅ (no offenses)
  - `bin/rails test` ❌ (1 pre-existing failure)

### Modules analyzed in this pass
1. `app/services/alchemy/upload_source_resolver.rb`
2. `app/services/alchemy/tag_xml.rb`
3. `app/services/documents/upload_files.rb`
4. Related tests:
   - `test/services/alchemy/upload_source_resolver_test.rb`
   - `test/services/documents/upload_files_test.rb`

## What Was Changed

### 1) `Alchemy::UploadSourceResolver`
- Extracted repeated data-type family literals into constants.
- Simplified extension dispatch in `call` with equivalent early returns.
- Centralized payload normalization (`normalize_payload_nodes`) used by multiple extraction methods.
- Centralized truthy checks (`truthy?`) used by scaling/byte-order helpers.
- Kept all existing fallback behavior and return payload shape unchanged.

### 2) `Alchemy::TagXml::Parser`
- Removed duplicated marker-extraction logic by introducing `extract_segment`.
- Removed repeated quote-stripping boilerplate by introducing `child_text`.
- Consolidated repeated source-format normalization via `normalized_source_format`.
- Kept output record schema and inferred field behavior unchanged.

### 3) `Documents::UploadFiles`
- Introduced constants for extension groups and file kind labels:
  - `TEXT_LIKE_EXTENSIONS`
  - `FILE_KIND_LABELS`
- Replaced repeated literal checks with constant lookups.
- Kept upload validation and response payload behavior unchanged.

### 4) `DocumentDiskLoader` unsupported XML ingestion fix
- Root cause: organizer sync indexed any `.xml` file as supported, and non-NEXUS XML then fell back to generic note parsing.
- Fix applied:
  - `.xml` files are now considered sync-supported **only** when they are unified NEXUS files with `kind: alchemy`.
  - Added `xml_file_supported_for_sync?` guard in `supported_file_extension?`.
- Result: plain XML files (e.g. `notes.xml`) are ignored by organizer sync, while app-authored Alchemy `.xml` files continue to sync.

### 5) Test coverage for XML sync policy
- Added service test:
  - `DocumentDiskLoaderTest#test_xml_files_are_indexed_only_for_unified_alchemy_format`
- Verifies:
  - raw XML is not indexed
  - unified Alchemy XML is indexed

### 6) `content_window_controller.js` modularization slice (safe extraction)
- Created `app/javascript/lib/content_window_shared.js`.
- Moved shared, non-behavioral helpers out of the large controller:
  - `readRegistry`
  - `writeRegistry`
  - `getTitleSnapGhostEl`
  - `hideTitleSnapGhostEl`
- Updated `content_window_controller.js` to import those helpers.
- No UX or event-flow behavior changes were introduced.

### 7) Storage/DB health diagnostics (read-only visibility)
- Added `StorageHealthReport` service (`app/services/storage_health_report.rb`) to compute:
  - DB file rows missing on disk
  - Disk files missing in DB
  - Duplicate DB `storage_path` rows
  - Usage by `content_type` (`db_rows`, `db_content_bytes`, `disk_bytes`, `missing_on_disk_count`)
  - Alchemy-specific totals
- Added new rake task:
  - `bin/rake nexus:storage_health`
  - Optional output override: `NEXUS_STORAGE_HEALTH_OUTPUT=...`
- Added test coverage:
  - `test/services/storage_health_report_test.rb`
- Updated operations docs:
  - `docs/COMMANDS.md`
  - `docs/DB_DIAGNOSTICS.md`

### 8) `DocumentDiskLoader` cleanup slice (structure only)
- Added internal constants/helper methods to reduce duplication:
  - `TEXT_FILE_EXTENSIONS`
  - `text_file_extension?`
  - `strip_supported_text_extension`
- Extracted non-RTF parsing dispatch into `parse_non_rtf_text_file`.
- Kept all file routing behavior unchanged.
- Added regression test coverage for `.nexus` and `.rtf` support/filename stripping.

### 9) `DocumentDiskLoader` cleanup slice (orchestration decomposition)
- Further decomposed sync orchestration internals without behavior changes:
  - Added `collect_disk_sync_inputs` to isolate disk scan + preload setup.
  - Added `assign_folder_attributes!` and `assign_file_attributes!` to centralize attribute assignment.
  - Added `parent_document_for_relative_path` to normalize parent lookup for folders/files.
- Simplified `sync_from_disk!`, `upsert_folders_from_disk!`, and `upsert_files_from_disk!` by delegating repeated logic to focused helpers.

### 10) `DocumentDiskLoader` cleanup slice (parser decomposition)
- Reduced parser duplication while preserving behavior:
  - Introduced `standard_document_attributes` for common attribute payloads.
  - Consolidated metadata/body extraction into `extract_metadata_and_body_from_lines`.
  - Introduced `parse_legacy_unified_kind_as_note` and `LEGACY_UNIFIED_NOTE_MESSAGES` to centralize retired-format handling.
- Kept legacy import compatibility behavior for retired unified kinds (`stickynotes`, `kanban`, `thought_wall`) unchanged.

### 11) `DocumentDiskLoader` cleanup slice (scanner + purge isolation)
- Isolated disk scanner flow by extracting `each_supported_visible_disk_file`.
- Isolated purge responsibilities:
  - `purge_missing_file_rows!`
  - `purge_missing_folder_rows!`
  - shared predicate `storage_path_missing_from_sync_and_disk?`
- Kept existing purge safety behavior intact:
  - embedded drafts are still protected from path-missing deletion
  - folders are only purged when empty and missing on disk

### 12) `UploadSourceResolver` cleanup slice (internal decomposition)
- Continued internal decomposition with behavior preserved:
  - Added `IGNITION_DTYPE_TO_MOXA_MAP` constant and reused it in `infer_data_type_from_reference`.
  - Added `normalized_data_type` helper to reduce repeated inline normalization.
  - Split template index loading internals into:
    - `template_candidate_paths`
    - `load_template_index_from_candidate`
- Kept file import behavior/output untouched (JSON/XML/tar/tgz handling unchanged).

### 13) `TagXml` cleanup slice (mapping/helper decomposition)
- Continued parser cleanup with no behavior drift:
  - Extracted `MOXA_SOURCE_FORMATS` constant for moxa-like source checks.
  - Extracted `RAW_MOXA_DATATYPE_MAP` constant for raw datatype inference mapping.
  - Added focused helpers:
    - `moxa_like_source_format?`
    - `register_kind_for_row_data_type`
    - `reset_address_flags!`
- Reduced duplication in duplicate-address annotation and legacy-format inference logic.

### 14) `UploadSourceResolver` cleanup slice (code-family extraction)
- Further reduced inference duplication by extracting shared code-family helpers:
  - `codes_for_int32_family`
  - `codes_for_float32_family`
- Reused these helpers for 32-bit and legacy-mapped 64-bit branches in `infer_codes`.
- Behavior remains unchanged (same output tuples for all existing branches).

### 15) `TagXml` cleanup slice (record builder + key helper extraction)
- Extracted `build_record_from_child` to isolate row-construction logic in `parse_records`.
- Added `register_key` helper and reused it for address-group key construction.
- Reduced parser method complexity while preserving row schema and inference behavior.

### 16) `TagXml` cleanup slice (source-format + pair helper extraction)
- Extracted repeated source-format fallback assignment into `apply_source_format_default!`.
- Extracted pair-detection loop into `paired_names_present?` for legacy-moxa signature inference.
- Preserved all inference behavior and output structure.

### 17) `content_window_controller` cleanup slice (storage helper extraction)
- Expanded `app/javascript/lib/content_window_shared.js` with shared storage helpers:
  - `readSessionThenLocalStorage`
  - `writeSessionAndLocalStorage`
  - `removeSessionAndLocalStorage`
- Replaced repeated linked-app title/document storage boilerplate in `content_window_controller.js` with shared helper calls.
- Kept existing fallback behavior (session first, then local) and non-blocking storage error handling.

### 18) `content_window_controller` cleanup slice (linked document storage call-site unification)
- Added controller-level linked-document storage helpers:
  - `linkedAppDocumentStorageKeyForFrame`
  - `persistLinkedAppDocumentForFrame`
  - `clearLinkedAppDocumentForFrame`
- Replaced repeated inline session/local linked-document write/remove blocks across:
  - open/embedded-open flows
  - spawned window creation/restore flows
  - task draft link repair and save-picker close flows
  - spawned window finalize close and reset-on-close flows
- Preserved session→local fallback semantics and storage-key format.

### 19) `content_window_controller` cleanup slice (linked context helper extraction)
- Added `persistLinkedDocumentContextForFrame(frameId, documentId, title)` to unify paired calls that persist:
  - linked document ID
  - linked open title
- Replaced repeated paired call sites in spawned-window and restore flows.
- No change to storage key format or fallback semantics.

### 20) `content_window_controller` cleanup slice (window-lookup helper extraction)
- Added shared lookup helper:
  - `findWindowByDocumentIdWithSelector(documentId, { selector, includeHidden })`
- Rewired duplicated finders to use the shared helper:
  - `findTaskWindowByDocumentId`
  - `findImageWindowByDocumentId`
  - `findQuartzWindowByDocumentId`
- Preserved selector scopes and includeHidden behavior.

### 21) `content_window_controller` cleanup slice (spawned clone bounds helper extraction)
- Added `applySpawnedCloneBounds(clone, offsetPx = 24)` to centralize repeated spawned-window geometry setup.
- Replaced duplicated clone bounds assignment in:
  - `spawnTaskWindow`
  - `spawnImageWindow`
  - `spawnQuartzWindow`
  - `spawnBlankTaskWindow`
- Preserved spawned offset and size behavior.

### 22) `content_window_controller` cleanup slice (spawned registry helper extraction)
- Added registry helpers to centralize spawned window document-map operations:
  - `spawnedWindowRegistryMapForAppKey`
  - `registerSpawnedWindowDocument`
  - `unregisterSpawnedWindowDocument`
- Replaced repeated direct map writes/deletes in spawn/restore/finalize-close paths.
- Preserved app-key prefixes and registry keying behavior.

### 23) `content_window_controller` cleanup slice (spawned clone identity helper extraction)
- Added `configureSpawnedCloneIdentity(clone, options)` to centralize spawned-window clone dataset/value setup.
- Replaced repeated clone identity setup in:
  - `spawnTaskWindow`
  - `spawnImageWindow`
  - `spawnQuartzWindow`
  - `restorePersistedSpawnedTaskWindows`
  - `spawnBlankTaskWindow`
- Preserved per-window app-key/frame-id/storage-key and spawn-flag behavior.

### 24) `content_window_controller` cleanup slice (linked document URL + open-state helper extraction)
- Added `buildLinkedDocumentUrl(documentId)` to centralize repeated linked document URL composition.
- Added `openOrBringToFrontCurrentWindow()` to centralize repeated "open if hidden, else bring to front" behavior.
- Replaced repeated call sites in embedded-open, open-request, and restore flows.
- Preserved existing URL/query semantics and window visibility behavior.

### 25) `content_window_controller` cleanup slice (spawned registration flow unification)
- Added `syncSpawnedDocumentRegistrationByPrefix(prefix, documentId)` to centralize shared spawned-doc registry map update behavior.
- Rewired:
  - `syncSpawnedTaskDocumentRegistration`
  - `syncSpawnedQuartzDocumentRegistration`
  to reuse the shared helper while preserving task-specific persisted-window updates.
- Preserved registry key behavior and spawned document dataset synchronization.

### 26) `content_window_controller` cleanup slice (linked title/badge sync helper extraction)
- Added `syncLinkedAppOpenTitleAndBadge(title)` to centralize repeated linked-document title normalization + persistence + badge sync flow.
- Replaced duplicated call sites in:
  - `handleEmbeddedLinkedAppOpen`
  - `handleOpenRequest` (document-open branch)
  - `onLinkedAppDocumentSaved`
  - `onFinderItemRenamed`
- Simplified `restoreLinkedAppUrlAndBadge` title application by reusing `syncOpenFileBadge(openTitle)`.
- Preserved empty-title handling semantics (badge clear + storage clear behavior remains at existing call sites).

### 27) `content_window_controller` cleanup slice (alchemy split layout helper extraction)
- Added `alchemySplitLayoutElements({ includeSplitter })` to centralize repeated Alchemy split-pane element lookup and readiness checks.
- Rewired duplicated lookup blocks in:
  - `startAlchemySplitResize`
  - `applyAlchemyRawView`
  - `applyAlchemySplitSize`
  - `syncAlchemySplitOnResize`
- Preserved existing split behavior, guards, and splitter requirements.

### 28) `content_window_controller` cleanup slice (alchemy source/rows helper extraction)
- Added `alchemySourceKind()` to centralize Alchemy source-kind DOM lookup.
- Added `alchemyTableRows()` to centralize Alchemy table-row collection.
- Replaced repeated source-kind and row-query call sites across Alchemy metadata, filtering, selection sync, highlight, and cursor-matching flows.
- Preserved existing guard behavior and row/source interpretation logic.

### 29) Workspace hard-cut migration (Finder-only root + no per-user workspace files)
- Migrated workspace model to a shared Finder root:
  - `FinderListedFolders.workspace_root_for` now resolves a shared Finder root (with legacy Admin promotion path).
  - `FinderWorkspaceInitializer` now provisions sections directly under Finder (no nested `Admin/Finder` expectation).
  - Finder section/root resolution now tolerates legacy numbered suffixes during transition.
- Removed user-coupled workspace folder lifecycle:
  - removed `User` callbacks that provision/rename per-user workspace roots.
  - simplified username updates to remove workspace folder rename coupling.
- Removed filesystem-backed per-user theme state writes:
  - `WorkspacePreferences::Manager` now persists workspace preference state in `UserAppState` (`workspace.preferences`) instead of `storage/workspace/*/Embedded/*.txt`.
- Updated workspace protection + section parsing to align with Finder-only topology:
  - `Document#user_workspace_root?` / `protected_workspace_structure?`
  - Finder storage-path origin parsing for both legacy and Finder-only prefixes.
- Hardened workspace bootstrap/search behavior:
  - fixed Finder section-root bootstrap when only favorites key exists.
  - panel search now falls back to workspace root subtree when section roots are temporarily absent.
- Updated workspace cleanup behavior:
  - `WorkspaceStorageCleanup` now removes legacy top-level `Admin`, `Embedded`, and duplicate `Finder *` roots/artifacts.

### 30) Runtime storage hard-cut execution (local workspace)
- Executed on-disk consolidation:
  - merged `storage/workspace/Admin/Finder` and duplicate `Finder *` content into `storage/workspace/Finder`
  - removed legacy top-level directories/artifacts
  - removed `storage/workspace_test` in local workspace
- Reconciled DB↔disk with `DocumentDiskLoader.sync!`.
- Verified final local storage layout:
  - `storage/workspace/Finder` is the only visible top-level workspace directory.

## Validation After Changes

- Focused checks:
  - `bin/rubocop app/services/alchemy/upload_source_resolver.rb app/services/alchemy/tag_xml.rb app/services/documents/upload_files.rb` ✅
  - `bin/rails test test/services/alchemy/upload_source_resolver_test.rb test/services/documents/upload_files_test.rb` ✅
  - `bin/rubocop app/services/document_disk_loader.rb test/services/document_disk_loader_test.rb` ✅
  - `bin/rails test test/integration/documents_sync_test.rb test/services/document_disk_loader_test.rb` ✅
  - `bin/rubocop app/services/storage_health_report.rb test/services/storage_health_report_test.rb lib/tasks/diagnostics.rake` ✅
  - `bin/rails test test/services/storage_health_report_test.rb test/services/document_disk_loader_test.rb` ✅
  - `bin/rubocop app/services/document_disk_loader.rb test/services/document_disk_loader_test.rb` ✅
  - `bin/rails test test/services/document_disk_loader_test.rb test/integration/documents_sync_test.rb` ✅
  - `bin/rubocop app/services/document_disk_loader.rb` ✅
  - `bin/rails test test/services/document_disk_loader_test.rb test/integration/documents_sync_test.rb` ✅
  - `bin/rubocop app/services/document_disk_loader.rb` ✅ (post-parser decomposition)
  - `bin/rails test test/services/document_disk_loader_test.rb test/integration/documents_sync_test.rb` ✅ (post-parser decomposition)
  - `bin/rubocop app/services/document_disk_loader.rb` ✅ (post-scanner/purge isolation)
  - `bin/rails test test/services/document_disk_loader_test.rb test/integration/documents_sync_test.rb` ✅ (post-scanner/purge isolation)
  - `bin/rubocop app/services/alchemy/upload_source_resolver.rb` ✅
  - `bin/rails test test/services/alchemy/upload_source_resolver_test.rb` ✅
  - `bin/rubocop app/services/alchemy/tag_xml.rb` ✅
  - `bin/rails test test/services/alchemy/upload_source_resolver_test.rb` ✅ (TagXml coverage path)
  - `bin/rubocop app/services/alchemy/upload_source_resolver.rb` ✅ (post code-family extraction)
  - `bin/rails test test/services/alchemy/upload_source_resolver_test.rb` ✅ (post code-family extraction)
  - `bin/rubocop app/services/alchemy/tag_xml.rb` ✅ (post record-builder extraction)
  - `bin/rails test test/services/alchemy/upload_source_resolver_test.rb` ✅ (post record-builder extraction)
  - `bin/rubocop app/services/alchemy/tag_xml.rb` ✅ (post source-format/pair helper extraction)
  - `bin/rails test test/services/alchemy/upload_source_resolver_test.rb` ✅ (post source-format/pair helper extraction)
  - `bin/rails test` ✅ (post frontend storage-helper extraction)
  - `bin/rails test` ✅ (post linked-document storage call-site unification)
  - `bin/rails test` ✅ (post linked-context helper extraction)
  - `bin/rails test` ✅ (post window-lookup helper extraction)
  - `bin/rails test` ✅ (post spawned clone bounds helper extraction)
  - `bin/rails test` ✅ (post spawned registry helper extraction)

- Full suite:
  - `bin/rails test` ✅
  - 110 runs, 443 assertions, 0 failures, 0 errors, 0 skips
  - Re-run after JS modularization slice: ✅ (110 runs, 443 assertions, 0 failures)
  - Re-run after storage health diagnostics: ✅ (111 runs, 460 assertions, 0 failures)
  - Re-run after DocumentDiskLoader cleanup slice: ✅ (112 runs, 464 assertions, 0 failures)
  - Re-run after DocumentDiskLoader orchestration decomposition: ✅ (112 runs, 464 assertions, 0 failures)
  - Re-run after DocumentDiskLoader parser decomposition: ✅ (112 runs, 464 assertions, 0 failures)
  - Re-run after DocumentDiskLoader scanner/purge isolation: ✅ (112 runs, 464 assertions, 0 failures)
  - Re-run after UploadSourceResolver decomposition: ✅ (112 runs, 464 assertions, 0 failures)
  - Re-run after TagXml cleanup slice: ✅ (112 runs, 464 assertions, 0 failures)
  - Re-run after UploadSourceResolver code-family extraction: ✅ (112 runs, 464 assertions, 0 failures)
  - Re-run after TagXml record-builder extraction: ✅ (112 runs, 464 assertions, 0 failures)
  - Re-run after TagXml source-format/pair helper extraction: ✅ (112 runs, 464 assertions, 0 failures)
  - Re-run after frontend storage-helper extraction: ✅ (112 runs, 464 assertions, 0 failures)
  - Re-run after linked-document storage call-site unification: ✅ (112 runs, 464 assertions, 0 failures)
  - Re-run after linked-context helper extraction: ✅ (112 runs, 464 assertions, 0 failures)
  - Re-run after window-lookup helper extraction: ✅ (112 runs, 464 assertions, 0 failures)
  - Re-run after spawned clone bounds helper extraction: ✅ (112 runs, 464 assertions, 0 failures)
  - Re-run after spawned registry helper extraction: ✅ (112 runs, 464 assertions, 0 failures)
  - Re-run after spawned clone identity helper extraction: ✅ (112 runs, 464 assertions, 0 failures)
  - Re-run after linked document URL/open-state helper extraction: ✅ (112 runs, 464 assertions, 0 failures)
  - Re-run after spawned registration flow unification: ✅ (112 runs, 464 assertions, 0 failures)
  - Re-run after linked title/badge sync helper extraction: ✅ (112 runs, 464 assertions, 0 failures)
  - Re-run after Alchemy split layout helper extraction: ✅ (112 runs, 464 assertions, 0 failures)
  - Re-run after Alchemy source/rows helper extraction: ✅ (112 runs, 464 assertions, 0 failures)
  - Re-run after workspace hard-cut migration + test updates: ✅ (112 runs, 464 assertions, 0 failures)

- Task verification:
  - `NEXUS_STORAGE_HEALTH_OUTPUT=tmp/storage_health_check.md bin/rake nexus:storage_health` ✅
  - Output file creation verified and temporary file removed.

## Problems Found

1. **Architecture-level complexity hotspots:**
   - Very large frontend controllers (e.g. `content_window_controller.js`) and large service classes remain and should be modularized incrementally.

## Problems Remaining

- Large-file decomposition and boundary cleanup (controller/service extraction) still pending.
- Extension handling policy is still distributed across multiple layers (upload, disk sync, specialized import).
- Multi-user workspace root model is still embedded in several areas; future single-directory migration needs an explicit compatibility plan.

## Architectural Notes / Warnings

- Continue refactors in small, verifiable slices with full test pass per slice.
- Keep `Alchemy` import pipeline behavior stable; it has non-trivial format inference and compatibility rules.
- Sync/import extension policy should continue moving toward one shared policy object to reduce drift risk.
- Product direction note from stakeholder: likely move toward a single shared main directory model (single active user for now), with auth focused on audit trails. This should guide future storage-path/user-scope refactors.
