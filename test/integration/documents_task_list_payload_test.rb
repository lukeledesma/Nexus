# frozen_string_literal: true

require "test_helper"
require "securerandom"

class DocumentsTaskListPayloadTest < ActionDispatch::IntegrationTest
  setup do
    suffix = SecureRandom.hex(4)
    @workspace_title = "task_payload_workspace_#{suffix}"

    @user = User.create!(
      email: "task_payload_strip_#{suffix}@example.com",
      username: "task_payload_strip_#{suffix}",
      password: "password123",
      password_confirmation: "password123"
    )
    post login_path, params: { identifier: @user.email, password: "password123" }

    @folder = Document.create!(
      is_folder: true,
      title: @workspace_title,
      storage_path: @workspace_title
    )
    @doc = Document.create!(
      is_folder: false,
      parent: @folder,
      title: "List",
      content_type: "task_list",
      tasks: [ { "text" => "One", "checked" => false, "subtasks" => [] } ],
      storage_path: "#{@workspace_title}/List.dotfield"
    )
  end

  teardown do
    Document.delete_all
    User.where(id: @user&.id).delete_all
  end

  test "drops trailing blank main tasks from tasks_payload on update" do
    payload = [
      { "text" => "One", "checked" => false, "subtasks" => [] },
      { "text" => "", "checked" => false, "subtasks" => [] },
      { "text" => "", "checked" => false, "subtasks" => [] }
    ].to_json

    patch document_path(@doc),
      params: {
        document: {
          title: @doc.title,
          tasks_payload: payload
        }
      },
      headers: { "X-Requested-With" => "XMLHttpRequest", "Accept" => "application/json" }

    assert_response :success
    @doc.reload
    assert_equal [ { "text" => "One", "checked" => false, "subtasks" => [] } ], @doc.tasks
  end
end
