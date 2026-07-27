# frozen_string_literal: true

require "cgi"
require "fileutils"
require "find"
require "time"

# Thread-safe state management for synchronization
class ThreadSafeState
  @mutex = Mutex.new
  @syncing = false

  def self.syncing?
    @mutex.synchronize { @syncing }
  end

  def self.begin_sync!
    @mutex.synchronize { @syncing = true }
  end

  def self.end_sync!
    @mutex.synchronize { @syncing = false }
  end

  def syncing?
    self.class.syncing?
  end

  def begin_sync!
    self.class.begin_sync!
  end

  def end_sync!
    self.class.end_sync!
  end
end

class DocumentDiskLoader
  TEXT_FILE_EXTENSIONS = %w[.nexus .txt .md .rtf].freeze
  IGNORED_ROOT_SEGMENTS = %w[workspace workspace_test storage_test].freeze
  LEGACY_UNIFIED_NOTE_MESSAGES = {
    "stickynotes" => "<p><em>This file used a retired Sticky Notes format; content is preserved below.</em></p>",
    "kanban" => "<p><em>This file was a board format that is no longer supported; imported as a note.</em></p>",
    "thought_wall" => "<p><em>This file was a board format that is no longer supported; imported as a note.</em></p>"
  }.freeze

  # Class: DocumentDiskLoader
  # Description: Handles synchronization of documents and folders between the database and the file system.
  # Methods:
  # - sync!: Orchestrates the synchronization process, ensuring roots and syncing from disk.
  # - syncing?: Checks if a sync operation is currently in progress.
  # - begin_sync!: Marks the start of a sync operation.
  # - end_sync!: Marks the end of a sync operation.
  # - storage_root: Returns the root directory for document storage.
  # - ensure_roots!: Ensures the existence of storage root directories.
  # - sync_from_disk!: Synchronizes folders and files from the disk to the database.
  class << self
    def sync!(purge_missing: true)
      return if syncing?

      log_sync_start

      begin_sync!
      ensure_roots!
      sync_from_disk!(purge_missing: purge_missing)
    ensure
      end_sync!
      log_sync_end
    end

    def syncing?
      ThreadSafeState.new.syncing?
    end

    private

    def begin_sync!
      ThreadSafeState.new.begin_sync!
    end

    def end_sync!
      ThreadSafeState.new.end_sync!
    end

    def storage_root
      DocumentStorageSyncLite.storage_root
    end

    def ensure_roots!
      FileUtils.mkdir_p(storage_root)
    end

    def sync_from_disk!(purge_missing:)
      storage_root_document = FinderListedFolders.workspace_root_for(nil)
      seen_paths = []
      folder_paths, file_entries, existing_documents_by_storage_path = collect_disk_sync_inputs

      folder_docs = upsert_folders_from_disk!(
        seen_paths,
        folder_paths,
        existing_documents_by_storage_path,
        storage_root_document
      )
      upsert_files_from_disk!(
        seen_paths,
        folder_docs,
        file_entries,
        existing_documents_by_storage_path,
        storage_root_document
      )
      purge_missing_from_database!(seen_paths) if purge_missing
    end

    def collect_disk_sync_inputs
      folder_paths = disk_folder_paths
      file_entries = disk_file_entries
      known_paths = folder_paths + file_entries.map { |entry| entry[:relative_path] }
      existing_documents_by_storage_path = preload_documents_by_storage_path(known_paths)
      [folder_paths, file_entries, existing_documents_by_storage_path]
    end

    def upsert_folders_from_disk!(seen_paths, folder_paths, existing_documents_by_storage_path, storage_root_document)
      folders = {}
      folder_paths.each do |relative_path|
       parent = parent_document_for_relative_path(
         relative_path,
         folder_docs: folders,
         storage_root_document: storage_root_document
       )

       document = find_or_initialize_by_storage_path(
         relative_path,
         is_folder: true,
         existing_documents_by_storage_path: existing_documents_by_storage_path
       )
       assign_folder_attributes!(document, parent: parent, relative_path: relative_path)
       document.save!

       folders[relative_path] = document
       seen_paths << relative_path
      end

      folders
    end

    def upsert_files_from_disk!(seen_paths, folder_docs, file_entries, existing_documents_by_storage_path, storage_root_document)
      file_entries.each do |entry|
        absolute_path = entry[:absolute_path]
        relative_path = entry[:relative_path]
        parent = parent_document_for_relative_path(
          relative_path,
          folder_docs: folder_docs,
          storage_root_document: storage_root_document
        )

        upsert_file_from_path!(absolute_path, relative_path, parent, existing_documents_by_storage_path)
        seen_paths << relative_path
      end
    end

    def upsert_file_from_path!(absolute_file, relative_path, parent, existing_documents_by_storage_path)
      # A file can be removed between disk scan and parse in concurrent test/runtime scenarios.
      # Skip quietly and let the next sync reconcile state.
      return unless File.file?(absolute_file)

      parsed = disk_asset_file?(absolute_file) ? asset_file_attributes : parse_nexus_file(absolute_file)
      title = basename_without_supported_extension(absolute_file)
      document = find_or_initialize_by_storage_path(
        relative_path,
        is_folder: false,
        existing_documents_by_storage_path: existing_documents_by_storage_path
      )
      assign_file_attributes!(
        document,
        parent: parent,
        title: title,
        parsed: parsed,
        relative_path: relative_path
      )

      document.created_at = parsed[:created_at] if parsed[:created_at].present? && document.new_record?
      document.updated_at = parsed[:updated_at] if parsed[:updated_at].present?

      document.save!
    rescue Errno::ENOENT
      nil
    end

    def assign_folder_attributes!(document, parent:, relative_path:)
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
    end

    def assign_file_attributes!(document, parent:, title:, parsed:, relative_path:)
      document.assign_attributes(
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
      )
    end

    def parent_document_for_relative_path(relative_path, folder_docs:, storage_root_document:)
      parent_relative = File.dirname(relative_path)
      return storage_root_document if parent_relative == "."

      folder_docs[parent_relative]
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
      purge_missing_file_rows!(keep_paths: keep, root: root)
      purge_missing_folder_rows!(keep_paths: keep, root: root)
    end

    def protected_embedded_draft?(doc)
      EmbeddedDraftDocument.draft_document?(doc)
    end

    def find_or_initialize_by_storage_path(storage_path, is_folder:, existing_documents_by_storage_path: nil)
      document = existing_documents_by_storage_path&.[](storage_path)
      return document if document.present?

      document = Document.new
      existing_documents_by_storage_path[storage_path] = document if existing_documents_by_storage_path
      document
    end

    def disk_folder_paths
      Find.find(storage_root.to_s)
        .select { |path| File.directory?(path) }
        .map { |path| relative_disk_path(path) }
        .reject(&:blank?)
        .reject { |path| hidden_path?(path) }
        .reject { |path| ignored_root_path?(path) }
        .sort_by { |path| [ path.count("/"), path ] }
    end

    def disk_file_entries
      entries = []

      each_supported_visible_disk_file do |absolute_path, relative_path|
        entries << { absolute_path: absolute_path, relative_path: relative_path }
      end

      entries
    end

    def preload_documents_by_storage_path(paths)
      return {} if paths.blank?

      Document.where(storage_path: paths.uniq).index_by(&:storage_path)
    end

    def relative_disk_path(path)
      Pathname.new(path).relative_path_from(storage_root).to_s
    end

    def hidden_path?(relative_path)
      relative_path.split("/").any? { |segment| segment.start_with?(".") }
    end

    def supported_file_extension?(path)
      ext = File.extname(path.to_s).downcase
      return true if text_file_extension?(ext)
      return true if Document::ASSET_FILE_EXTENSIONS.include?(ext)
      return xml_file_supported_for_sync?(path) if ext == ".xml"

      false
    end

    def basename_without_supported_extension(path)
      base = File.basename(path)
      ext = File.extname(base)
      ext_down = ext.downcase
      return File.basename(base, ext) if Document::ASSET_FILE_EXTENSIONS.include?(ext_down)
      stripped = strip_supported_text_extension(base)
      return stripped unless stripped == base
      return File.basename(base, ".xml") if base.end_with?(".xml")

      base
    end

    def xml_file_supported_for_sync?(path)
      return false unless File.file?(path)

      lines = File.readlines(path, encoding: "utf-8", mode: "r")
      return false if lines.empty?
      return false unless lines.first.to_s.strip == NexusFileFormat::FIRST_LINE

      metadata, = extract_unified_metadata_and_body(lines)
      metadata["kind"].to_s == NexusFileFormat::KIND_ALCHEMY
    rescue Errno::ENOENT, ArgumentError, TypeError
      false
    end

    def text_file_extension?(ext)
      TEXT_FILE_EXTENSIONS.include?(ext.to_s.downcase)
    end

    def strip_supported_text_extension(basename)
      value = basename.to_s
      return File.basename(value, ".nexus") if value.end_with?(".nexus")
      return File.basename(value, ".txt") if value.end_with?(".txt")
      return File.basename(value, ".md") if value.end_with?(".md")
      return File.basename(value, ".rtf") if value.end_with?(".rtf")

      value
    end

    def disk_asset_file?(path)
      Document::ASSET_FILE_EXTENSIONS.include?(File.extname(path.to_s).downcase)
    end

    def each_supported_visible_disk_file
      Find.find(storage_root.to_s) do |path|
        next unless File.file?(path)
        next unless supported_file_extension?(path)

        relative_path = relative_disk_path(path)
        next if hidden_path?(relative_path)
        next if ignored_root_path?(relative_path)

        yield(path, relative_path)
      end
    end

    def purge_missing_file_rows!(keep_paths:, root:)
      Document.where(is_folder: false).where.not(storage_path: [ nil, "" ]).find_each do |doc|
        next if protected_embedded_draft?(doc)
        if ignored_root_path?(doc.storage_path)
          doc.destroy
          next
        end
        next unless storage_path_missing_from_sync_and_disk?(doc.storage_path, keep_paths: keep_paths, root: root)

        doc.destroy
      end
    end

    def purge_missing_folder_rows!(keep_paths:, root:)
      # Empty folders only: no children left to cascade-delete.
      Document.where(is_folder: true).where.not(storage_path: [ nil, "" ]).find_each do |doc|
        if ignored_root_path?(doc.storage_path)
          next if doc.children.exists?

          doc.destroy
          next
        end
        next unless storage_path_missing_from_sync_and_disk?(doc.storage_path, keep_paths: keep_paths, root: root)
        next if doc.children.exists?

        doc.destroy
      end
    end

    def ignored_root_path?(relative_path)
      first = relative_path.to_s.split("/").first.to_s.strip.downcase
      IGNORED_ROOT_SEGMENTS.include?(first)
    end

    def storage_path_missing_from_sync_and_disk?(storage_path, keep_paths:, root:)
      rel = storage_path.to_s
      return false if keep_paths.include?(rel)

      abs = root.join(rel)
      !abs.exist?
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

      parse_non_rtf_text_file(text)
    end

    def parse_non_rtf_text_file(text)
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
      when NexusFileFormat::KIND_ALCHEMY
        parse_alchemy_from_unified(metadata, body)
      when "quartz"
        parse_quartz_from_unified(metadata, lines)
      else
        parse_legacy_unified_kind_as_note(kind, metadata, body) || parse_note(lines)
      end
    end

    def extract_unified_metadata_and_body(lines)
      extract_metadata_and_body_from_lines(lines, skip_first_line: true)
    end

    def parse_note_from_unified(metadata, body)
      standard_document_attributes(content_type: "note", content: body, metadata: metadata)
    end

    def parse_quartz_from_unified(metadata, lines)
      standard_document_attributes(content_type: "note", content: lines.join("\n"), metadata: metadata)
    end

    def parse_alchemy_from_unified(metadata, body)
      standard_document_attributes(content_type: "alchemy_tag_list", content: body, metadata: metadata)
    end

    def parse_note_rtf_file(text)
      standard_document_attributes(content_type: "note", content: NoteRtfConverter.rtf_to_html(text))
    end

    def parse_note(lines)
      metadata, body = extract_metadata_and_body(lines)
      standard_document_attributes(content_type: "note", content: body, metadata: metadata)
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
      extract_metadata_and_body_from_lines(lines, skip_first_line: false)
    end

    def extract_metadata_and_body_from_lines(lines, skip_first_line:)
      metadata = {}
      body_start = skip_first_line ? lines.length : 0

      lines.each_with_index do |line, index|
        stripped = line.to_s.strip

        if skip_first_line && index.zero?
          next if stripped == NexusFileFormat::FIRST_LINE

          break
        end
        next if !skip_first_line && index.zero?

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

    def standard_document_attributes(content_type:, content:, metadata: nil)
      {
        content_type: content_type,
        content: content,
        tasks: [],
        reset_mode: "none",
        reset_days: [],
        last_reset_at: nil,
        created_at: parse_time(metadata&.[]("created_at")),
        updated_at: parse_time(metadata&.[]("updated_at"))
      }
    end

    def parse_legacy_unified_kind_as_note(kind, metadata, body)
      message = LEGACY_UNIFIED_NOTE_MESSAGES[kind.to_s]
      return nil unless message

      content = if kind.to_s == "stickynotes"
        "#{message}<pre>#{CGI.escapeHTML(body.to_s.byteslice(0, 50_000))}</pre>"
      else
        message
      end
      parse_note_from_unified(metadata, content)
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

    def log_sync_start
      Rails.logger.info("Starting document disk sync...")
    end

    def log_sync_end
      Rails.logger.info("Document disk sync completed.")
    end
  end
end
