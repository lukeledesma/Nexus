# Nexus Documentation Hub

This folder is organized so a new engineer or AI can get productive quickly.

## Start Here

1. Product and current state: [AI_HANDOFF.md](AI_HANDOFF.md)
2. Feature-level behavior map: [FEATURES.md](FEATURES.md)
3. System architecture and data flow: [SYSTEM_ARCHITECTURE.md](SYSTEM_ARCHITECTURE.md)
4. Operations and deploy commands: [COMMANDS.md](COMMANDS.md)
5. Deep developer implementation notes: [DEV_GUIDE.md](DEV_GUIDE.md)
6. UI implementation details: [UI_GUIDE.md](UI_GUIDE.md)
7. Roadmap and open questions: [ROADMAP.md](ROADMAP.md)

## What Is Canonical

- Current status and where work stopped: [AI_HANDOFF.md](AI_HANDOFF.md)
- Operational commands and production checks: [COMMANDS.md](COMMANDS.md)
- Core architecture and runtime behavior: [SYSTEM_ARCHITECTURE.md](SYSTEM_ARCHITECTURE.md)
- Feature behavior and ownership map: [FEATURES.md](FEATURES.md)

## Legacy / Historical References

The following files are historical audits and snapshots, useful for archaeology but not the first source for current behavior:

- [NEXUS_MASTER_BLUEPRINT.md](NEXUS_MASTER_BLUEPRINT.md)
- [NEXUS_FULL_REPO_AUDIT_2026-05-06.md](NEXUS_FULL_REPO_AUDIT_2026-05-06.md)
- [NEXUS_REBUILD_PHASE1_AUDIT.md](NEXUS_REBUILD_PHASE1_AUDIT.md)
- [DB_DIAGNOSTICS.md](DB_DIAGNOSTICS.md)
- [audit/](audit/)

## Documentation Update Rule

When behavior changes, update in this order:

1. [AI_HANDOFF.md](AI_HANDOFF.md) with latest state and unresolved items.
2. [FEATURES.md](FEATURES.md) for feature-level behavior changes.
3. [SYSTEM_ARCHITECTURE.md](SYSTEM_ARCHITECTURE.md) if architecture or data flow changed.
4. [COMMANDS.md](COMMANDS.md) if deploy/runbook steps changed.

This keeps future AI chats aligned with the real system state.
