# Nexus

Nexus is a workspace app for writing notes and managing task lists in a folder-style interface.

It is built with Rails, keeps data in PostgreSQL, and mirrors workspace content to disk for predictable synchronization behavior.

Source: [github.com/lukeledesma/Nexus](https://github.com/lukeledesma/Nexus)

## Why Nexus

Nexus is designed for people who want:

- Notes and tasks in one place.
- Fast create, rename, and delete flows.
- A simple folder mental model.
- Stable, explicit backend behavior.

## What You Get

- Organizer-style navigation for folders and documents.
- App windows for notes and task lists.
- Autosave editing flows.
- Filesystem-aware sync under storage/workspace.

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
