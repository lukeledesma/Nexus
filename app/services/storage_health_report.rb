# frozen_string_literal: true

require "find"
require "set"

class StorageHealthReport
  def self.call(storage_root: DocumentStorageSyncLite.storage_root)
    new(storage_root: storage_root).call
  end

  def self.to_markdown(report)
    generated_at = report[:generated_at]
    storage_root = report[:storage_root]
    summary = report[:summary]
    alchemy = report[:alchemy]
    usage = report[:usage_by_content_type]
    missing = report[:db_rows_missing_on_disk]
    disk_only = report[:disk_files_missing_in_db]
    duplicates = report[:duplicate_db_storage_paths]

    lines = []
    lines << "# Nexus Storage Health Report"
    lines << ""
    lines << "Generated at: #{generated_at}"
    lines << "Environment: #{Rails.env}"
    lines << "Storage root: #{storage_root}"
    lines << ""
    lines << "## Summary"
    lines << "- DB file rows: #{summary[:db_file_rows]}"
    lines << "- DB folder rows: #{summary[:db_folder_rows]}"
    lines << "- Disk files scanned: #{summary[:disk_files_scanned]}"
    lines << "- DB rows missing on disk: #{summary[:db_missing_on_disk_count]}"
    lines << "- Disk files missing in DB: #{summary[:disk_missing_in_db_count]}"
    lines << "- Duplicate DB storage paths: #{summary[:duplicate_db_storage_path_count]}"
    lines << "- Total bytes on disk (scanned files): #{summary[:disk_total_bytes]}"
    lines << "- Total DB content bytes (file rows): #{summary[:db_total_content_bytes]}"
    lines << ""
    lines << "## Alchemy"
    lines << "- DB rows: #{alchemy[:db_rows]}"
    lines << "- DB content bytes: #{alchemy[:db_content_bytes]}"
    lines << "- Disk bytes (existing file paths): #{alchemy[:disk_bytes]}"
    lines << "- Missing on disk: #{alchemy[:missing_on_disk_count]}"
    lines << ""
    lines << "## Usage by content type"
    usage.each do |item|
      lines << "- #{item[:content_type]}: rows=#{item[:db_rows]}, db_content_bytes=#{item[:db_content_bytes]}, disk_bytes=#{item[:disk_bytes]}, missing_on_disk=#{item[:missing_on_disk_count]}"
    end

    lines << ""
    lines << "## DB rows missing on disk (first 200)"
    if missing.empty?
      lines << "- none"
    else
      missing.first(200).each do |row|
        lines << "- id=#{row[:id]} content_type=#{row[:content_type]} storage_path=#{row[:storage_path]}"
      end
    end

    lines << ""
    lines << "## Disk files missing in DB (first 200)"
    if disk_only.empty?
      lines << "- none"
    else
      disk_only.first(200).each do |row|
        lines << "- #{row[:storage_path]} (#{row[:bytes]} bytes)"
      end
    end

    lines << ""
    lines << "## Duplicate DB storage paths"
    if duplicates.empty?
      lines << "- none"
    else
      duplicates.each do |item|
        lines << "- #{item[:storage_path]}: #{item[:count]} rows"
      end
    end

    lines.join("\n") + "\n"
  end

  def initialize(storage_root:)
    @storage_root = Pathname.new(storage_root)
  end

  def call
    db_files = Document.files.where.not(storage_path: [nil, ""]).select(:id, :storage_path, :content_type).to_a
    db_file_paths = db_files.map { |doc| doc.storage_path.to_s }.to_set
    disk_files = disk_files_under_storage_root

    missing_on_disk = db_files.filter_map do |doc|
      rel = doc.storage_path.to_s
      next if rel.blank?
      next if @storage_root.join(rel).file?

      { id: doc.id, storage_path: rel, content_type: doc.content_type.to_s }
    end

    disk_only = disk_files.reject { |entry| db_file_paths.include?(entry[:storage_path]) }

    db_rows_by_type = Document.files.group(:content_type).count
    db_content_bytes_by_type = db_content_bytes_by_content_type
    disk_bytes_by_type = disk_bytes_by_content_type(db_files)
    missing_by_type = missing_on_disk.group_by { |row| row[:content_type] }.transform_values(&:count)

    content_types = (db_rows_by_type.keys + db_content_bytes_by_type.keys + disk_bytes_by_type.keys).map(&:to_s).uniq.sort
    usage_by_content_type = content_types.map do |type|
      {
        content_type: type,
        db_rows: db_rows_by_type[type].to_i,
        db_content_bytes: db_content_bytes_by_type[type].to_i,
        disk_bytes: disk_bytes_by_type[type].to_i,
        missing_on_disk_count: missing_by_type[type].to_i
      }
    end

    duplicate_paths = Document.files.where.not(storage_path: [nil, ""]).group(:storage_path).having("COUNT(*) > 1").count
    duplicate_db_storage_paths = duplicate_paths.map do |storage_path, count|
      { storage_path: storage_path.to_s, count: count.to_i }
    end.sort_by { |item| [ -item[:count], item[:storage_path] ] }

    alchemy = usage_by_content_type.find { |item| item[:content_type] == "alchemy_tag_list" } || {
      content_type: "alchemy_tag_list",
      db_rows: 0,
      db_content_bytes: 0,
      disk_bytes: 0,
      missing_on_disk_count: 0
    }

    {
      generated_at: Time.current.iso8601,
      storage_root: @storage_root.to_s,
      summary: {
        db_file_rows: Document.files.count,
        db_folder_rows: Document.folders.count,
        disk_files_scanned: disk_files.length,
        db_missing_on_disk_count: missing_on_disk.length,
        disk_missing_in_db_count: disk_only.length,
        duplicate_db_storage_path_count: duplicate_db_storage_paths.length,
        disk_total_bytes: disk_files.sum { |entry| entry[:bytes] },
        db_total_content_bytes: db_content_bytes_by_type.values.sum
      },
      alchemy: {
        db_rows: alchemy[:db_rows],
        db_content_bytes: alchemy[:db_content_bytes],
        disk_bytes: alchemy[:disk_bytes],
        missing_on_disk_count: alchemy[:missing_on_disk_count]
      },
      usage_by_content_type: usage_by_content_type,
      db_rows_missing_on_disk: missing_on_disk.sort_by { |row| [row[:content_type], row[:storage_path]] },
      disk_files_missing_in_db: disk_only.sort_by { |row| row[:storage_path] },
      duplicate_db_storage_paths: duplicate_db_storage_paths
    }
  end

  private

  def disk_files_under_storage_root
    return [] unless @storage_root.directory?

    files = []
    Find.find(@storage_root.to_s) do |absolute|
      next unless File.file?(absolute)

      relative = Pathname.new(absolute).relative_path_from(@storage_root).to_s
      next if hidden_path?(relative)

      files << { storage_path: relative, bytes: File.size(absolute) }
    end
    files
  end

  def hidden_path?(relative)
    relative.split("/").any? { |segment| segment.start_with?(".") }
  end

  def db_content_bytes_by_content_type
    bytes = Hash.new(0)
    Document.files.where.not(content: [nil, ""]).select(:id, :content_type, :content).find_each do |doc|
      bytes[doc.content_type.to_s] += doc.content.to_s.bytesize
    end
    bytes
  end

  def disk_bytes_by_content_type(db_files)
    bytes = Hash.new(0)
    db_files.each do |doc|
      rel = doc.storage_path.to_s
      next if rel.blank?

      abs = @storage_root.join(rel)
      next unless abs.file?

      bytes[doc.content_type.to_s] += abs.size
    end
    bytes
  end
end
