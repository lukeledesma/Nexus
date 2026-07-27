require "test_helper"
require "securerandom"

class DraftsLifecycleTest < ActionDispatch::IntegrationTest
  setup do
    suffix = SecureRandom.hex(4)
    @user = User.create!(
      email: "drafts_lifecycle_#{suffix}@example.com",
      username: "drafts_user_#{suffix}",
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

  test "draft_file returns stable id across repeated requests" do
    get "/apps/tasks/draft_file", params: { app_key: "tasks" }, as: :json
    assert_response :success
    first = response.parsed_body

    get "/apps/tasks/draft_file", params: { app_key: "tasks" }, as: :json
    assert_response :success
    second = response.parsed_body

    assert_equal first.fetch("document_id"), second.fetch("document_id")
    assert_equal "task_list", first.fetch("content_type")
  end

  test "save-as-new clears draft without changing draft identity" do
    get "/apps/tasks/draft_file", params: { app_key: "tasks" }, as: :json
    assert_response :success
    draft_id = response.parsed_body.fetch("document_id")

    draft_doc = Document.find(draft_id)
    draft_doc.update!(tasks: [ { "text" => "draft task", "checked" => false, "subtasks" => [] } ])

    folder = Apps::FinderController.workspace_section_root(@user, "documents")
    assert folder

    payload = [ { text: "saved task", checked: false, subtasks: [] } ].to_json
    post "/apps/tasks/save_file", params: {
      folder_id: folder.id,
      frame_id: "tasks-pane",
      filename: "Saved Task List",
      document_id: draft_id,
      task_payload: payload
    }, as: :json

    assert_response :success
    body = response.parsed_body
    assert body.fetch("cleared_embedded_draft")
    saved_doc_id = body.fetch("document_id")
    assert_not_equal draft_id, saved_doc_id

    get "/apps/tasks/draft_file", params: { app_key: "tasks" }, as: :json
    assert_response :success
    refreshed_id = response.parsed_body.fetch("document_id")
    assert_equal draft_id, refreshed_id

    refreshed = Document.find(refreshed_id)
    assert_equal [], refreshed.tasks
  end

  test "draft_file rejects unsupported app key" do
    get "/apps/tasks/draft_file", params: { app_key: "unsupported" }, as: :json

    assert_response :unprocessable_entity
    assert_match(/unsupported draft app/i, response.parsed_body.fetch("error"))
  end
end
