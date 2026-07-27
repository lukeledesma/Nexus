# frozen_string_literal: true

# Workspace root folder for the logged-in user (username / email as title under parent_id nil).
# Used by Finder 2 and workspace provisioning.
class FinderListedFolders
  FINDER_ROOT_TITLE = "Storage"
  LEGACY_ROOT_TITLES = ["Finder", "Storage"].freeze

  def self.workspace_root_for(user)
    _user = user
    roots = Document.folders.where(parent_id: nil).order(:id).to_a
    finder_root =
      roots.find { |doc| doc.title.to_s.strip.casecmp?(FINDER_ROOT_TITLE) } ||
      roots.find { |doc| LEGACY_ROOT_TITLES.any? { |title| finder_title_match?(doc.title, title) } }
    if finder_root && !finder_root.title.to_s.strip.casecmp?(FINDER_ROOT_TITLE)
      finder_root.update!(title: FINDER_ROOT_TITLE)
      finder_root.reload
    end
    return normalize_workspace_root!(finder_root) if finder_root

    legacy_admin = roots.find { |doc| doc.title.to_s.strip.casecmp?("Admin") }
    return normalize_workspace_root!(promote_admin_finder_to_root!(legacy_admin)) if legacy_admin

    normalize_workspace_root!(Document.create!(is_folder: true, title: FINDER_ROOT_TITLE))
  end

  def self.promote_admin_finder_to_root!(legacy_admin)
    finder = legacy_admin.children.folders.find { |d| finder_title_match?(d.title, FINDER_ROOT_TITLE) }
    finder ||= legacy_admin.children.folders.find { |d| LEGACY_ROOT_TITLES.any? { |title| finder_title_match?(d.title, title) } }
    unless finder
      legacy_admin.update!(title: FINDER_ROOT_TITLE)
      return legacy_admin
    end

    finder.update!(parent_id: nil, title: FINDER_ROOT_TITLE)
    legacy_admin.destroy! if legacy_admin.children.reload.empty?
    finder
  end

  def self.finder_title_match?(value, title)
    normalized = value.to_s.strip
    target = title.to_s.strip
    /\A#{Regexp.escape(target)}(?:\s+\d+)?\z/i.match?(normalized)
  end

  def self.normalize_workspace_root!(root)
    return nil unless root

    normalize_workspace_root_storage_path!(root)
    root.reload
  end

  def self.normalize_workspace_root_storage_path!(root)
    legacy_relative = root.storage_path.to_s.strip
    return if legacy_relative.blank?

    storage_root = DocumentStorageSyncLite.storage_root
    legacy_path = storage_root.join(legacy_relative)

    if legacy_path.exist? && legacy_path != storage_root
      move_entries_to_root!(legacy_path, storage_root)
      FileUtils.rm_rf(legacy_path)
    end

    prefix = "#{legacy_relative}/"
    Document.transaction do
      root.update_column(:storage_path, "")

      root.children.find_each do |child|
        normalize_descendant_storage_paths!(child, prefix)
      end
    end
  end

  def self.normalize_descendant_storage_paths!(document, prefix)
    current_path = document.storage_path.to_s
    if current_path.start_with?(prefix)
      document.update_column(:storage_path, current_path.delete_prefix(prefix))
    end

    return unless document.folder?

    document.children.find_each do |child|
      normalize_descendant_storage_paths!(child, prefix)
    end
  end

  def self.move_entries_to_root!(source_dir, destination_dir)
    source_dir.each_child do |entry|
      target = destination_dir.join(entry.basename)
      if entry.directory? && !entry.symlink?
        if target.exist?
          raise "Cannot merge #{entry} into file #{target}" unless target.directory?

          move_entries_to_root!(entry, target)
          FileUtils.rm_rf(entry)
        else
          FileUtils.mv(entry, target)
        end
      elsif target.exist?
        if files_identical?(entry, target)
          FileUtils.rm_f(entry)
        else
          FileUtils.mv(entry, next_available_target_path(target))
        end
      else
        FileUtils.mv(entry, target)
      end
    end
  end

   def self.files_identical?(left, right)
     return false unless left.file? && right.file?
     return false unless left.size == right.size

     FileUtils.compare_file(left.to_s, right.to_s)
   end

   def self.next_available_target_path(target)
     directory = target.dirname
     basename = target.basename.to_s
     extension = File.extname(basename)
     stem = extension.present? ? File.basename(basename, extension) : basename
     suffix = 2

     loop do
       candidate = directory.join("#{stem} #{suffix}#{extension}")
       return candidate unless candidate.exist?

       suffix += 1
     end
   end
end
