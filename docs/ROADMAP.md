# Nexus Roadmap and Open Work

## Current Priority

Primary objective is preserving and improving the "live and snappy" experience across the full app surface.

## In-Flight / High Priority

1. Production end-to-end realtime validation pass
- Verify calendar, quartz, tasks, finder, and other active surfaces update without refresh.
- Record any lagging routes/controllers and fix at source.

2. Image and wallpaper responsiveness hard validation
- Confirm production latency improvements under normal and burst usage.
- If needed, add objective timing checks and thresholds.

3. Wallpaper persistence regression backlog item
- Investigate and eliminate any flow where wallpaper can clear after unrelated UI changes.
- Add a regression test that simulates side-panel preview interactions before/after reload and verifies wallpaper persistence in both API response and workspace state file.

## Near-Term Improvements

1. Reduce remaining request noise
- Audit prefetch/background fetch patterns that do not add user value.

2. Query and indexing optimization
- Identify highest-volume document/state read-write paths.
- Add targeted optimizations where evidence supports it.

3. Operational hygiene
- Remove nginx configuration duplication/warning noise.
- Keep deploy scripts deterministic and low-maintenance.

## Medium-Term Direction

1. Better observability for UX-critical paths
- lightweight performance instrumentation for key app routes.

2. Realtime coverage expansion
- eliminate fallback polling where reliable cable updates are already available.

3. Feature-level reliability checks
- build smoke checks for core UX promises after deploy.

## Unresolved Questions

1. Should large image handling include thumbnail generation pipeline?
2. Should all app save events converge to one standardized broadcast contract?
3. What should be the accepted latency target for "snappy" across key interactions?

## Completion Signals

The current phase can be considered complete when:

- cross-device updates are consistently immediate in production for all major apps
- image/wallpaper open latency is reliably low
- deploy process is stable and quiet
- docs remain synchronized with actual behavior
