# Nexus

Nexus is a Rails workspace app with desktop-style windows and a folder-based organizer.

Current modules include Notes, Tasks, Time Card, Images, and Audio.

It stores data in PostgreSQL and mirrors workspace content to disk for predictable synchronization behavior.

Source: [github.com/lukeledesma/Nexus](https://github.com/lukeledesma/Nexus)

## What It Does

- Organizer-style navigation for folders and documents.
- App windows for Notes, Tasks, Time Card, Images, and Audio.
- Autosave editing for text and task workflows.
- Filesystem-aware sync under storage/workspace.

## Included Apps

- Notes: rich text note editing with autosave.
- Tasks: task lists with subtasks and inline notes.
- Time Card: clock in/out workflow with saved note state.
- Images: browse uploaded image assets in the workspace.
- Audio: browse and preview supported audio assets.

## Core Behavior

- Open, rename, move, and delete files/folders from the organizer UI.
- Save app content into Finder folders as workspace documents.
- Keep draft flows for linked apps (task, note, time card) under Embedded.
- Persist and restore window state across refresh.

## Quick Start

### Requirements

- Ruby 3.2.3
- PostgreSQL
- Bundler

### Run Locally

```bash
bundle install
bin/rails db:create
bin/rails db:migrate
bin/rails server
```

Open http://localhost:3000

### Run Tests

```bash
bin/rails test
```

## Repo Map

- docs/COMMANDS.md: command and deploy reference.
- docs/UI_GUIDE.md: UI behavior and interaction rules.
- docs/DEV_GUIDE.md: technical architecture and implementation details.
- deploy/: deployment scripts and local deploy env template.

## Deployment

Nexus includes two scripts for a GitHub-first deploy flow:

```bash
./deploy/deploy_github.sh
./deploy/deploy_server.sh
```

Set deploy environment values in deploy/deploy.local.env using deploy/deploy.local.env.example.

For full operations details, see docs/COMMANDS.md.

## Environment Variables

Production database settings:

- NEXUS_DATABASE_PASSWORD
- NEXUS_DB_NAME (default: nexus_production)
- NEXUS_DB_USER (default: nexus)

Deploy settings:

- NEXUS_DEPLOY_HOST (required)
- NEXUS_DEPLOY_USER (optional)
- NEXUS_DEPLOY_APP (optional)
- NEXUS_DEPLOY_RUBY (optional)
- NEXUS_DEPLOY_SSH_KEY (optional)

Rails credentials:

- RAILS_MASTER_KEY must match config/master.key

## Contributing Notes

When changing behavior:

1. Keep backend and frontend changes cohesive.
2. Preserve useful failure logs.
3. Update docs when commands or deploy assumptions change.
4. Validate create, edit, delete, and asset delivery in a production-like run.
