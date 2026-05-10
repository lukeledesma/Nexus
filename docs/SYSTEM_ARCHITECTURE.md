# Nexus System Architecture

## System Overview

Nexus is a Rails monolith with Stimulus frontend behavior and a document-centric persistence model. It combines:

- server-rendered Rails views
- Stimulus controllers for rich UI interactions
- Action Cable for realtime sync
- filesystem-backed workspace concepts

## Runtime Layers

1. Browser layer
- Stimulus controllers drive interaction state, autosave triggers, and window UX.

2. Rails app layer
- Controllers/services enforce business logic and persistence.

3. Data layer
- Relational records for users/documents/state.
- Workspace storage folder for mirrored or embedded file workflows.

4. Realtime layer
- User-scoped Action Cable channel broadcasts state changes.

5. Edge/proxy layer
- nginx terminates TLS and proxies HTTP/WebSocket traffic to Puma.
- nginx serves delegated internal media paths for performance.

## Request and Data Flow Patterns

### Standard app interaction flow

1. User action in browser.
2. Stimulus controller submits endpoint or triggers autosave.
3. Rails persists change.
4. Rails broadcasts event for cross-device sync when appropriate.
5. Other clients apply event-driven updates.

### Media asset flow (production)

1. Browser requests document asset endpoint.
2. Rails verifies authorization and file eligibility.
3. Rails responds with internal redirect header for nginx.
4. nginx serves file bytes directly from storage path.

Result:
- less Puma thread blocking
- improved image/wallpaper response under load

### Websocket flow

1. Browser connects to /cable.
2. nginx forwards with websocket upgrade headers.
3. Action Cable authenticates session and subscribes to user stream.
4. Broadcasts fan out to subscribed clients.

## Key Architectural Constraints

- Production behavior must match local expectations where possible.
- UX must favor low-latency interactions.
- Realtime should replace refresh-heavy patterns when feasible.
- Save cadence should avoid excessive writes.

## Operational Architecture

### Deploy strategy

- Local source of truth pushed to GitHub main.
- Server deploy script performs fetch/reset/clean/build/restart.
- Services expected post-deploy:
  - puma active
  - nginx active

### Deploy script resilience

- Handles bootsnap cleanup race by retrying clean after targeted cache removal.
- Uses robust status checks for service reporting.

## Where To Dive Deeper

- Deploy and runbook details: [COMMANDS.md](COMMANDS.md)
- Deep implementation details: [DEV_GUIDE.md](DEV_GUIDE.md)
- Feature mapping: [FEATURES.md](FEATURES.md)
- Current state snapshot: [AI_HANDOFF.md](AI_HANDOFF.md)
