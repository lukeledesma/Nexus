# frozen_string_literal: true

require "fileutils"
require "find"
require "time"

class DocumentDiskLoader
  class << self
    def sync!
      return if syncing?

      begin_sync!
      ensure_roots!
      sync_from_disk!
    ensure
      end_sync!
    end

    def syncing?
      Thread.current[:document_disk_loader_syncing] == true
    end

    private

    def begin_sync!
      Thread.current[:document_disk_loader_syncing] = true
    end

    def end_sync!
      Thread.current[:document_disk_loader_syncing] = false
    end

    def storage_root
      DocumentStorageSyncLite.storage_root
    end

    def ensure_roots!
      FileUtils.mkdir_p(storage_root)
    end

    def sync_from_disk!
      seen_paths = []

      folder_docs = upsert_folders_from_disk!(seen_paths)
      upsert_files_from_disk!(folder_docs, seen_paths)
      purge_missing_from_database!(seen_paths)
    end

    def upsert_folders_from_disk!(seen_paths)
      folder_paths = Find.find(storage_root.to_s)
        .select { |path| File.directory?(path) }
        .map { |path| relative_disk_path(path) }
        .reject(&:blank?)
        .reject { |path| hidden_path?(path) }
        .sort_by { |path| [path.count("/"), path] }

      folders = {}
      folder_paths.each do |relative_path|
        parent_relative = File.dirname(relative_path)
        parent_relative = nil if parent_relative == "."
        parent = parent_relative.present? ? folders[parent_relative] : nil

        document = find_or_initialize_by_storage_path(relative_path, is_folder: true)
        document.assign_attributes(
          is_folder: true,
          parent: parent,
          title: File.basename(relative_path),
          content_type: "note",
          content: nil,
          tasks: [],
          reset_mode: "none",
          reset_days: [],
          last_reset_at: nil,
          storage_path: relative_path
        )
        document.save!

        folders[relative_path] = document
        seen_paths << relative_path
      end

      folders
    end

    def upsert_files_from_disk!(folder_docs, seen_paths)
      Find.find(storage_root.to_s) do |path|
        next unless File.file?(path)
        next unless supported_file_extension?(path)

        relative_path = relative_disk_path(path)
        next if hidden_path?(relative_path)

        parent_relative = File.dirname(relative_path)
        parent = if parent_relative == "."
          nil
        else
          folder_docs[parent_relative]
        end

        upsert_file_from_path!(path, relative_path, parent)
        seen_paths << relative_path
      end
    end

    def upsert_file_from_path!(absolute_file, relative_path, parent)
      parsed = parse_nexus_file(absolute_file)
      title = basename_without_supported_extension(absolute_file)
      document = find_or_initialize_by_storage_path(relative_path, is_folder: false)

      attributes = {
        is_folder: false,
        parent: parent,
        title: title,
        content_type: parsed[:content_type],
        content: parsed[:content],
        tasks: parsed[:tasks],
        reset_mode: parsed[:reset_mode],
        reset_days: parsed[:reset_days],
        last_reset_at: parsed[:last_reset_at],
        storage_path: relative_path
      }
      document.assign_attributes(attributes)

      document.created_at = parsed[:created_at] if parsed[:created_at].present? && document.new_record?
      document.updated_at = parsed[:updated_at] if parsed[:updated_at].present?

      document.save!
    end

    def purge_missing_from_database!(seen_paths)
      keep = seen_paths.uniq
      missing = Document.where.not(storage_path: keep).or(Document.where(storage_path: [nil, ""]))
      missing.find_each(&:destroy)
    end

    def find_or_initialize_by_storage_path(storage_path, is_folder:)
      document = Document.find_by(storage_path: storage_path)
      return document if document.present?

      Document.new
    end

    def relative_disk_path(path)
      Pathname.new(path).relative_path_from(storage_root).to_s
    end

    def hidden_path?(relative_path)
      relative_path.split("/").any? { |segment| segment.start_with?(".") }
    end

    def supported_file_extension?(path)
      path.end_with?(".nexus") || path.end_with?(".txt")
    end

    def basename_without_supported_extension(path)
      base = File.basename(path)
      return File.basename(base, ".nexus") if base.end_with?(".nexus")
      return File.basename(base, ".txt") if base.end_with?(".txt")

      base
    end

    def parse_nexus_file(path)
      text = File.read(path)
      lines = text.split("\n", -1)
      marker = lines.first.to_s.strip

      case marker
      when "# NEXUS_TASK_LIST"
        parse_task_list(lines)
      else
        parse_note(lines)
      end
    end

    def parse_note(lines)
      metadata, body = extract_metadata_and_body(lines)
      {
        content_type: "note",
        content: body,
        tasks: [],
        reset_mode: "none",
        reset_days: [],
        last_reset_at: nil,
        created_at: parse_time(metadata["created_at"]),
        updated_at: parse_time(metadata["updated_at"])
      }
    end

    def parse_task_list(lines)
      metadata, body = extract_metadata_and_body(lines)
      tasks = []
      current_main_task = nil
      new_group = true

      body.each_line do |line|
        if line.strip.empty?
          new_group = true
          next
        end

        main_match = line.match(/^\[(x| )\] (.*)$/i)
        subtask_match = line.match(/^\- \[(x| )\] (.*)$/i)

        if main_match
          current_main_task = {
            "text" => main_match[2].to_s,
            "checked" => main_match[1].downcase == "x",
            "subtasks" => []
          }
          tasks << current_main_task
          new_group = false
          next
        end

        next unless subtask_match

        entry = {
          "text" => subtask_match[2].to_s,
          "checked" => subtask_match[1].downcase == "x"
        }

        if current_main_task.nil? || new_group
          current_main_task = {
            "text" => entry["text"],
            "checked" => entry["checked"],
            "subtasks" => []
          }
          tasks << current_main_task
        else
          current_main_task["subtasks"] << entry
        end

        new_group = false
      end

      tasks.each do |task|
        subtasks = Array(task["subtasks"])
        next if subtasks.empty?

        task["checked"] = subtasks.all? { |subtask| subtask["checked"] }
      end

      {
        content_type: "task_list",
        content: nil,
        tasks: tasks,
        reset_mode: metadata["reset_mode"].to_s.presence || "none",
        reset_days: parse_reset_days(metadata["reset_days"]),
        last_reset_at: parse_time(metadata["last_reset_at"]),
        created_at: parse_time(metadata["created_at"]),
        updated_at: parse_time(metadata["updated_at"])
      }
    end

    def extract_metadata_and_body(lines)
      metadata = {}
      body_start = 0

      lines.each_with_index do |line, index|
        stripped = line.to_s.strip
        next if index.zero?

        if stripped.start_with?("# ")
          key, value = stripped.delete_prefix("# ").split(":", 2)
          metadata[key.to_s.strip] = value.to_s.strip
          next
        end

        if stripped.empty?
          body_start = index + 1
          break
        end

        body_start = index
        break
      end

      body = lines[body_start..]&.join("\n").to_s
      [metadata, body]
    end

    def parse_reset_days(raw)
      value = raw.to_s.strip
      return [] if value.blank?

      inner = value.sub(/\A\[/, "").sub(/\]\z/, "")
      inner.split(",").filter_map do |part|
        day = part.to_s.strip.to_i
        day if day.between?(0, 6)
      end.uniq.sort
    end

    def parse_time(raw)
      value = raw.to_s.strip
      return nil if value.blank? || value == "null"

      Time.zone.parse(value)
    rescue ArgumentError, TypeError
      nil
    end
  end
end
