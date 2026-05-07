# Nexus Full Repository Audit (Top-to-Bottom)

Date: 2026-05-06
Scope requested: entire Nexus_Dev folder contents

## Latest Update Log

- 2026-05-07: CI runs `nexus:diagnostics` after unit tests (writes via `NEXUS_DIAGNOSTICS_OUTPUT` under `tmp/`); added `test/integration/json_api_contracts_test.rb` for core JSON endpoint contracts; `CI=true` set on test jobs for test-environment eager loading parity with GitHub Actions.
- 2026-05-06: Extended `bin/rake nexus:diagnostics` snapshots with primary DB connection metadata, resolved document sync root, and both `storage/workspace` and `storage/workspace_test` directory summaries; updated `docs/DB_DIAGNOSTICS.md` accordingly (backend visibility before user-facing feature work).
- 2026-05-06: Owner responses captured and converted into execution defaults.
- 2026-05-06: Diagnostic tooling direction prioritized (database visibility + automated snapshots).
- 2026-05-06: This file is now treated as a living reference and must be updated with every substantive code/process change.
- 2026-05-06: Added docs/DB_DIAGNOSTICS.md with database inspection and snapshot workflow.
- 2026-05-06: Added lib/tasks/diagnostics.rake with task nexus:diagnostics.
- 2026-05-06: Updated docs/COMMANDS.md to include bin/rake nexus:diagnostics.
- 2026-05-06: Executed diagnostics task and generated docs/audit/diagnostics_20260506_073048.md.
- 2026-05-06: Added docs/NEXUS_MASTER_BLUEPRINT.md as full rebuild blueprint and memory-reset catch-up reference.

## Executive Summary

This audit covers the full folder tree with machine-generated evidence for all files currently present.

I produced a complete file manifest, per-file line/size/checksum metadata, route/action integrity checks, and low-confidence dead-code heuristics.

Important: the folder contains many runtime/generated artifacts (tmp, storage, log, .git) that dominate total line count. Semantic review is strongest for source/config/docs files and weaker for binary/generated data.

## What Was Scanned

- Total files in folder tree at scan time: 5355
- Total directories: 5150
- Total summed lines across all files: 1,773,385
- Runtime/generated-heavy files under tmp/log/storage/.git: 4993

## Evidence Artifacts (Generated)

- Full file list: docs/audit/all_files.txt
- Numbered file list: docs/audit/all_files_numbered.tsv
- Per-file metadata (path, bytes, lines, mime, sha1): docs/audit/file_stats.tsv
- Extension composition summary: docs/audit/extension_summary.tsv
- Text-like file subset: docs/audit/text_like_files.txt
- TODO/LEGACY marker hits: docs/audit/todo_legacy_hits.txt
- Rails authoritative routes dump: docs/audit/rails_routes.txt
- Route action verification: docs/audit/rails_route_action_check.tsv
- Framework route exceptions: docs/audit/rails_route_action_issues.tsv
- Ruby constants reference counts: docs/audit/ruby_constants_reference_counts.tsv
- Ruby probable-unreferenced constants: docs/audit/ruby_constants_probably_unreferenced.tsv
- Ruby probable-unreferenced methods (low confidence): docs/audit/ruby_method_probably_unreferenced.tsv
- Stimulus usage heuristic output: docs/audit/stimulus_usage.tsv
- Stimulus possible-unused list (likely false positives due eager loading): docs/audit/stimulus_possible_unused.tsv
- Runtime/generated sample paths: docs/audit/runtime_generated_sample.txt

## What I Know (High Confidence)

- Nexus is a Rails app with document/workspace primitives and desktop-style app windows.
- Core app routes are present and resolve to expected app and document endpoints.
- Rails route dump confirms namespace-backed controllers for apps/* endpoints.
- Source footprint is relatively compact compared with generated/runtime data.
- Explicit LEGACY markers are concentrated in Finder workspace initialization logic.
- There are no obvious unreferenced Ruby constants by simple token-count heuristic.

## Route Integrity Findings

From Rails route output and controller/action verification:

- Application-owned routes appear consistent.
- All issues in docs/audit/rails_route_action_issues.tsv are framework-managed endpoints (ActionMailbox, ActiveStorage, Turbo, Rails health), not necessarily problems in app code.

## Legacy/Technical Debt Markers Found

From docs/audit/todo_legacy_hits.txt:

- app/services/finder_workspace_initializer.rb contains legacy migration semantics:
  - LEGACY_DOCUMENTS_SECTION_TITLE
  - LEGACY_FINDER_WORKSPACE_FOLDER_TITLE
  - migration/normalization routines for old section names

Interpretation: this area intentionally preserves backward compatibility for pre-existing workspace structures.

## Potential Dead Code Candidates (Need Human Confirmation)

These are heuristic candidates only and can be false positives in Rails due callbacks, metaprogramming, implicit rendering, symbol dispatch, and external invocation.

- docs/audit/ruby_method_probably_unreferenced.tsv lists 59 methods with <=1 textual token hit.
- Many candidates are private helper/predicate methods where low textual count can still be valid.
- Examples that deserve targeted review first:
  - clear_draft!
  - purge_missing_from_database!
  - sync_from_disk!
  - ensure_embedded_folder!
  - migrate_legacy_* methods in Finder initialization

## Frontend Usage Caveat

Stimulus controllers are eagerly loaded via app/javascript/controllers/index.js.

- index.js uses eagerLoadControllersFrom("controllers", application)
- Therefore static import-count checks are not meaningful for usage.
- docs/audit/stimulus_possible_unused.tsv should be treated as low-confidence and only a starting point.

## What I Do Not Know Yet (Without Your Domain Input)

- Which legacy migrations/compat paths are still required for real user data in production.
- Which service methods are invoked indirectly by jobs, callbacks, or user-triggered flows not obvious from text search.
- Which workspace folders/files under storage/ are canonical fixtures vs disposable local data.
- Whether some framework endpoints (mailbox/storage/turbo conductor) are intentionally enabled though unused.
- Which docs in docs/ are normative versus historical.

## Questions For You (Please Reply Inline)

## Owner Responses And Execution Defaults (2026-05-06)

1. Environments for dead-code decisions
  - Owner response: both.
  - Execution default: evaluate impact in development and production before removal.

2. Framework routes removability
  - Owner response: unsure, revisit later.
  - Execution default: defer framework route removal until explicit usage audit is complete.

3. Backward compatibility requirement
  - Owner response: currently useful for diagnostics; open to alternatives if full DB visibility is improved.
  - Execution default: keep compatibility paths for now while building diagnostics tooling.

4. LEGACY_* paths in finder workspace initializer
  - Owner response: unsure; okay to start over because single user with backups.
  - Execution default: mark as removable candidate, but remove in phased batches with verification.

5. workspace vs workspace_test awareness
  - Owner response: unclear.
  - Execution default: document and surface both paths in diagnostics output before any cleanup.

6. Manual UI-only code paths
  - Owner response: unsure; wants diagnostics focus.
  - Execution default: bias toward instrumentation and route/action tracing before deleting uncertain paths.

7. <=1-reference methods cleanup policy
  - Owner response: asked for recommendation.
  - Recommendation and execution default: preserve by default, remove only when both conditions are met:
    - no route/job/callback/runtime reference evidence
    - tests or manual verification confirm behavior parity

8. Classification approach
  - Owner response: choose the most efficient understandable approach.
  - Execution default: use active / uncertain / candidate-remove tags with evidence links.

9. Unused Stimulus controller removal
  - Owner response: yes.
  - Execution default: remove only after dynamic usage verification (not static grep alone).

10. Historical migration/helper retention
   - Owner response: removing is acceptable at this stage.
   - Execution default: proceed with phased removal plan and rollback checkpoints.

11. Pre-current customers/workspaces
   - Owner response: none.
   - Execution default: compatibility constraints can be relaxed after backup validation.

12. tmp/log/.git/storage scope
   - Owner response: requested recommendation.
   - Recommendation and execution default:
    - tmp/log/.git: out-of-scope for dead-code removal (runtime/tooling state)
    - storage: in-scope only for contract/fixture review, not code-deletion evidence by itself

13. Test-driven second pass
   - Owner response: proceed at discretion.
   - Execution default: yes, include a test-driven pass.

14. Safe deletion PR plan
   - Owner response: yes, execute with minimal interruption, log all changes.
   - Execution default: use batched removals with changelog entries in this file.

15. Living doc policy
   - Owner response: yes, update every change.
   - Execution default: this document is canonical and must be updated per substantive change.

1. Which environments matter for dead-code decisions: local dev only, production only, or both?
2. Should framework routes (ActionMailbox, ActiveStorage, Turbo conductor) be considered removable unless explicitly used?
3. Is backward compatibility with existing workspace-on-disk structures mandatory?
4. Are LEGACY_* paths in app/services/finder_workspace_initializer.rb still required for active users?
5. Can we treat storage/workspace and storage/workspace_test as fixture/test data only, or do they include production-mirroring contracts?
6. Are there any code paths triggered exclusively by manual UI flows that do not appear in tests?
7. Should we consider methods with <=1 textual reference as cleanup candidates by default, or preserve unless proven unused?
8. Do you want me to classify every method into one of: used, uncertain, removable?
9. Is it acceptable to remove unused Stimulus controllers if no data-controller usage is found in views/templates?
10. Do you want strict removal of old migrations/helpers or keep historical migration helpers indefinitely?
11. Are there customers/workspaces created before current Finder section naming that must still load correctly?
12. Should I include tmp/log/.git/storage in dead-code decisions, or treat them as out-of-scope runtime state?
13. Do you want a second pass that is test-driven (run full test suite, then mark untouched code)?
14. Do you want me to produce a safe deletion PR plan (phase-by-phase with rollback)?
15. Should this audit become a living doc updated per release?

## Recommended Next Pass (After Your Answers)

- Build a file-by-file status table for app/, config/, db/, test/, docs/:
  - status = active, compat-legacy, uncertain, candidate-remove
- For each candidate-remove item:
  - cite all references
  - cite route/job/callback usage if any
  - propose deletion patch + test proof
- Run tests before/after each deletion batch.

## Active Execution Plan (Based On Owner Responses)

1. Add first-class diagnostics tools for full database and runtime visibility.
2. Classify app/config/db/test/docs into active, uncertain, and candidate-remove.
3. Build removal batch 1 from lowest-risk candidate-remove items.
4. Run tests and targeted manual checks before and after each batch.
5. Log each completed batch in Latest Update Log.

## Notes

This report is intentionally evidence-first and conservative about deletion.
Given your requirement that everything may be in place for a reason, nothing here is marked "safe to delete" yet without your answers.