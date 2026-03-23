# Nexus V1 Reference

This file is the technical reference for Nexus V1 behavior and intended maintenance model.

## Product Scope

Nexus provides:
- Folder organization
- Notes
- Task lists
- Disk-aware storage synchronization for organizer data

## Runtime Assumptions

- Rails app behind Nginx and Puma
- PostgreSQL persistence
- Storage path rooted at `storage/tag_lists`

## Behavior Summary

- Organizer operations are backed by DB records and mirrored to disk.
- Edit flows support both note content and structured task list payloads.
- Disk synchronization is executed in controller workflows, not at application boot.

## Operational Dependencies

- `RAILS_MASTER_KEY`
- DB credentials via `NEXUS_DATABASE_PASSWORD` (legacy fallback supported)

## Non-Goals for V1

- Complex boot-time side effects
- Hidden coupling between unrelated tasks and disk sync operations

## Maintenance Rules

- Any route/controller/model/storage behavior change must update this file.
- Any env var contract change must update this file.
- Any deploy/runtime assumption change must update this file.

## Future Cleanup Targets

- Remove compatibility fallback names after one stable release cycle.
- Consolidate remaining legacy identifiers in infrastructure configs.
- Add explicit health/readiness probes for DB and storage sync readiness.
