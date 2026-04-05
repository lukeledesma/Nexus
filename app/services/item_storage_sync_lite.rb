# frozen_string_literal: true

require "fileutils"
require "tmpdir"

# Rebuilds storage/workspace from Folder + Item records.
# This keeps filesystem state aligned with the app's organizer model.
class ItemStorageSyncLite
  WORKSPACE_STATE_FILENAME = "WorkspaceState.txt".freeze
  LAYOUT_THEMES_FILENAME = "LayoutThemes.txt".freeze
  LEGACY_WINDOWS_FILENAME = "Windows.txt".freeze
  SYNC_MUTEX = Mutex.new

  class << self
    def storage_root
      Rails.root.join("storage", "workspace")
    end

    def sync_all!(username: nil)
      new(username: username).sync_all!
    end
  end

  def initialize(username: nil)
    @username = username.to_s.strip
  end

  def sync_all!
    SYNC_MUTEX.synchronize do
      perform_sync_all!
    end
  end

  private

  def scoped_storage_root
    candidate = @username.presence || default_workspace_username
    return self.class.storage_root.join("Embedded") if candidate.blank?

    self.class.storage_root.join(candidate, "Embedded")
  end

  def default_workspace_username
    @default_workspace_username ||= User.where.not(username: [nil, ""]).order(:id).pick(:username).to_s.strip.presence
  end

  def perform_sync_all!
    FileUtils.mkdir_p(scoped_storage_root)

    temp_root = Pathname.new(Dir.mktmpdir(".sync_tmp-", scoped_storage_root.to_s))

    # Write singular app files from the App folder at the root.
    app_folder = Folder.find_by(name: "App")
      if app_folder
        task_list = app_folder.items.find_by(item_type: "task_list")

        # Write TaskList (or empty placeholder if it doesn't exist)
        task_content = task_list ? item_contents(task_list) : empty_task_list_contents
        File.write(temp_root.join("Tasks.txt"), task_content)

        # Sticky Notes (or empty placeholder if it doesn't exist)
        stickies = app_folder.items.find_by(item_type: "stickynotes")
        stickies_content = stickies ? item_contents(stickies) : empty_stickynotes_contents
        File.write(temp_root.join("stickynotes.txt"), stickies_content)
      else
        # Create empty placeholders if App folder doesn't exist yet
        File.write(temp_root.join("Tasks.txt"), empty_task_list_contents)
        File.write(temp_root.join("stickynotes.txt"), empty_stickynotes_contents)
      end

    # Write user folders as subdirectories (without items inside them)
    used_folder_names = {}
    Folder.where.not(name: "App").includes(:items).ordered.find_each do |folder|
      folder_name = next_available_name(folder.name, used_folder_names)
      folder_path = temp_root.join(folder_name)
      FileUtils.mkdir_p(folder_path)
    end

    swap_storage(temp_root)
  ensure
    FileUtils.rm_rf(temp_root.to_s) if temp_root && temp_root.exist?
  end

  def swap_storage(temp_root)
    root = scoped_storage_root
    active_temp_dirname = File.basename(temp_root.to_s)

    # Preserve workspace config files across Notes/Tasks rebuilds.
    preserved_configs = {}
    [WORKSPACE_STATE_FILENAME, LAYOUT_THEMES_FILENAME, LEGACY_WINDOWS_FILENAME].each do |filename|
      path = root.join(filename)
      preserved_configs[filename] = File.read(path) if File.exist?(path)
    end

    Dir.children(root).each do |entry|
      next if [".sync_old", active_temp_dirname].include?(entry)
      next if [WORKSPACE_STATE_FILENAME, LAYOUT_THEMES_FILENAME, LEGACY_WINDOWS_FILENAME].include?(entry)

      FileUtils.rm_rf(root.join(entry))
    end

    Dir.children(temp_root).each do |entry|
      FileUtils.mv(temp_root.join(entry), root.join(entry))
    end

    preserved_configs.each do |filename, contents|
      File.write(root.join(filename), contents)
    end

    FileUtils.rm_rf(root.join(".sync_old"))
  end

  def next_available_name(raw, used, extension: "")
    base = sanitize_name(raw)
    candidate = "#{base}#{extension}"

    return register_name(candidate, used) unless used.key?(candidate.downcase)

    suffix = 2
    loop do
      numbered = "#{base} #{suffix}#{extension}"
      return register_name(numbered, used) unless used.key?(numbered.downcase)

      suffix += 1
    end
  end

  def register_name(name, used)
    used[name.downcase] = true
    name
  end

  def sanitize_name(raw)
    value = raw.to_s.strip
    value = "Untitled" if value.empty?
    value = value.gsub(/[\\\/:*?"<>|\u0000-\u001F]/, "-")
    value = value.gsub(/\s+/, " ").strip
    value = "Untitled" if value.empty?
    value
  end

  def item_contents(item)
    return task_list_contents(item) if item.item_type == "task_list"
    return stickynotes_contents(item) if item.item_type == "stickynotes"

    ""
  end

  def stickynotes_contents(item)
    [
      "# NEXUS_STICKY_NOTES",
      "# name: #{item.name}",
      "# item_id: #{item.id}",
      "# updated_at: #{iso8601_or_nil(item.updated_at)}",
      "",
      item.body.to_s
    ].join("\n")
  end

  def empty_stickynotes_contents
    [
      "# NEXUS_STICKY_NOTES",
      "# name: Sticky Notes",
      "# item_id: ",
      "# updated_at: null",
      "",
      "[]"
    ].join("\n")
  end

  def task_list_contents(item)
    task_groups = Array(item.tasks).filter_map do |task|
      if task.respond_to?(:to_h)
        value = task.to_h
        text = value["text"].to_s.strip
        next if text.empty?

        lines = [task_line(text, value["checked"], subtask: false)]

        Array(value["subtasks"]).each do |subtask|
          next unless subtask.respond_to?(:to_h)

          subtask_value = subtask.to_h
          subtask_text = subtask_value["text"].to_s.strip
          next if subtask_text.empty?

          lines << task_line(subtask_text, subtask_value["checked"], subtask: true)
        end

        lines
      else
        text = task.to_s.strip
        next if text.empty?

        [task_line(text, false, subtask: false)]
      end
    end

    task_lines = task_groups.flat_map.with_index do |group, index|
      index < task_groups.length - 1 ? (group + [""]) : group
    end

    [
      "# NEXUS_TASK_LIST",
      "# name: #{item.name}",
      "# item_id: #{item.id}",
      "# updated_at: #{iso8601_or_nil(item.updated_at)}",
      "",
      *task_lines
    ].join("\n")
  end

  def iso8601_or_nil(value)
    value&.iso8601 || "null"
  end

  def task_line(text, checked, subtask: false)
    marker = ActiveModel::Type::Boolean.new.cast(checked) ? "x" : " "
    prefix = subtask ? "- " : ""
    "#{prefix}[#{marker}] #{text}"
  end

  def empty_task_list_contents
    [
      "# NEXUS_TASK_LIST",
      "# name: Tasks",
      "# item_id: ",
      "# updated_at: null",
      ""
    ].join("\n")
  end
end
