# frozen_string_literal: true

require "cgi"
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
      parsed = disk_asset_file?(absolute_file) ? asset_file_attributes : parse_nexus_file(absolute_file)
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
      root = storage_root

      # Files: only remove rows whose path is gone from disk. Rows missing from `keep` but still
      # present on disk are kept (indexing gaps / races).
      #
      # Folders must NOT be destroyed in the same loop as arbitrary "missing path" checks:
      # `Document` uses `dependent: :destroy` on children, so destroying one folder row wipes every
      # nested document and runs `sync_destroy_on_disk` on each file — deleting real bytes on disk.
      # A folder path can be "wrong" (rename drift Embedded/Image vs IImage) while child file paths
      # are still valid; one refresh then deleted everything under both DB and disk.
      Document.where(is_folder: false).where.not(storage_path: [nil, ""]).find_each do |doc|
        # Embedded drafts are virtual saved documents and may not have a synced
        # on-disk file at all times. Never purge them from DB on path-missing checks,
        # otherwise their IDs rotate and window dedupe by document_id breaks.
        next if protected_embedded_draft?(doc)

        rel = doc.storage_path.to_s
        next if keep.include?(rel)

        abs = root.join(rel)
        next if abs.exist?

        doc.destroy
      end

      # Empty folders only: no children left to cascade-delete.
      Document.where(is_folder: true).where.not(storage_path: [nil, ""]).find_each do |doc|
        rel = doc.storage_path.to_s
        next if keep.include?(rel)

        abs = root.join(rel)
        next if abs.exist?
        next if doc.children.exists?

        doc.destroy
      end
    end

    def protected_embedded_draft?(doc)
      return false unless doc&.file?

      draft_titles = ["Task Draft", "Note Draft", "Time Card Draft"]
      return false unless draft_titles.include?(doc.title.to_s)

      parent_title = doc.parent&.title.to_s
      return true if parent_title.casecmp?("Embedded")

      rel = doc.storage_path.to_s
      rel.start_with?("Admin/Embedded/") || rel.start_with?("Embedded/")
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
      ext = File.extname(path.to_s).downcase
      path.end_with?(".nexus") || path.end_with?(".txt") || path.end_with?(".md") || path.end_with?(".rtf") ||
        Document::ASSET_FILE_EXTENSIONS.include?(ext)
    end

    def basename_without_supported_extension(path)
      base = File.basename(path)
      ext = File.extname(base)
      ext_down = ext.downcase
      return File.basename(base, ext) if Document::ASSET_FILE_EXTENSIONS.include?(ext_down)
      return File.basename(base, ".nexus") if base.end_with?(".nexus")
      return File.basename(base, ".txt") if base.end_with?(".txt")
      return File.basename(base, ".md") if base.end_with?(".md")
      return File.basename(base, ".rtf") if base.end_with?(".rtf")

      base
    end

    def disk_asset_file?(path)
      Document::ASSET_FILE_EXTENSIONS.include?(File.extname(path.to_s).downcase)
    end

    def asset_file_attributes
      {
        content_type: "asset",
        content: nil,
        tasks: [],
        reset_mode: "none",
        reset_days: [],
        last_reset_at: nil,
        created_at: nil,
        updated_at: nil
      }
    end

    def parse_nexus_file(path)
      text = File.read(path)
      return parse_note_rtf_file(text) if path.to_s.end_with?(".rtf")

      lines = text.split("\n", -1)
      marker = lines.first.to_s.strip

      if marker == NexusFileFormat::FIRST_LINE
        parse_unified_file(lines)
      elsif marker == "# NEXUS_TASK_LIST"
        parse_task_list(lines)
      else
        parse_note(lines)
      end
    end

    def parse_unified_file(lines)
      metadata, body = extract_unified_metadata_and_body(lines)
      kind = metadata["kind"].to_s

      case kind
      when NexusFileFormat::KIND_NOTE
        parse_note_from_unified(metadata, body)
      when NexusFileFormat::KIND_TASK_LIST
        build_task_list_attributes(metadata, body)
      when "stickynotes"
        parse_note_from_unified(
          metadata,
          "<p><em>This file used a retired Sticky Notes format; content is preserved below.</em></p><pre>#{CGI.escapeHTML(body.to_s.byteslice(0, 50_000))}</pre>"
        )
      when "kanban", "thought_wall"
        parse_note_from_unified(
          metadata,
          "<p><em>This file was a board format that is no longer supported; imported as a note.</em></p>"
        )
      else
        parse_note(lines)
      end
    end

    def extract_unified_metadata_and_body(lines)
      metadata = {}
      body_start = lines.length

      lines.each_with_index do |line, index|
        stripped = line.to_s.strip
        if index.zero?
          next if stripped == NexusFileFormat::FIRST_LINE

          break
        end

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

    def parse_note_from_unified(metadata, body)
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

    def parse_note_rtf_file(text)
      {
        content_type: "note",
        content: NoteRtfConverter.rtf_to_html(text),
        tasks: [],
        reset_mode: "none",
        reset_days: [],
        last_reset_at: nil,
        created_at: nil,
        updated_at: nil
      }
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
      build_task_list_attributes(metadata, body)
    end

    def build_task_list_attributes(metadata, body)
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
