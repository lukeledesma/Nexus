# AI Handoff - Current Project State

Last updated: 2026-05-10

## Project Purpose

Nexus is a browser-based OS-like workspace built on Rails. The core product promise is:

- fast and snappy UI
- live cross-device synchronization
- predictable, file-like persistence behavior

## Current Environment Status

- Branch: main
- Production host: nxs.tools
- Action Cable route: /cable
- Deploy pipeline: script-based via deploy/deploy_server.sh
- Latest known deployment commit (from recent run): ef1b5c9

## What Was Recently Completed

1. Realtime synchronization infrastructure:
- User-scoped Action Cable channel for app/document/state updates.
- Frontend subscription wiring for receiving and applying remote updates.

2. Production websocket reliability:
- nginx /cable proxy configured with websocket upgrade headers.
- Production websocket upgrades verified in logs.

3. Calendar persistence redesign:
- Calendar events persisted to a single Embedded Calendar file.
- Save flow normalized through service layer.

4. Save behavior tuning for UX:
- Notes and Time Card changed from per-keystroke save to blur/unselect save.

5. Finder noise/performance mitigation:
- Request noise reduction changes (including prefetch behavior tuning).

6. Image/wallpaper performance improvement:
- Production asset delivery shifted to nginx-backed X-Accel-Redirect flow.
- Rails now authorizes then delegates file bytes to nginx for faster serving.

7. Deploy script hardening:
- Handles git clean failures caused by bootsnap cache race conditions.
- Fixes heredoc command-substitution bug so remote status checks run remotely.
- Deploy summaries now report Puma and nginx status correctly.

## Known Working Expectations

- Deploy script should complete and report:
  - local commit
  - server commit
  - puma status active
  - nginx status active
- Production realtime should not require manual refresh for supported features.
- Production image/wallpaper loading should be materially faster than previous Rails-only serving path.

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

1. [README.md](README.md)
2. [FEATURES.md](FEATURES.md)
3. [SYSTEM_ARCHITECTURE.md](SYSTEM_ARCHITECTURE.md)
4. [COMMANDS.md](COMMANDS.md)

Then run a production validation sweep before changing behavior.
