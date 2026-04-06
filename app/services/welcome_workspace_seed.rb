# frozen_string_literal: true

# Ensures each user has Finder/Welcome/Welcome (note) with onboarding HTML once.
# Does not overwrite an existing welcome note (users may edit freely).
class WelcomeWorkspaceSeed
  FOLDER_TITLE = "Welcome"
  NOTE_TITLE = "Welcome"

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

    finder = FinderListedFolders.finder_folder_for(@user)
    return unless finder

    welcome_folder = finder.children.folders.where("LOWER(title) = ?", FOLDER_TITLE.downcase).first
    welcome_folder ||= finder.children.create!(is_folder: true, title: FOLDER_TITLE)
    note = welcome_note(welcome_folder)

    if note
      refresh_malformed_legacy_content!(note)
      return
    end

    welcome_folder.children.create!(
      is_folder: false,
      title: NOTE_TITLE,
      content_type: "note",
      content: default_welcome_html
    )
  end

  private

  def welcome_note(welcome_folder)
    welcome_folder.children.files.where(content_type: "note").where("LOWER(title) = ?", NOTE_TITLE.downcase).first
  end

  def refresh_malformed_legacy_content!(note)
    body = note.content.to_s
    return unless body.include?("&#39;3f") || body.include?("•3f")

    note.update!(content: default_welcome_html)
  end

  def default_welcome_html
    <<~HTML.squish
      <h1>Welcome to Nexus</h1>
      <p>Your workspace for notes, task lists, and sticky notes - kept in folders so everything stays easy to find.</p>
      <h2>Get started</h2>
      <p>- Create your first folder with the <strong>+</strong> button in the Finder window toolbar.</p>
      <p>- Open Notepad, Tasks, or Sticky Notes from the dock or Launcher, then use <strong>Save</strong> to put files inside a folder.</p>
      <p>- Open <strong>Settings</strong> anytime to adjust your account and how Nexus looks.</p>
      <h2>Quick tips</h2>
      <p>- Use the Launcher (grid icon on the dock) to switch between apps.</p>
      <p>- Rename or delete items with the small icons beside each row in the Finder.</p>
    HTML
  end
end
