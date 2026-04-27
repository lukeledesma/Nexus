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
    Document.delete_all
    User.where(id: @user&.id).delete_all
  end

  test "panel search returns filename matches before content matches" do
    notes_root = Apps::FinderController.workspace_section_root(@user, "notes")

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
    assert_equal [ file_name_match.id.to_s ], payload["name_matches"].map { |item| item["document_id"] }
    assert_equal [ content_match.id.to_s ], payload["content_matches"].map { |item| item["document_id"] }
  end

  test "panel search hides dotfield suffix from title matching" do
    notes_root = Apps::FinderController.workspace_section_root(@user, "notes")
    notes_root.children.create!(
      title: "test.dotfield",
      is_folder: false,
      content_type: "note",
      content: ""
    )

    get panel_search_documents_path, params: { q: "test" }
    assert_response :success
    payload = JSON.parse(response.body)
    assert_equal [ "test" ], payload["name_matches"].map { |item| item["document_title"] }

    get panel_search_documents_path, params: { q: "test.dotfield" }
    assert_response :success
    payload = JSON.parse(response.body)
    assert_empty payload["name_matches"]
    assert_empty payload["content_matches"]
  end
end
