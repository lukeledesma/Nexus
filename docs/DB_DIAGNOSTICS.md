# Nexus Database Diagnostics Guide

This guide shows how to inspect everything currently in the database and produce repeatable snapshots.

## Fast Start

From project root:

```bash
bin/rake nexus:diagnostics
```

Storage/DB drift + usage snapshot:

```bash
bin/rake nexus:storage_health
```

To write the snapshot to a specific path (for example CI or a temp file), set **`NEXUS_DIAGNOSTICS_OUTPUT`** to a path relative to the Rails root or an absolute path. The parent directory is created if needed.

```bash
NEXUS_DIAGNOSTICS_OUTPUT=tmp/my_snapshot.md bin/rake nexus:diagnostics
```

```bash
NEXUS_STORAGE_HEALTH_OUTPUT=tmp/my_storage_health.md bin/rake nexus:storage_health
```

Output:
- A markdown snapshot file is written to `docs/audit` with:
  - **Database connection (primary)** — config name and database name (so you know which DB you are looking at).
  - **Document disk sync root** — resolved `DocumentStorageSyncLite.storage_root`, whether `NEXUS_STORAGE_ROOT` is set, and a short note on `workspace` vs `workspace_test` in test.
  - **Workspace directories on disk (both)** — presence of `storage/workspace` and `storage/workspace_test` plus top-level entry counts (quick sanity check without scanning the whole tree).
  - **Tables** — per-table row counts, columns, and max `updated_at` when present.

`nexus:storage_health` writes a markdown report to `docs/audit` with:
- **DB rows missing on disk** (first 200 listed)
- **Disk files missing in DB** (first 200 listed)
- **Duplicate DB storage paths**
- **Usage by content type** (`db_rows`, `db_content_bytes`, `disk_bytes`, `missing_on_disk`)
- **Alchemy totals** (`db_rows`, `db_content_bytes`, `disk_bytes`, `missing_on_disk`)

## See Which Databases Exist

Show configured databases and environments:

```bash
bin/rails db:version
bin/rails runner 'puts ActiveRecord::Base.configurations.configs_for(env_name: Rails.env).map { |c| "#{c.name}: #{c.database}" }'
```

## Full Table Inventory (Current Environment)

```bash
bin/rails runner 'c = ActiveRecord::Base.connection; puts c.tables.sort'
```

## Row Counts For Every Table

```bash
bin/rails runner '
c = ActiveRecord::Base.connection
c.tables.sort.each do |t|
  q = "SELECT COUNT(*) FROM #{c.quote_table_name(t)}"
  puts "#{t}\t#{c.select_value(q)}"
end
'
```

## Column Inventory For Every Table

```bash
bin/rails runner '
c = ActiveRecord::Base.connection
c.tables.sort.each do |t|
  cols = c.columns(t).map(&:name).join(", ")
  puts "\n#{t}:\n  #{cols}"
end
'
```

## Open Rails Console For Manual Inspection

```bash
bin/rails console
```

Useful console checks:

```ruby
Document.count
User.count
Document.where(is_folder: true).count
Document.where(is_folder: false).count
Document.group(:content_type).count
```

## Inspect Production-Like Behavior Locally

Use production mode only when intentionally verifying production behavior:

```bash
RAILS_ENV=production bin/rails runner 'puts ActiveRecord::Base.connection.tables.sort'
```

## Notes On workspace and workspace_test

- storage/workspace is the default workspace mirror.
- storage/workspace_test is used in test context.
- These folders are disk mirrors and should not be treated as proof of dead code by themselves.

## Recommended Routine

1. Run bin/rake nexus:diagnostics before cleanup work.
2. Run tests.
3. Apply one cleanup batch.
4. Run bin/rake nexus:diagnostics and bin/rake nexus:storage_health again.
5. Compare snapshots and update docs/NEXUS_FULL_REPO_AUDIT_2026-05-06.md.
