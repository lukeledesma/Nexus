require "test_helper"
require "securerandom"

class DocumentsPanelSearchTest < ActionDispatch::IntegrationTest
  setup do
    suffix = SecureRandom.hex(4)
    @user = User.create!(
      email: "panel_search_#{suffix}@example.com",
      username: "panel_search_user_#{suffix}",
      password: "password123",
      password_confirmation: "password123"
    )

    post login_path, params: { identifier: @user.email, password: "password123" }
    FinderWorkspaceInitializer.ensure_for_user!(@user)
  end

  teardown do
    UserAppState.delete_all
    Document.delete_all
    User.where(id: @user&.id).delete_all
  end

  test "panel search returns a stable JSON payload shape" do
    notes_root = Apps::FinderController.workspace_section_root(@user, "quartz")

    file_name_match = notes_root.children.create!(
      title: "Sprint Plan",
      is_folder: false,
      content_type: "note",
      content: "weekly update"
    )

    content_match = notes_root.children.create!(
      title: "Retrospective",
      is_folder: false,
      content_type: "note",
      content: "contains sprint details"
    )

    get panel_search_documents_path, params: { q: "sprint" }

    assert_response :success
    payload = JSON.parse(response.body)

    assert_equal true, payload["ok"]
    assert payload.key?("name_matches")
    assert payload.key?("content_matches")
    assert payload["name_matches"].is_a?(Array)
    assert payload["content_matches"].is_a?(Array)
  end

  test "panel search handles dotfield queries without errors" do
    notes_root = Apps::FinderController.workspace_section_root(@user, "quartz")
    notes_root.children.create!(
      title: "test.dotfield",
      is_folder: false,
      content_type: "note",
      content: ""
    )

    get panel_search_documents_path, params: { q: "test" }
    assert_response :success
    payload = JSON.parse(response.body)
    assert payload["name_matches"].is_a?(Array)

    get panel_search_documents_path, params: { q: "test.dotfield" }
    assert_response :success
    payload = JSON.parse(response.body)
    assert payload["name_matches"].is_a?(Array)
    assert payload["content_matches"].is_a?(Array)
  end
end
