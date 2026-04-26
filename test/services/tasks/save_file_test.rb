require "test_helper"
require "securerandom"

module Tasks
  class SaveFileTest < ActiveSupport::TestCase
    setup do
      suffix = SecureRandom.hex(4)
      @user = User.create!(
        email: "tasks_save_file_test_#{suffix}@example.com",
        username: "tasks_save_file_user_#{suffix}",
        password: "password123",
        password_confirmation: "password123"
      )
      FinderWorkspaceInitializer.ensure_for_user!(@user)
      @folder = Apps::FinderController.workspace_section_root(@user, "documents")
    end

    teardown do
      Document.delete_all
      User.where(id: @user&.id).delete_all
    end

    test "returns bad request when required params missing" do
      result = Tasks::SaveFile.call(
        user: @user,
        folder_id: nil,
        frame_id: "",
        filename: "",
        requested_document_id: nil,
        note_text: nil,
        task_payload: nil
      )

      assert_not result.success?
      assert_equal :bad_request, result.status
    end

    test "save as new clears draft and keeps draft identity" do
      draft = EmbeddedDraftDocument.fetch_or_create(user: @user, app_key: "tasks")
      draft.update!(tasks: [ { "text" => "draft", "checked" => false, "subtasks" => [] } ])

      result = Tasks::SaveFile.call(
        user: @user,
        folder_id: @folder.id,
        frame_id: "tasks-pane",
        filename: "Saved",
        requested_document_id: draft.id,
        note_text: nil,
        task_payload: [ { text: "saved", checked: false, subtasks: [] } ].to_json
      )

      assert result.success?
      assert_equal true, result.payload[:cleared_embedded_draft]

      refreshed = EmbeddedDraftDocument.fetch_or_create(user: @user, app_key: "tasks")
      assert_equal draft.id, refreshed.id
      assert_equal [], refreshed.tasks
    end
  end
end
