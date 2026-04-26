require "test_helper"
require "securerandom"

module Documents
  class MoveDocumentTest < ActiveSupport::TestCase
    setup do
      suffix = SecureRandom.hex(4)
      @user = User.create!(
        email: "move_document_test_#{suffix}@example.com",
        username: "move_document_user_#{suffix}",
        password: "password123",
        password_confirmation: "password123"
      )
      FinderWorkspaceInitializer.ensure_for_user!(@user)
      @root = Apps::FinderController.workspace_section_root(@user, "documents")
      @a = Document.create!(is_folder: true, parent: @root, title: "A")
      @b = Document.create!(is_folder: true, parent: @root, title: "B")
    end

    teardown do
      Document.delete_all
      User.where(id: @user&.id).delete_all
    end

    test "moves file between folders" do
      file = Document.create!(is_folder: false, parent: @a, title: "note", content_type: "note", content: "<p>x</p>")
      result = Documents::MoveDocument.call(user: @user, document: file, parent_id: @b.id, kind: :file)

      assert result.success?
      assert_equal @b.id, file.reload.parent_id
    end

    test "prevents moving folder into its descendant" do
      child = Document.create!(is_folder: true, parent: @a, title: "Child")
      result = Documents::MoveDocument.call(user: @user, document: @a, parent_id: child.id, kind: :folder)

      assert_not result.success?
      assert_equal :unprocessable_entity, result.status
    end
  end
end
