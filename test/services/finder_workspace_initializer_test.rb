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
    Document.delete_all
    User.where(id: @user&.id).delete_all
  end

  test "ensure_for_user is idempotent and keeps one folder per section" do
    FinderWorkspaceInitializer.ensure_for_user!(@user)
    FinderWorkspaceInitializer.ensure_for_user!(@user)

    root = FinderListedFolders.workspace_root_for(@user)
    finder = root.children.folders.find { |d| d.title.to_s.casecmp?("Finder") }

    assert finder
    assert_equal 1, root.children.folders.select { |d| d.title.to_s.casecmp?("Finder") }.size

    section_titles = Apps::FinderController.workspace_section_definitions
      .reject { |definition| definition[:key] == "favorites" }
      .map { |definition| definition[:title] }

    section_titles.each do |title|
      matching = finder.children.folders.select { |folder| folder.title.to_s.casecmp?(title) }
      assert_equal 1, matching.size, "expected one section folder named #{title}"
    end

    roots = FinderWorkspaceInitializer.section_roots_for(@user)
    assert_equal Apps::FinderController::TASKS_SECTION_TITLE, roots["documents"]&.title
    assert_equal Apps::FinderController::NOTES_SECTION_TITLE, roots["notes"]&.title
    assert_nil roots["favorites"]
  end

  test "migrates legacy documents notes and favorites layout" do
    FinderWorkspaceInitializer.ensure_for_user!(@user)

    root = FinderListedFolders.workspace_root_for(@user)
    finder = root.children.folders.find { |d| d.title.to_s.casecmp?("Finder") }
    tasks = finder.children.folders.find { |d| d.title.to_s.casecmp?(Apps::FinderController::TASKS_SECTION_TITLE) }
    notes = finder.children.folders.find { |d| d.title.to_s.casecmp?(Apps::FinderController::NOTES_SECTION_TITLE) }

    tasks.update!(title: "Documents")
    notes.update!(parent: tasks)

    legacy_favorites = finder.children.create!(is_folder: true, title: Apps::FinderController::FAVORITES_SECTION_TITLE)
    favorite_file = legacy_favorites.children.create!(
      is_folder: false,
      title: "Favorite Candidate",
      content_type: "note",
      content: "<p>Favorite</p>"
    )

    roots = FinderWorkspaceInitializer.ensure_for_user!(@user)

    assert roots["documents"]
    assert_equal Apps::FinderController::TASKS_SECTION_TITLE, roots["documents"].title
    assert roots["notes"]
    assert_equal finder.id, roots["notes"].parent_id

    assert_not Document.exists?(legacy_favorites.id)
    assert_equal roots["documents"].id, favorite_file.reload.parent_id
    assert_equal true, favorite_file.is_favorited?
  end
end
