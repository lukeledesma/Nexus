# NEXUS

Nexus is a Rails application for folder-based notes and task lists with filesystem-aware storage synchronization.

This README is a practical developer guide for building, running, and diagnosing the app.

## What Nexus Optimizes For

- Simple content model: folders + notes + task lists.
- Fast organizer UX for create, rename, and delete workflows.
- Predictable backend behavior with clear operational diagnostics.
- Safe production operation with explicit environment-driven configuration.

## Architecture Snapshot

- Rails app served by Puma.
- Nginx reverse proxy for public traffic.
- PostgreSQL for persistent data.
- Filesystem storage root under `storage/tag_lists` for organizer synchronization.

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

Production DB config is Nexus-first with compatibility fallback.

Preferred:
- `NEXUS_DATABASE_PASSWORD`
- `NEXUS_DB_NAME`
- `NEXUS_DB_USER`

Compatibility fallback still supported:
- `ALCHEMY_DATABASE_PASSWORD`
- Existing `alchemy_*` DB names if `NEXUS_*` names are not provided

Rails credentials:
- `RAILS_MASTER_KEY` must match `config/master.key`

## Operations (Production)

Health:

```bash
sudo systemctl status puma
sudo systemctl status nginx
curl -I http://127.0.0.1
```

Logs:

```bash
sudo journalctl -u puma -n 120 --no-pager
sudo tail -n 120 /var/log/nginx/error.log
```

Assets check:

```bash
ASSET=$(curl -s http://127.0.0.1 | grep -o '/assets/application-[^"]*\.css' | head -1)
echo "$ASSET"
curl -I "http://127.0.0.1$ASSET"
```

If assets are missing:

```bash
RAILS_ENV=production RAILS_MASTER_KEY="$(cat config/master.key)" NEXUS_DATABASE_PASSWORD="<db_password>" \
  /home/luke/.rbenv/versions/3.2.3/bin/bundle exec rails assets:clobber

RAILS_ENV=production RAILS_MASTER_KEY="$(cat config/master.key)" NEXUS_DATABASE_PASSWORD="<db_password>" \
  /home/luke/.rbenv/versions/3.2.3/bin/bundle exec rails assets:precompile
```

## Diagnosability Principles

- No disk sync at app boot (prevents unrelated task failures from boot side effects).
- Disk sync errors include request ID and condensed backtrace in logs.
- Routes and service wiring favor explicit behavior over hidden coupling.

## Key Backend Files

- `app/controllers/documents_controller.rb`
- `app/models/document.rb`
- `app/services/document_disk_loader.rb`
- `app/services/document_storage_sync_lite.rb`

## Key Frontend Files

- `app/views/documents/index.html.erb`
- `app/views/documents/edit.html.erb`
- `app/javascript/controllers/`
- `app/assets/stylesheets/`

## Development Standard

When changing behavior:
1. Keep backend and frontend changes cohesive.
2. Preserve clear failure modes with useful logs.
3. Update docs and command references in `/Users/luke/Projects/WEBSITE/docs`.
4. Validate create/edit/delete and asset delivery in production-like mode.
