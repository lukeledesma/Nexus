namespace :nexus do
  desc "Generate a database diagnostics snapshot under docs/audit"
  task diagnostics: :environment do
    require "fileutils"
    require "socket"

    timestamp = Time.current.strftime("%Y%m%d_%H%M%S")
    out_path =
      if ENV["NEXUS_DIAGNOSTICS_OUTPUT"].to_s.strip.present?
        Rails.root.join(ENV["NEXUS_DIAGNOSTICS_OUTPUT"].to_s.strip)
      else
        out_dir = Rails.root.join("docs", "audit")
        FileUtils.mkdir_p(out_dir)
        out_dir.join("diagnostics_#{timestamp}.md")
      end
    FileUtils.mkdir_p(out_path.dirname)

    conn = ActiveRecord::Base.connection
    tables = conn.tables.sort

    lines = []
    lines << "# Nexus Diagnostics Snapshot"
    lines << ""
    lines << "Generated at: #{Time.current.iso8601}"
    lines << "Environment: #{Rails.env}"
    lines << "Host: #{Socket.gethostname}"
    lines << "Database adapter: #{conn.adapter_name}"
    lines << "Table count: #{tables.length}"
    lines << ""

    db_cfg = ActiveRecord::Base.connection_db_config
    lines << "## Database connection (primary)"
    lines << "- config name: #{db_cfg.name}"
    lines << "- database: #{db_cfg.database}"
    lines << "- schema search path: #{conn.schema_search_path}" if conn.respond_to?(:schema_search_path)
    lines << ""

    nexus_storage = ENV["NEXUS_STORAGE_ROOT"].to_s.strip
    lines << "## Document disk sync root"
    lines << "- NEXUS_STORAGE_ROOT: #{nexus_storage.presence || "(unset; DocumentStorageSyncLite picks env default)"}"
    sync_root = DocumentStorageSyncLite.storage_root
    lines << "- resolved storage_root: #{sync_root}"
    lines << "- exists: #{sync_root.directory?}"
    if sync_root.directory?
      top = Dir.children(sync_root).size rescue "?"
      lines << "- top-level entries: #{top}"
    end
    lines << "- note: test environment uses storage/workspace_test unless NEXUS_STORAGE_ROOT is set"
    lines << ""

    workspace_dev = Rails.root.join("storage", "workspace")
    workspace_test = Rails.root.join("storage", "workspace_test")
    lines << "## Workspace directories on disk (both)"
    [ workspace_dev, workspace_test ].each do |p|
      label = p.basename.to_s
      next_lines = [ "- #{label}: #{p}" ]
      if p.directory?
        next_lines << "  - exists: yes"
        next_lines << "  - top-level entries: #{Dir.children(p).size rescue "?"}"
      else
        next_lines << "  - exists: no"
      end
      lines.concat(next_lines)
    end
    lines << ""

    lines << "## Tables"

    tables.each do |table|
      quoted = conn.quote_table_name(table)
      row_count = conn.select_value("SELECT COUNT(*) FROM #{quoted}").to_i
      columns = conn.columns(table).map(&:name)
      updated_at_max = nil

      if columns.include?("updated_at")
        updated_at_max = conn.select_value("SELECT MAX(updated_at) FROM #{quoted}")
      end

      lines << ""
      lines << "### #{table}"
      lines << "- rows: #{row_count}"
      lines << "- columns: #{columns.join(", ")}"
      lines << "- max updated_at: #{updated_at_max || "n/a"}"
    rescue StandardError => e
      lines << ""
      lines << "### #{table}"
      lines << "- error: #{e.class}: #{e.message}"
    end

    File.write(out_path, lines.join("\n") + "\n")
    puts "Diagnostics snapshot written: #{out_path}"
  end

  desc "Generate a storage health report (DB vs disk) under docs/audit"
  task storage_health: :environment do
    require "fileutils"

    timestamp = Time.current.strftime("%Y%m%d_%H%M%S")
    out_path =
      if ENV["NEXUS_STORAGE_HEALTH_OUTPUT"].to_s.strip.present?
        Rails.root.join(ENV["NEXUS_STORAGE_HEALTH_OUTPUT"].to_s.strip)
      else
        out_dir = Rails.root.join("docs", "audit")
        FileUtils.mkdir_p(out_dir)
        out_dir.join("storage_health_#{timestamp}.md")
      end
    FileUtils.mkdir_p(out_path.dirname)

    report = StorageHealthReport.call
    File.write(out_path, StorageHealthReport.to_markdown(report))
    puts "Storage health report written: #{out_path}"
  end
end
