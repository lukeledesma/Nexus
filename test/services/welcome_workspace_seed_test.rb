require "test_helper"
require "securerandom"

class WelcomeWorkspaceSeedTest < ActiveSupport::TestCase
  setup do
    suffix = SecureRandom.hex(4)
    @user = User.create!(
      email: "welcome_seed_#{suffix}@example.com",
      username: "welcome_seed_#{suffix}",
      password: "password123",
      password_confirmation: "password123"
    )
  end

  teardown do
    UserAppState.delete_all
    Document.delete_all
    User.where(id: @user&.id).delete_all
  end

  test "does not recreate welcome after the initial seed is deleted" do
    FinderWorkspaceInitializer.ensure_for_user!(@user)

    documents_root = Apps::FinderController.workspace_section_root(@user, "documents")
    welcome_folder = documents_root.children.folders.find { |folder| /\AWelcome(?:\s+\d+)?\z/i.match?(folder.title.to_s) }
    assert welcome_folder

    welcome_folder.destroy!
    WelcomeWorkspaceSeed.ensure_for_user!(@user)

    assert_empty documents_root.children.folders.select { |folder| /\AWelcome(?:\s+\d+)?\z/i.match?(folder.title.to_s) }
  end

  test "consolidates duplicate generated welcome folders" do
    FinderWorkspaceInitializer.ensure_for_user!(@user)

    documents_root = Apps::FinderController.workspace_section_root(@user, "documents")
    duplicate = documents_root.children.create!(is_folder: true, title: "Welcome 2")
    duplicate.children.create!(
      is_folder: false,
      title: WelcomeWorkspaceSeed::DOC_TITLE,
      content_type: "note",
      content: WelcomeWorkspaceSeed.new(@user).send(:default_welcome_note_html)
    )

    WelcomeWorkspaceSeed.ensure_for_user!(@user)

    folders = documents_root.children.folders.select { |folder| /\AWelcome(?:\s+\d+)?\z/i.match?(folder.title.to_s) }
    assert_equal 1, folders.size

    welcome_folder = folders.first
    notes = welcome_folder.children.files.where(title: WelcomeWorkspaceSeed::DOC_TITLE)
    assert_equal 1, notes.count
  end
end
