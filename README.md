# NEXUS

Nexus is a Rails application for folder-based notes and task lists with filesystem-aware storage synchronization.

This repository is the local source of truth for development and deployment.

Primary paths:
- Local repo: `/Users/luke/Projects/WEBSITE/Nexus_Dev`
- Command shortcuts: `/Users/luke/Projects/WEBSITE/docs/COMMANDS.md`
- Deploy scripts: `/Users/luke/Projects/WEBSITE/deploy/`
- Technical docs: `docs/UI_GUIDE.md` and `docs/DEV_GUIDE.md`

## What Nexus Optimizes For

- Simple content model: folders + notes + task lists.
- Fast organizer UX for create, rename, and delete workflows.
- Predictable backend behavior with clear operational diagnostics.
- Safe production operation with explicit environment-driven configuration.

## Architecture Snapshot

- Rails app served by Puma.
- Nginx reverse proxy for public traffic.
- PostgreSQL for persistent data.
- Filesystem storage root under `storage/workspace` for organizer synchronization.

Request flow:
1. Browser -> Nginx
2. Nginx -> Puma (`127.0.0.1:3000`)
3. Puma -> Rails controller/action
4. Rails -> PostgreSQL + disk sync services

## Requirements

- Ruby 3.2.3
- PostgreSQL
- Bundler

## Setup (Local)

```bash
bundle install
bin/rails db:create
bin/rails db:migrate
```

Run server:

```bash
cd /Users/luke/Projects/WEBSITE/Nexus_Dev
bin/rails server
```

Open:

`http://localhost:3000`

## Test

Run all tests:

```bash
bin/rails test
```

## Environment Variables

Production DB config uses:
- `NEXUS_DATABASE_PASSWORD`
- `NEXUS_DB_NAME` (default: `alchemy_production` — legacy DB name on server)
- `NEXUS_DB_USER` (default: `alchemy` — legacy DB user on server)

Rails credentials:
- `RAILS_MASTER_KEY` must match `config/master.key`

## Operations (Production)

Deploy from the cleaned workflow:

```bash
/Users/luke/Projects/WEBSITE/deploy/deploy_github.sh
/Users/luke/Projects/WEBSITE/deploy/deploy_server.sh
```

Health:

```bash
sudo systemctl status puma
sudo systemctl status nginx
curl -I http://127.0.0.1
curl -I http://172.232.163.176
```

Logs:

```bash
sudo journalctl -u puma -n 120 --no-pager
sudo tail -n 120 /var/log/nginx/error.log
tail -n 120 /home/luke/apps/nexus/log/puma.log
```

Assets check:

```bash
ASSET=$(curl -s http://127.0.0.1 | grep -o '/assets/application-[^"]*\.css' | head -1)
echo "$ASSET"
curl -I "http://127.0.0.1$ASSET"
```

If assets are missing:

```bash
cd /home/luke/apps/nexus
export PATH="/home/luke/.rbenv/versions/3.2.3/bin:$PATH"
SECRET_KEY_BASE_DUMMY=1 RAILS_ENV=production bundle exec rails assets:clobber
SECRET_KEY_BASE_DUMMY=1 RAILS_ENV=production bundle exec rails assets:precompile
sudo systemctl restart puma
```

## Diagnosability Principles

- No disk sync at app boot (prevents unrelated task failures from boot side effects).
- Disk sync errors include request ID and condensed backtrace in logs.
- Routes and service wiring favor explicit behavior over hidden coupling.

## Key Backend Files

- `app/controllers/documents_controller.rb`
- `app/models/folder.rb`
- `app/models/item.rb`
- `app/services/item_storage_sync_lite.rb`
- `app/controllers/apps/notes_controller.rb`
- `app/controllers/apps/task_lists_controller.rb`

## Key Frontend Files

- `app/views/organizer/_sidebar.html.erb`
- `app/views/apps/notes/show.html.erb`
- `app/views/apps/task_lists/show.html.erb`
- `app/javascript/controllers/`
- `app/assets/stylesheets/application.css`

## Development Standard

When changing behavior:
1. Keep backend and frontend changes cohesive.
2. Preserve clear failure modes with useful logs.
3. Update docs and command references in `/Users/luke/Projects/WEBSITE/docs`.
4. Validate create/edit/delete and asset delivery in production-like mode.
5. Treat `Nexus_Dev` as the only app root.
