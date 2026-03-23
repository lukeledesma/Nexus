# frozen_string_literal: true

require "fileutils"

# Rebuilds storage/item_lists from Folder + Item records.
# This keeps filesystem state aligned with the app's organizer model.
class ItemStorageSyncLite
  class << self
    def storage_root
      Rails.root.join("storage", "item_lists")
    end

    def sync_all!
      new.sync_all!
    end
  end

  def sync_all!
    FileUtils.mkdir_p(self.class.storage_root)

    temp_root = self.class.storage_root.join(".sync_tmp")
    FileUtils.rm_rf(temp_root)
    FileUtils.mkdir_p(temp_root)

    used_folder_names = {}

    Folder.includes(:items).ordered.find_each do |folder|
      folder_name = next_available_name(folder.name, used_folder_names)
      folder_path = temp_root.join(folder_name)
      FileUtils.mkdir_p(folder_path)

      used_item_names = {}
      folder.items.ordered.each do |item|
        filename = next_available_name(item.name, used_item_names, extension: ".nexus")
        File.write(folder_path.join(filename), item_contents(item))
      end
    end

    swap_storage(temp_root)
  ensure
    FileUtils.rm_rf(temp_root) if temp_root.exist?
  end

  private

  def swap_storage(temp_root)
    root = self.class.storage_root
    backup = root.join(".sync_old")

    Dir.children(root).each do |entry|
      next if [".sync_tmp", ".sync_old"].include?(entry)

      FileUtils.rm_rf(root.join(entry))
    end

    Dir.children(temp_root).each do |entry|
      FileUtils.mv(temp_root.join(entry), root.join(entry))
    end

    FileUtils.rm_rf(backup)
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

    [
      "# NEXUS_NOTE",
      "# name: #{item.name}",
      "# folder: #{item.folder.name}",
      "# item_id: #{item.id}",
      "# updated_at: #{iso8601_or_nil(item.updated_at)}",
      "",
      item.body.to_s
    ].join("\n")
  end

  def task_list_contents(item)
    task_lines = Array(item.tasks).filter_map do |task|
      if task.is_a?(Hash)
        text = task["text"].to_s
        checked = ActiveModel::Type::Boolean.new.cast(task["checked"])
        "- [#{checked ? "x" : " "}] #{text}"
      else
        "- [ ] #{task.to_s}"
      end
    end

    [
      "# NEXUS_TASK_LIST",
      "# name: #{item.name}",
      "# folder: #{item.folder.name}",
      "# item_id: #{item.id}",
      "# updated_at: #{iso8601_or_nil(item.updated_at)}",
      "",
      *task_lines
    ].join("\n")
  end

  def iso8601_or_nil(value)
    value&.iso8601 || "null"
  end
end
