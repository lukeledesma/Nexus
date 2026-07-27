# frozen_string_literal: true

class FinderWorkspaceInitializer
  LEGACY_FLATTENED_ROOT_TITLES = [
    Apps::FinderController::DESKTOP_SECTION_TITLE,
    Apps::FinderController::DOCUMENTS_SECTION_TITLE,
    Apps::FinderController::PICTURES_SECTION_TITLE,
    Apps::FinderController::MUSIC_SECTION_TITLE,
    Apps::FinderController::TASKS_SECTION_TITLE
  ].freeze
  IGNORED_GENERATED_TITLES = %w[workspace workspace_test storage_test].freeze

  def self.ensure_for_user!(user)
    new(user).ensure_for_user!
  end

  def self.section_roots_for(user)
    new(user).section_roots
  end

  def initialize(user)
    @user = user
  end

  def ensure_for_user!
    root = root_folder
    return {} unless root

    content_root = ensure_content_root!(root)
    migrate_recently_deleted_to_trash!(root)
    move_primary_children_into_content_root!(root, content_root)
    flatten_legacy_section_roots!(content_root)
    purge_ignored_generated_entries!(content_root)
    trash_root = ensure_trash_root!(root)
    consolidate_trash_roots!(root, trash_root)
    migrate_legacy_favorites!(content_root)
    WelcomeWorkspaceSeed.ensure_for_user!(@user) if @user

    base_roots = {
      "storage" => content_root,
      "favorites" => nil,
      "trash" => trash_root
    }
    base_roots.merge(legacy_alias_roots(content_root))
  rescue ActiveRecord::RecordNotUnique, ActiveRecord::RecordInvalid
    section_roots
  end

  def section_roots
    root = root_folder
    return {} unless root
    content_root = content_root_for(root) || root

    base_roots = {
      "storage" => content_root,
      "favorites" => nil,
      "trash" => pick_matching_folder(root.children.folders.to_a, Apps::FinderController::TRASH_SECTION_TITLE)
    }
    base_roots.merge(legacy_alias_roots(content_root))
  end

  private

  def root_folder
    FinderListedFolders.workspace_root_for(@user)
  end

  def ensure_trash_root!(root)
    trash = pick_matching_folder(root.children.folders.to_a, Apps::FinderController::TRASH_SECTION_TITLE)
    trash ||= root.children.create!(trash_folder_attributes)
    Apps::FinderController.ensure_folder_storage_path!(root, trash)
    trash
  end

  def ensure_content_root!(root)
    content_root = content_root_for(root)
    return content_root if content_root

    content_root = root.children.create!(content_root_attributes)
    Apps::FinderController.ensure_folder_storage_path!(root, content_root)
    content_root
  end

  def migrate_recently_deleted_to_trash!(root)
    legacy = pick_matching_folder(root.children.folders.to_a, "Recently Deleted")
    return unless legacy

    trash = pick_matching_folder(root.children.folders.to_a, Apps::FinderController::TRASH_SECTION_TITLE)
    if trash && trash.id != legacy.id
      merge_children_and_destroy!(legacy, trash)
    else
      legacy.update!(title: Apps::FinderController::TRASH_SECTION_TITLE)
    end
  rescue StandardError => e
    Rails.logger.warn("[FinderWorkspaceInitializer] Could not migrate Recently Deleted to Trash: #{e.message}")
  end

  def flatten_legacy_section_roots!(content_root)
    LEGACY_FLATTENED_ROOT_TITLES.each do |title|
      source = pick_matching_folder(content_root.children.folders.to_a, title)
      next unless source

      Document.transaction do
        source.children.find_each do |child|
          child.update!(parent: content_root)
        end
        source.destroy!
      end
    end
  end

  def move_primary_children_into_content_root!(root, content_root)
    root.children.order(:id).find_each do |child|
      next if child.id == content_root.id
      next if special_root_sibling?(child)

      child.update!(parent: content_root)
    end
  end

  def migrate_legacy_favorites!(content_root)
    favorites = pick_matching_folder(content_root.children.folders.to_a, Apps::FinderController::FAVORITES_SECTION_TITLE)
    return unless favorites

    Document.transaction do
      favorites.children.where(is_folder: false).find_each do |child|
        child.update!(parent: content_root, is_favorited: true)
      end
      favorites.destroy!
    end
  end

  def purge_ignored_generated_entries!(content_root)
    return unless content_root

    content_root.children.find_each do |child|
      next unless ignored_generated_title?(child.title)

      child.destroy!
    end
  end

  def consolidate_trash_roots!(root, canonical_trash)
    return unless root && canonical_trash

    root.children.folders.find_each do |folder|
      next if folder.id == canonical_trash.id
      next unless workspace_title_match?(folder.title, Apps::FinderController::TRASH_SECTION_TITLE)

      merge_children_and_destroy!(folder, canonical_trash)
    end
  end

  def merge_children_and_destroy!(source, target)
    Document.transaction do
      source.children.find_each { |child| child.update!(parent: target) }
      source.destroy!
    end
  end

  def legacy_alias_roots(root)
    {
      "desktop" => root,
      "documents" => root,
      "pictures" => root,
      "music" => root,
      "tasks" => root,
      "quartz" => root,
      "images" => root,
      "audio" => root,
      "alchemy" => root
    }
  end

  def content_root_for(root)
    pick_matching_folder(root.children.folders.to_a, Apps::FinderController::STORAGE_SECTION_TITLE)
  end

  def workspace_title_match?(value, title)
    normalized = value.to_s.strip
    target = title.to_s.strip
    /\A#{Regexp.escape(target)}(?:\s+\d+)?\z/i.match?(normalized)
  end

  def pick_matching_folder(folders, title)
    matches = Array(folders).select { |folder| workspace_title_match?(folder.title, title) }
    return nil if matches.empty?

    matches.min_by do |folder|
      normalized = folder.title.to_s.strip
      exact = normalized.casecmp?(title.to_s.strip) ? 0 : 1
      suffix = normalized[/\s+(\d+)\z/, 1].to_i
      [exact, suffix, folder.id]
    end
  end

  def special_root_sibling?(document)
    return false unless document&.folder?

    title = document.title.to_s.strip
    return true if workspace_title_match?(title, Apps::FinderController::TRASH_SECTION_TITLE)
    return true if title.casecmp?("Embedded")

    false
  end

  def content_root_attributes
    attrs = { is_folder: true, title: Apps::FinderController::STORAGE_SECTION_TITLE }
    storage_path = Apps::FinderController::STORAGE_SECTION_TITLE
    attrs[:storage_path] = storage_path if DocumentStorageSyncLite.storage_root.join(storage_path).directory?
    attrs
  end

  def ignored_generated_title?(value)
    normalized = value.to_s.strip.downcase
    IGNORED_GENERATED_TITLES.any? { |base| /\A#{Regexp.escape(base)}(?:\s+\d+)?\z/.match?(normalized) }
  end

  def trash_folder_attributes
    attrs = { is_folder: true, title: Apps::FinderController::TRASH_SECTION_TITLE }
    trash_path = DocumentStorageSyncLite.storage_root.join(Apps::FinderController::TRASH_SECTION_TITLE)
    attrs[:storage_path] = Apps::FinderController::TRASH_SECTION_TITLE if trash_path.directory?
    attrs
  end
end
