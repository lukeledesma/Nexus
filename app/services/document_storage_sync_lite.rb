# frozen_string_literal: true

require "fileutils"

class DocumentStorageSyncLite
  class << self
    def storage_root
      env_override = ENV["NEXUS_STORAGE_ROOT"].to_s.strip
      return Pathname.new(env_override) unless env_override.empty?

      root_name = Rails.env.test? ? "workspace_test" : "workspace"
      Rails.root.join("storage", root_name)
    end

    def next_available_filename(base_path, title, extension: ".txt", exclude_path: nil)
      base_name = normalize_name(title, fallback: "Untitled Item")
      candidate = "#{base_name}#{extension}"
      return candidate unless path_taken?(base_path.join(candidate), exclude_path)

      suffix = 2
      loop do
        numbered = "#{base_name} #{suffix}#{extension}"
        return numbered unless path_taken?(base_path.join(numbered), exclude_path)

        suffix += 1
      end
    end

    def next_available_directory_name(base_path, title, exclude_path: nil)
      base_name = normalize_name(title, fallback: "Untitled Folder")
      return base_name unless path_taken?(base_path.join(base_name), exclude_path)

      suffix = 2
      loop do
        numbered = "#{base_name} #{suffix}"
        return numbered unless path_taken?(base_path.join(numbered), exclude_path)

        suffix += 1
      end
    end

    private

    def normalize_name(value, fallback:)
      normalized = value.to_s.strip
      normalized.present? ? normalized : fallback
    end

    def path_taken?(candidate_path, exclude_path)
      return false unless candidate_path.exist?
      return true if exclude_path.blank?

      candidate_path.to_s != Pathname.new(exclude_path).to_s
    end
  end

  def initialize(document)
    @document = document
  end

  def create
    return unless syncable_persisted_record?

    ensure_storage_roots!

    if @document.folder?
      create_folder
    else
      create_file
    end
  end

  def update
    return unless syncable_persisted_record?

    ensure_storage_roots!

    if @document.folder?
      sync_folder_update
    else
      sync_item_update
    end
  end

  def destroy
    return unless @document.id.present? && @document.storage_path.present?

    absolute_path = absolute_path_for(@document.storage_path)

    if @document.folder?
      FileUtils.rm_rf(absolute_path)
    else
      FileUtils.rm_f(absolute_path)
    end
  end

  private

  def syncable_persisted_record?
    @document.id.present? && @document.persisted?
  end

  def ensure_storage_roots!
    FileUtils.mkdir_p(self.class.storage_root)
  end

  def create_folder
    parent_relative = folder_parent_relative_path
    base_path = absolute_path_for(parent_relative)
    FileUtils.mkdir_p(base_path)

    target_name = File.basename(@document.storage_path.to_s) if @document.storage_path.present?
    target_name = self.class.next_available_directory_name(base_path, @document.title) if target_name.blank?

    target_relative = parent_relative == "." ? target_name : File.join(parent_relative, target_name)
    target_path = absolute_path_for(target_relative)
    FileUtils.mkdir_p(target_path)
    persist_storage_path(target_relative)
    persist_title_from_basename(target_name)
  end

  def create_file
    parent_relative = parent_relative_path
    parent_path = absolute_path_for(parent_relative)
    FileUtils.mkdir_p(parent_path)

    filename = self.class.next_available_filename(parent_path, @document.title, extension: disk_extension_for_file)
    target_relative = File.join(parent_relative, filename)
    target_path = absolute_path_for(target_relative)

    File.binwrite(target_path, item_file_contents)
    persist_storage_path(target_relative)
    persist_title_from_basename(strip_supported_extension(filename))
  end

  def sync_folder_update
    old_relative = @document.previous_changes.dig("storage_path", 0).to_s.presence || @document.storage_path.to_s
    old_path = absolute_path_for(old_relative)
    parent_relative = folder_parent_relative_path
    base_path = absolute_path_for(parent_relative)
    FileUtils.mkdir_p(base_path)

    target_name = self.class.next_available_directory_name(base_path, @document.title, exclude_path: old_path)
    target_relative = parent_relative == "." ? target_name : File.join(parent_relative, target_name)
    target_path = absolute_path_for(target_relative)

    if old_path.exist? && old_path != target_path
      FileUtils.mv(old_path, target_path)
    else
      FileUtils.mkdir_p(target_path)
    end

    if old_relative != target_relative
      persist_storage_path(target_relative)
      update_child_storage_paths_for_folder_rename(old_relative, target_relative)
    end

    persist_title_from_basename(target_name)
  end

  def sync_item_update
    previous_relative = @document.previous_changes.dig("storage_path", 0).to_s.presence || @document.storage_path.to_s
    previous_path = absolute_path_for(previous_relative)

    parent_relative = parent_relative_path
    parent_path = absolute_path_for(parent_relative)
    FileUtils.mkdir_p(parent_path)

    target_filename = self.class.next_available_filename(
      parent_path,
      @document.title,
      extension: disk_extension_for_file,
      exclude_path: previous_path
    )
    target_relative = File.join(parent_relative, target_filename)
    target_path = absolute_path_for(target_relative)

    if previous_path.exist? && previous_path != target_path
      FileUtils.mv(previous_path, target_path)
    end

    File.binwrite(target_path, item_file_contents)
    persist_storage_path(target_relative) if previous_relative != target_relative
    persist_title_from_basename(strip_supported_extension(target_filename))
  end

  def update_child_storage_paths_for_folder_rename(old_relative, new_relative)
    old_prefix = "#{old_relative}/"
    new_prefix = "#{new_relative}/"

    @document.children.find_each do |child|
      next if child.storage_path.blank?
      next unless child.storage_path.start_with?(old_prefix)

      child.update_column(:storage_path, child.storage_path.sub(old_prefix, new_prefix))
    end
  end

  def parent_relative_path
    return "" if @document.parent.blank?

    @document.parent.storage_path.to_s.presence || ""
  end

  def folder_parent_relative_path
    return "." if @document.parent.blank?

    @document.parent.storage_path.to_s.presence || "."
  end

  def absolute_path_for(relative_path)
    self.class.storage_root.join(relative_path)
  end

  def persist_storage_path(relative_path)
    return if @document.storage_path == relative_path

    @document.update_column(:storage_path, relative_path)
    @document.storage_path = relative_path
  end

  def persist_title_from_basename(value)
    normalized = value.to_s
    return if normalized.blank? || @document.title == normalized

    @document.update_column(:title, normalized)
    @document.title = normalized
  end

  def strip_supported_extension(filename)
    value = filename.to_s
    base = File.basename(value)
    ext = File.extname(base)
    return File.basename(base, ext) if Document::ASSET_FILE_EXTENSIONS.include?(ext.downcase)
    return File.basename(value, ".txt") if value.end_with?(".txt")
    return File.basename(value, ".rtf") if value.end_with?(".rtf")
    return File.basename(value, ".nexus") if value.end_with?(".nexus")

    value
  end

  def disk_extension_for_file
    case @document.content_type.to_s
    when "note"
      ".rtf"
    when "asset"
      ext = File.extname(@document.storage_path.to_s).downcase
      return ext if Document::ASSET_FILE_EXTENSIONS.include?(ext)

      pending = @document.pending_disk_extension.to_s.downcase
      return pending if pending.present? && Document::ASSET_FILE_EXTENSIONS.include?(pending)

      ".bin"
    else
      ".txt"
    end
  end

  def item_file_contents
    case @document.content_type.to_s
    when "task_list"
      unified_task_list_contents
    when "note"
      note_rtf_file_body
    when "asset"
      asset_file_body
    else
      unified_note_contents
    end
  end

  def asset_file_body
    pending = @document.pending_asset_bytes
    if pending
      @document.pending_asset_bytes = nil
      return pending.to_s.b
    end

    rel = @document.storage_path.to_s
    return "".b if rel.blank?

    path = absolute_path_for(rel)
    return "".b unless path.file?

    File.binread(path)
  end

  # Legacy plain-text + NEXUS header (only if a non-note type ever used note body format).
  def unified_note_contents
    header = NexusFileFormat.unified_header_lines(
      kind: NexusFileFormat::KIND_NOTE,
      title: @document.title,
      document_id: @document.id,
      created_at: @document.created_at,
      updated_at: @document.updated_at
    )
    (header + [@document.content.to_s]).join("\n")
  end

  def note_rtf_file_body
    NoteRtfConverter.html_to_rtf(@document.content.to_s)
  end

  def unified_task_list_contents
    extra = {
      "reset_mode" => @document.reset_mode.to_s,
      "reset_days" => "[#{Array(@document.reset_days).map(&:to_i).join(",")}]",
      "last_reset_at" => iso8601_or_nil(@document.last_reset_at)
    }
    header = NexusFileFormat.unified_header_lines(
      kind: NexusFileFormat::KIND_TASK_LIST,
      title: @document.title,
      document_id: @document.id,
      created_at: @document.created_at,
      updated_at: @document.updated_at,
      extra: extra
    )

    task_groups = Array(@document.tasks).map do |task|
      value = task.respond_to?(:to_h) ? task.to_h : {}
      text = value["text"].to_s.strip
      next if text.empty?

      lines = [task_list_line(text, value["checked"], subtask: false)]

      Array(value["subtasks"]).each do |subtask|
        subtask_value = subtask.respond_to?(:to_h) ? subtask.to_h : {}
        subtask_text = subtask_value["text"].to_s.strip
        next if subtask_text.empty?

        lines << task_list_line(subtask_text, subtask_value["checked"], subtask: true)
      end

      lines
    end.compact

    task_lines = task_groups.flat_map.with_index do |group, index|
      index < task_groups.length - 1 ? (group + [""]) : group
    end

    (header + task_lines).join("\n")
  end

  def iso8601_or_nil(value)
    value&.iso8601 || "null"
  end

  def task_list_line(text, checked, subtask: false)
    marker = ActiveModel::Type::Boolean.new.cast(checked) ? "x" : " "
    prefix = subtask ? "- " : ""
    "#{prefix}[#{marker}] #{text}"
  end
end