# AI Handoff - Current Project State

Last updated: 2026-05-14

## Project Purpose

Nexus is a browser-based OS-like workspace built on Rails. The core product promise is:

- fast and snappy UI
- live cross-device synchronization
- predictable, file-like persistence behavior

## Current Environment Status

- Branch: main
- Production host: nxs.tools
- Rails version: 8.1.3
- Ruby version: 3.2.3
- Action Cable route: /cable
- Deploy pipeline: script-based via deploy/deploy_server.sh

## What Was Recently Completed

1. Security dependency audit and full remediation (2026-05-13):
- Upgraded Rails 8.1.2 → 8.1.3, resolving 9 CVEs across actionpack, actionview, activestorage, activesupport.
- Upgraded rack 3.2.5 → 3.2.6, resolving 11 CVEs including High-severity static file exposure and multipart DoS.
- Upgraded rack-session 2.1.1 → 2.1.2, resolving a Critical RCE via Marshal deserialization on session forgery (CVE-2026-39324).
- Upgraded addressable 2.8.9 → 2.9.0, resolving High-severity ReDoS (CVE-2026-35611).
- Upgraded nokogiri 1.19.1 → 1.19.3, resolving High-severity CSS selector ReDoS.
- Upgraded mcp 0.8.0 → 0.15.0, resolving High-severity SSE stream hijacking (CVE-2026-33946).
- secret_key_base rotated after rack-session upgrade (required to fully remediate session forgery CVE).
- bundler-audit and brakeman both return clean after all upgrades.
- See docs/SECURITY_AUDIT_2026_05_13.md for the full report.

2. Test suite fixes (2026-05-13):
- Removed duplicate private `files_by_date` definition in TimeCardController (was causing 404 on the action).
- Added `apply_theme_gradient` rejection to WorkspacePreferencesController (returns 422 as expected).
- Removed `require "minitest/mock"` from test_helper (Minitest 6 merged mock into core — the separate file no longer exists).
- Fixed `Finder::MigrationService` to use module nesting (required by Zeitwerk in Rails 8.1.3).
- Implemented `migrate_legacy_favorites!` in FinderWorkspaceInitializer.
- All 98 tests pass, 0 failures, 0 errors.

3. Realtime synchronization infrastructure:
- User-scoped Action Cable channel for app/document/state updates.
- Frontend subscription wiring for receiving and applying remote updates.

10. Unified broadcast system (2026-05-14):
- UserSyncChannel consolidated from 6 methods to 3: broadcast_state_change, broadcast_document_change, broadcast_workspace_change.
- broadcast_workspace_change(kind: "finder"|"wallpaper") replaces broadcast_finder_change and broadcast_wallpaper_change.
- Calendar now routes through broadcast_document_change(content_type: "calendar_events") instead of its own method.
- Double broadcast for task_list saves eliminated (was calling both broadcast_task_list_change and broadcast_document_change).
- nexus_sync_channel.js collapsed from 6 handlers to 3 (state_changed, document_changed, workspace_changed).
- calendar_app_controller.js: nexus:calendar-remote-changed listener removed; calendar updates handled in handleRemoteDocumentChanged filtering by content_type.
- task_list_editor_controller.js: nexus:task-list-remote-changed listener replaced with nexus:document-remote-changed filtered by content_type === "task_list".

4. Production websocket reliability:
- nginx /cable proxy configured with websocket upgrade headers.
- Production websocket upgrades verified in logs.

5. Calendar persistence redesign:
- Calendar events persisted to a single Embedded Calendar file.
- Save flow normalized through service layer.

6. Save behavior tuning for UX:
- Notes and Time Card changed from per-keystroke save to blur/unselect save.

7. Finder noise/performance mitigation:
- Request noise reduction changes (including prefetch behavior tuning).

8. Image/wallpaper performance improvement:
- Production asset delivery shifted to nginx-backed X-Accel-Redirect flow.
- Rails now authorizes then delegates file bytes to nginx for faster serving.

9. Deploy script hardening:
- Handles git clean failures caused by bootsnap cache race conditions.
- Fixes heredoc command-substitution bug so remote status checks run remotely.
- Deploy summaries now report Puma and nginx status correctly.

## Known Working Expectations

- `./bin/audit` returns no vulnerabilities (bundler-audit + brakeman both clean).
- `bin/rails test` passes 98 tests, 0 failures, 0 errors.
- Deploy script should complete and report: local commit, server commit, puma status active, nginx status active.
- Production realtime should not require manual refresh for supported features.
- Production image/wallpaper loading should be materially faster than the previous Rails-only serving path.

## Active Priorities

1. Validate end-to-end live sync across all app surfaces on production with a single structured pass.
2. Confirm no remaining slow paths for wallpapers/images under realistic concurrency.
3. Continue tightening system responsiveness while preserving current behavior contracts.

## Open Questions / Follow-ups

1. Should nginx site duplication/warning noise be cleaned up now or deferred?
2. Do we want thumbnail generation/previews for large images as next perf step?
3. Should polling fallbacks be removed entirely in areas now covered by reliable cable events?

## If You Are The Next AI

Start with these files in this order:

1. [README.md](../README.md)
2. [FEATURES.md](FEATURES.md)
3. [SYSTEM_ARCHITECTURE.md](SYSTEM_ARCHITECTURE.md)
4. [COMMANDS.md](COMMANDS.md)

Then run `./bin/audit` and `bin/rails test` to confirm baseline health before changing anything.
