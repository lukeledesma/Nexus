require "test_helper"
require "securerandom"

class FinderWorkspaceInitializerTest < ActiveSupport::TestCase
  setup do
    @user = User.create!(
      email: "finder_initializer_test_#{SecureRandom.hex(4)}@example.com",
      password: "password123",
      password_confirmation: "password123"
    )
  end

  teardown do
    UserAppState.delete_all
    Document.delete_all
    User.where(id: @user&.id).delete_all
  end

  test "ensure_for_user is idempotent and keeps one folder per section" do
    FinderWorkspaceInitializer.ensure_for_user!(@user)
    FinderWorkspaceInitializer.ensure_for_user!(@user)

    root = FinderListedFolders.workspace_root_for(@user)
    assert root
    assert_match(/\AStorage(?:\s+\d+)?\z/i, root.title)
    assert_equal "", root.storage_path.to_s

    roots = FinderWorkspaceInitializer.section_roots_for(@user)
    assert_equal root.id, roots["storage"]&.parent_id
    assert_match(/\AStorage(?:\s+\d+)?\z/i, roots["storage"]&.title.to_s)
    assert_equal roots["storage"]&.id, roots["documents"]&.id
    assert_equal roots["storage"]&.id, roots["desktop"]&.id
    assert_nil roots["favorites"]
  end

  test "migrates legacy sections into standard roots" do
    FinderWorkspaceInitializer.ensure_for_user!(@user)

    root = FinderListedFolders.workspace_root_for(@user)
    tasks = root.children.create!(is_folder: true, title: Apps::FinderController::TASKS_SECTION_TITLE)
    nested_pictures = tasks.children.create!(is_folder: true, title: Apps::FinderController::PICTURES_SECTION_TITLE)
    legacy_quartz = root.children.create!(is_folder: true, title: Apps::FinderController::QUARTZ_SECTION_TITLE)
    quartz_note = legacy_quartz.children.create!(is_folder: false, title: "Daily Note", content_type: "note", content: "<p>Hello</p>")

    legacy_favorites = root.children.create!(is_folder: true, title: Apps::FinderController::FAVORITES_SECTION_TITLE)
    favorite_file = legacy_favorites.children.create!(
      is_folder: false,
      title: "Favorite Candidate",
      content_type: "note",
      content: "<p>Favorite</p>"
    )

    roots = FinderWorkspaceInitializer.ensure_for_user!(@user)

    assert_equal root.id, roots["storage"]&.parent_id
    assert_equal roots["storage"]&.id, nested_pictures.reload.parent_id

    assert_not Document.exists?(legacy_favorites.id)
    assert_equal roots["storage"]&.id, favorite_file.reload.parent_id
    assert_equal true, favorite_file.is_favorited?
    assert_equal roots["storage"]&.id, legacy_quartz.reload.parent_id
    assert_equal legacy_quartz.id, quartz_note.reload.parent_id
    assert_not Document.exists?(tasks.id)
  end

  test "ensure_for_user handles missing root folder gracefully" do
    # Temporarily override workspace_root_for to return nil without relying on Minitest stub.
    original = FinderListedFolders.method(:workspace_root_for)
    FinderListedFolders.define_singleton_method(:workspace_root_for) { |_user| nil }
    begin
      result = FinderWorkspaceInitializer.ensure_for_user!(@user)
      assert_equal({}, result, "Expected empty result when root folder is missing")
    ensure
      FinderListedFolders.define_singleton_method(:workspace_root_for, original)
    end
  end

  test "ensure_for_user creates finder root and section folders" do
    FinderWorkspaceInitializer.ensure_for_user!(@user)

    root = FinderListedFolders.workspace_root_for(@user)
    assert root, "Finder root folder should exist"
    assert_match(/\AStorage(?:\s+\d+)?\z/i, root.title)
    assert_equal "", root.storage_path.to_s
    assert FinderWorkspaceInitializer.section_roots_for(@user)["trash"]
  end

  test "ensure_for_user migrates legacy nested storage root to disk root" do
    FinderWorkspaceInitializer.ensure_for_user!(@user)

    root = FinderListedFolders.workspace_root_for(@user)
    note = root.children.create!(is_folder: false, title: "Legacy Root Note", content_type: "note", content: "hello")
    legacy_root = DocumentStorageSyncLite.storage_root.join("Storage")
    migrated_path = DocumentStorageSyncLite.storage_root.join("Storage", "Legacy Root Note.rtf")

    FileUtils.mkdir_p(legacy_root)
    FileUtils.mv(DocumentStorageSyncLite.storage_root.join(note.storage_path), legacy_root.join("Legacy Root Note.txt"))
    root.update_column(:storage_path, "Storage")
    note.update_column(:storage_path, "Storage/Legacy Root Note.txt")

    FinderWorkspaceInitializer.ensure_for_user!(@user)

    assert_equal "", root.reload.storage_path.to_s
    assert_equal "Storage/Legacy Root Note.rtf", note.reload.storage_path
    assert_equal FinderWorkspaceInitializer.section_roots_for(@user)["storage"]&.id, note.reload.parent_id
    assert migrated_path.file?
    assert legacy_root.directory?
  end
end
