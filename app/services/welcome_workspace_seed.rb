# frozen_string_literal: true

# Ensures each user has Documents/Welcome/Welcome with onboarding text once.
class WelcomeWorkspaceSeed
  FOLDER_TITLE = "Welcome"
  DOC_TITLE = "Welcome"
  STATE_KEY = "finder.welcome_seeded"

  class << self
    def ensure_for_user!(user)
      new(user).ensure!
    end
  end

  def initialize(user)
    @user = user
  end

  def ensure!
    return unless @user

    documents_root = Apps::FinderController.workspace_section_root(@user, "documents")
    return unless documents_root

    welcome_folder = consolidate_welcome_folders!(documents_root)
    return if welcome_folder.blank? && seeded?

    welcome_folder ||= documents_root.children.create!(welcome_folder_attributes)
    note = ensure_single_welcome_note!(welcome_folder, allow_create: !seeded?)
    mark_seeded! if note.present?
  end

  private

  def seeded?
    UserAppState.exists?(user: @user, key: STATE_KEY)
  end

  def mark_seeded!
    UserAppState.put(user: @user, key: STATE_KEY, value: true)
  end

  def consolidate_welcome_folders!(documents_root)
    adopt_legacy_welcome_folders!(documents_root)
    folders = welcome_folders_for(documents_root)
    canonical = folders.find { |folder| folder.title.to_s.strip.casecmp?(FOLDER_TITLE) } || folders.min_by(&:id)
    return nil unless canonical

    folders.each do |folder|
      next if folder.id == canonical.id

      merge_welcome_folder!(source: folder, target: canonical)
    end

    canonical.update!(title: FOLDER_TITLE) unless canonical.title.to_s.strip.casecmp?(FOLDER_TITLE)
    canonical.reload
  end

  def welcome_folders_for(documents_root)
    documents_root.children.folders.select do |folder|
      folder_title_match?(folder.title, FOLDER_TITLE)
    end
  end

  def adopt_legacy_welcome_folders!(documents_root)
    Document.folders.where(parent_id: nil).order(:id).each do |folder|
      next if folder.id == documents_root.id
      next unless folder_title_match?(folder.title, FOLDER_TITLE)
      next unless folder.storage_path.to_s.present?
      next unless folder.storage_path.to_s.split("/").length == 1

      folder.update!(parent: documents_root)
    end
  rescue ActiveRecord::RecordInvalid
    nil
  end

  def merge_welcome_folder!(source:, target:)
    source.children.find_each do |child|
      if onboarding_welcome_note?(child) && welcome_note_for(target).present?
        child.destroy!
      else
        child.update!(parent: target)
      end
    end

    source.destroy!
  end

  def ensure_single_welcome_note!(welcome_folder, allow_create:)
    same_title = welcome_files_for(welcome_folder)
    note = same_title.find { |file| file.content_type.to_s == "note" }
    legacy_task = same_title.find { |file| file.content_type.to_s == "task_list" }

    if note.present?
      note.update!(title: DOC_TITLE) unless note.title.to_s.strip.casecmp?(DOC_TITLE)
      same_title.each do |file|
        next if file.id == note.id
        next unless onboarding_welcome_note?(file)

        file.destroy!
      end
      return note
    end

    if legacy_task.present?
      legacy_task.update!(
        content_type: "note",
        content: default_welcome_note_html,
        tasks: [],
        reset_mode: "none",
        reset_days: [],
        last_reset_at: nil
      )
      return legacy_task
    end

    return nil unless allow_create
    return nil if same_title.any?

    welcome_folder.children.create!(welcome_note_attributes(welcome_folder))
  end

  def welcome_note_for(welcome_folder)
    welcome_files_for(welcome_folder).find do |file|
      file.content_type.to_s == "note"
    end
  end

  def onboarding_welcome_note?(document)
    return false unless document&.file?
    return false unless document.title.to_s.strip.casecmp?(DOC_TITLE)
    return false unless document.content_type.to_s == "note"

    document.content.to_s.strip == default_welcome_note_html
  end

  def folder_title_match?(value, title)
    normalized = value.to_s.strip
    target = title.to_s.strip
    /\A#{Regexp.escape(target)}(?:\s+\d+)?\z/i.match?(normalized)
  end

  def welcome_folder_attributes
    attrs = { is_folder: true, title: FOLDER_TITLE }
    welcome_path = DocumentStorageSyncLite.storage_root.join(FOLDER_TITLE)
    attrs[:storage_path] = FOLDER_TITLE if welcome_path.directory?
    attrs
  end

  def welcome_files_for(welcome_folder)
    welcome_folder.children.files.order(:id).select do |file|
      folder_title_match?(file.title, DOC_TITLE)
    end
  end

  def welcome_note_attributes(welcome_folder)
    attrs = {
      is_folder: false,
      title: DOC_TITLE,
      content_type: "note",
      content: default_welcome_note_html,
      tasks: [],
      reset_mode: "none",
      reset_days: []
    }
    storage_path = preferred_welcome_note_storage_path(welcome_folder)
    attrs[:storage_path] = storage_path if storage_path.present?
    attrs
  end

  def preferred_welcome_note_storage_path(welcome_folder)
    folder_relative = welcome_folder.storage_path.to_s
    return nil if folder_relative.blank?

    [".rtf", ".txt"].each do |extension|
      relative_path = File.join(folder_relative, "#{DOC_TITLE}#{extension}")
      absolute_path = DocumentStorageSyncLite.storage_root.join(relative_path)
      return relative_path if absolute_path.file?
    end

    nil
  end

  def default_welcome_note_html
    <<~HTML.strip
      <p><strong>Welcome to Nexus</strong></p>
      <p>Your workspace for task lists and notes, kept in folders so everything stays easy to find.</p>
      <p><strong>Get started</strong></p>
      <ul>
        <li>Open Finder from the side panel, then browse the Storage folder.</li>
        <li>Open Tasks from the side panel. Use Save to Finder when you want a copy on disk.</li>
        <li>Open Settings anytime to adjust your account and how Nexus looks.</li>
      </ul>
      <p><strong>Quick tips</strong></p>
      <ul>
        <li>Use the side panel to switch between apps.</li>
        <li>Rename or delete items with the small icons beside each row in Finder.</li>
      </ul>
    HTML
  end
end
