# frozen_string_literal: true

require "set"

class FinderWorkspaceInitializer
  LEGACY_DOCUMENTS_SECTION_TITLE = "Documents"
  LEGACY_FINDER_WORKSPACE_FOLDER_TITLE = "Finder"

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

    roots = ensure_section_roots!(finder_root)
    migrate_legacy_notes_folder_from_tasks!(roots["documents"], roots["notes"])
    migrate_legacy_favorites_folder!(finder_root, roots["documents"])

    roots
  rescue ActiveRecord::RecordNotUnique, ActiveRecord::RecordInvalid
    section_roots
  end

  def section_roots
    root = root_folder
    return {} unless root

    finder_root = root.children.folders.find { |d| d.title.to_s.strip.casecmp?(LEGACY_FINDER_WORKSPACE_FOLDER_TITLE) }
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

  def ensure_finder_container!
    root = root_folder
    return nil unless root

    finder_root = root.children.folders.find { |d| d.title.to_s.strip.casecmp?(LEGACY_FINDER_WORKSPACE_FOLDER_TITLE) }
    finder_root ||= root.children.create!(is_folder: true, title: LEGACY_FINDER_WORKSPACE_FOLDER_TITLE)

    section_titles = Apps::FinderController.workspace_section_definitions
      .reject { |definition| definition[:key] == "favorites" }
      .map { |definition| definition[:title] } + [LEGACY_DOCUMENTS_SECTION_TITLE]

    root.children.folders.each do |folder|
      next if folder.id == finder_root.id
      title = folder.title.to_s.strip
      next if title.casecmp?("Embedded")
      next unless section_titles.any? { |candidate| title.casecmp?(candidate) }

      folder.update!(parent: finder_root)
    end

    finder_root
  end

  # Upgraded: runtime migration logic was moved from Finder controller into an explicit initializer.
  def migrate_documents_section_to_tasks!(finder_root)
    documents_folder = finder_root.children.folders.find { |d| d.title.to_s.strip.casecmp?(LEGACY_DOCUMENTS_SECTION_TITLE) }
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

  def migrate_legacy_notes_folder_from_tasks!(tasks_root, notes_root)
    return unless tasks_root&.folder? && notes_root&.folder?

    legacy_notes = tasks_root.children.folders.find { |d| d.title.to_s.strip.casecmp?(Apps::FinderController::NOTES_SECTION_TITLE) }
    return unless legacy_notes

    Document.transaction do
      legacy_notes.children.find_each { |child| child.update!(parent: notes_root) }
      legacy_notes.destroy!
    end
  end

  def migrate_legacy_favorites_folder!(finder_root, tasks_root)
    return unless finder_root&.folder?

    legacy_favorites = finder_root.children.folders.find { |d| d.title.to_s.strip.casecmp?(Apps::FinderController::FAVORITES_SECTION_TITLE) }
    return unless legacy_favorites

    Document.transaction do
      mark_files_favorited_in_subtree!(legacy_favorites)

      target_parent = tasks_root&.folder? ? tasks_root : finder_root
      legacy_favorites.children.find_each { |child| child.update!(parent: target_parent) }
      legacy_favorites.destroy!
    end
  end

  def mark_files_favorited_in_subtree!(root)
    stack = [root]
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
