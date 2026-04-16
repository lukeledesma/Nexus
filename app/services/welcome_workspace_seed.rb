# frozen_string_literal: true

# Ensures each user has Finder/Welcome/Welcome with onboarding text once.
class WelcomeWorkspaceSeed
  FOLDER_TITLE = "Welcome"
  DOC_TITLE = "Welcome"

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

    finder_root = Apps::FinderController.workspace_finder_root_folder(@user)
    return unless finder_root

    welcome_folder = finder_root.children.folders.where("LOWER(title) = ?", FOLDER_TITLE.downcase).first
    welcome_folder ||= finder_root.children.create!(is_folder: true, title: FOLDER_TITLE)

    same_title = welcome_folder.children.files.where("LOWER(title) = ?", DOC_TITLE.downcase).to_a
    return if same_title.any? { |f| f.content_type.to_s == "note" }

    legacy_task = same_title.find { |f| f.content_type.to_s == "task_list" }
    if legacy_task
      legacy_task.update!(
        content_type: "note",
        content: default_welcome_note_html,
        tasks: [],
        reset_mode: "none",
        reset_days: [],
        last_reset_at: nil
      )
      return
    end

    return if same_title.any?

    welcome_folder.children.create!(
      is_folder: false,
      title: DOC_TITLE,
      content_type: "note",
      content: default_welcome_note_html,
      tasks: [],
      reset_mode: "none",
      reset_days: []
    )
  end

  private

  def default_welcome_note_html
    <<~HTML.strip
      <p><strong>Welcome to Nexus</strong></p>
      <p>Your workspace for task lists and notes, kept in folders so everything stays easy to find.</p>
      <p><strong>Get started</strong></p>
      <ul>
        <li>Open Finder from the side panel, then use + in the title bar to create folders under your workspace Finder folder.</li>
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
