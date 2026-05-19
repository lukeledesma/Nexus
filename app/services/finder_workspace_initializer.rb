# frozen_string_literal: true

require "set"

class FinderWorkspaceInitializer
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
    return {} unless root_folder

    finder_root = ensure_finder_container!
    return {} unless finder_root

    migrate_documents_section_to_tasks!(finder_root)
    migrate_recently_deleted_to_trash!(finder_root)
    ensure_trash_root!(finder_root)

    roots = ensure_section_roots!(finder_root)
    migrate_legacy_favorites!(finder_root, roots["documents"])

    roots
  rescue ActiveRecord::RecordNotUnique, ActiveRecord::RecordInvalid
    section_roots
  end

  def section_roots
    root = root_folder
    return {} unless root

    finder_root = root.children.folders.find { |d| d.title.to_s.strip.casecmp?("Finder") }
    return {} unless finder_root

    Apps::FinderController.workspace_section_definitions.each_with_object({}) do |definition, out|
      if definition[:key] == "favorites"
        out[definition[:key]] = nil
        next
      end

      folder = finder_root.children.folders.find { |d| d.title.to_s.strip.casecmp?(definition[:title]) }
      out[definition[:key]] = folder if folder
    end
  end

  private

  def root_folder
    FinderListedFolders.workspace_root_for(@user)
  end

  def ensure_finder_container!
    root = root_folder
    return nil unless root

    finder_root = root.children.folders.find { |d| d.title.to_s.strip.casecmp?("Finder") }
    finder_root ||= root.children.create!(is_folder: true, title: "Finder")

    finder_root
  end

  def ensure_section_roots!(finder_root)
    Apps::FinderController.workspace_section_definitions.each_with_object({}) do |definition, out|
      if definition[:key] == "favorites"
        out[definition[:key]] = nil
        next
      end

      title = definition[:title]
      existing = finder_root.children.folders.find { |d| d.title.to_s.strip.casecmp?(title) }
      out[definition[:key]] = existing || finder_root.children.create!(is_folder: true, title: title)
    end
  end

  def ensure_trash_root!(finder_root)
    title = Apps::FinderController::TRASH_SECTION_TITLE
    finder_root.children.folders.find { |d| d.title.to_s.strip.casecmp?(title) } ||
      finder_root.children.create!(is_folder: true, title: title)
  end

  def migrate_recently_deleted_to_trash!(finder_root)
    legacy = finder_root.children.folders.find { |d| d.title.to_s.strip.casecmp?("Recently Deleted") }
    return unless legacy
    return if finder_root.children.folders.any? { |d| d.title.to_s.strip.casecmp?(Apps::FinderController::TRASH_SECTION_TITLE) }

    legacy.update!(title: Apps::FinderController::TRASH_SECTION_TITLE)
  rescue StandardError => e
    Rails.logger.warn("[FinderWorkspaceInitializer] Could not migrate Recently Deleted to Trash: #{e.message}")
  end

  def migrate_legacy_favorites!(finder_root, tasks_root)
    favorites = finder_root.children.folders.find { |d| d.title.to_s.strip.casecmp?(Apps::FinderController::FAVORITES_SECTION_TITLE) }
    return unless favorites && tasks_root

    Document.transaction do
      favorites.children.where(is_folder: false).find_each do |child|
        child.update!(parent: tasks_root, is_favorited: true)
      end
      favorites.destroy!
    end
  end

  def migrate_documents_section_to_tasks!(finder_root)
    documents_folder = finder_root.children.folders.find { |d| d.title.to_s.strip.casecmp?("Documents") }
    return unless documents_folder

    tasks_folder = finder_root.children.folders.find { |d| d.title.to_s.strip.casecmp?(Apps::FinderController::TASKS_SECTION_TITLE) }
    return if tasks_folder && tasks_folder.id == documents_folder.id

    if tasks_folder
      Document.transaction do
        documents_folder.children.find_each { |child| child.update!(parent: tasks_folder) }
        documents_folder.destroy!
      end
      return
    end

    documents_folder.update!(title: Apps::FinderController::TASKS_SECTION_TITLE)
  end

  def mark_files_favorited_in_subtree!(root)
    stack = [ root ]
    visited = Set.new

    until stack.empty?
      node = stack.pop
      next unless node
      next if visited.include?(node.id)

      visited.add(node.id)
      node.children.find_each do |child|
        if child.folder?
          stack << child
        else
          child.update!(is_favorited: true)
        end
      end
    end
  end
end
