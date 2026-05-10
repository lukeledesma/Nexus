# Docs Maintenance Playbook

## Goal

Keep docs useful for both humans and future AI sessions by preserving one clear source of truth per concern.

## Source Of Truth By Concern

- Current state and handoff: [AI_HANDOFF.md](AI_HANDOFF.md)
- Feature behavior map: [FEATURES.md](FEATURES.md)
- Architecture/runtime flow: [SYSTEM_ARCHITECTURE.md](SYSTEM_ARCHITECTURE.md)
- Commands and deploy operations: [COMMANDS.md](COMMANDS.md)

## Update Triggers

Update docs immediately when any of the following changes:

1. Routes or endpoint behavior.
2. Realtime event contracts or channel behavior.
3. Persistence model and save cadence.
4. Deploy script logic or production runbook steps.
5. Performance-critical serving paths (such as media).

## Update Checklist

1. Update [AI_HANDOFF.md](AI_HANDOFF.md) with what changed and what remains.
2. Update [FEATURES.md](FEATURES.md) if any feature behavior changed.
3. Update [SYSTEM_ARCHITECTURE.md](SYSTEM_ARCHITECTURE.md) if architecture changed.
4. Update [COMMANDS.md](COMMANDS.md) for any operational command changes.
5. Keep [README.md](README.md) as the navigation index.

## Anti-Patterns To Avoid

- Relying on historical audit files for current behavior.
- Splitting critical guidance across too many unindexed files.
- Leaving unresolved incident context only in chat history.

## Archival Guidance

Historical audits can stay in place for traceability, but new behavior should not be documented there first.
