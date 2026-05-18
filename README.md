# Nexus

A browser-based workspace application built with Rails. Provides desktop-style windows, a folder-based file organizer, and real-time synchronization across devices.

**Stack:** Ruby 3.2.3 · Rails 8.1.3 · PostgreSQL · Hotwire · Action Cable

Source: [github.com/lukeledesma/Nexus](https://github.com/lukeledesma/Nexus)  
Production: [nxs.tools](https://nxs.tools)

---

## Overview

Nexus delivers an OS-like experience in the browser. All content is stored in PostgreSQL and mirrored to disk under `storage/workspace/` for predictable sync behavior.

**Included apps:**

- **Finder** — folder tree with file operations (create, rename, move, delete, favorites)
- **Quartz** — A powerful and expandable text-based application for all workflows.
- **Tasks** — Task lists with subtasks and inline notes
- **Calendar** — event scheduling with persistent embedded storage
- **Images** — browse and view uploaded image assets
- **Audio** — browse and preview audio files

**Core shell behavior:**

- Desktop-style windowing with open/close/toggle interactions
- Organizer sidebar for navigating the workspace folder tree
- Real-time sync across sessions via Action Cable
- Window state persisted and restored across page refreshes
- nginx-backed asset delivery via `X-Accel-Redirect` for fast image/audio serving

---

## Quick Start

**Requirements:** Ruby 3.2.3, PostgreSQL, Bundler

```bash
bundle install
bin/rails db:create db:migrate
bin/rails server
```

Open [http://localhost:3000](http://localhost:3000)

---

## Testing

```bash
bin/rails test           # unit + integration (98 tests)
bin/rails test:system    # system tests via Capybara + Chrome
```

---

## Security

All dependencies are audited on every run of `./bin/audit`, which runs:

- **bundler-audit** — checks gems against the ruby-advisory-db
- **brakeman** — static analysis for Rails security vulnerabilities

Run the audit locally before pushing:

```bash
./bin/audit
```

The latest security audit and remediation log is at [`docs/SECURITY_AUDIT_2026_05_13.md`](docs/SECURITY_AUDIT_2026_05_13.md).

---

## Deployment

Nexus uses a two-script GitHub-first deploy flow:

```bash
# 1. Stage all changes, prompt for commit message, push to GitHub
./deploy/deploy_github.sh

# 2. SSH to server, git pull, bundle install, precompile assets, restart Puma
./deploy/deploy_server.sh

# Or do both in one shot:
./deploy.sh
```

**Setup:** Copy `deploy/deploy.local.env.example` → `deploy/deploy.local.env` and fill in your server details. This file is gitignored and never committed.

See [`docs/COMMANDS.md`](docs/COMMANDS.md) for the full operations runbook.

---

## Environment Variables

| Variable | Required | Default | Purpose |
|---|---|---|---|
| `NEXUS_DEPLOY_HOST` | ✅ | — | Production server hostname |
| `NEXUS_DATABASE_PASSWORD` | ✅ | — | PostgreSQL password |
| `RAILS_MASTER_KEY` | ✅ | — | Must match `config/master.key` |
| `NEXUS_DB_NAME` | — | `nexus_production` | Database name |
| `NEXUS_DB_USER` | — | `nexus` | Database user |
| `NEXUS_DEPLOY_USER` | — | `deploy` | SSH user |
| `NEXUS_DEPLOY_APP` | — | `/home/deploy/apps/nexus` | App path on server |
| `NEXUS_DEPLOY_SSH_KEY` | — | `~/.ssh/id_ed25519` | SSH key path |
| `NEXUS_DEPLOY_RUBY` | — | rbenv default | Ruby bin path on server |

---

## Documentation

| File | Purpose |
|---|---|
| [`docs/FEATURES.md`](docs/FEATURES.md) | Feature-level behavior map |
| [`docs/SYSTEM_ARCHITECTURE.md`](docs/SYSTEM_ARCHITECTURE.md) | Data flow and system design |
| [`docs/DEV_GUIDE.md`](docs/DEV_GUIDE.md) | Technical architecture and implementation details |
| [`docs/COMMANDS.md`](docs/COMMANDS.md) | Deploy and operations reference |
| [`docs/UI_GUIDE.md`](docs/UI_GUIDE.md) | UI behavior and interaction rules |
| [`docs/ROADMAP.md`](docs/ROADMAP.md) | Planned work and open questions |
| [`docs/AI_HANDOFF.md`](docs/AI_HANDOFF.md) | Current project state for AI continuity |

---

## Contributing

1. Run `./bin/audit` before pushing — must return no vulnerabilities.
2. Run `bin/rails test` — must pass with 0 failures and 0 errors.
3. Keep backend and frontend changes cohesive.
4. Update [`docs/AI_HANDOFF.md`](docs/AI_HANDOFF.md) after any significant work.
5. Validate create, edit, delete, and asset delivery before deploying to production.
