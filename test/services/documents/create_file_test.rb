require "test_helper"
require "securerandom"

module Documents
  class CreateFileTest < ActiveSupport::TestCase
    setup do
      suffix = SecureRandom.hex(4)
      @user = User.create!(
        email: "create_file_test_#{suffix}@example.com",
        username: "create_file_user_#{suffix}",
        password: "password123",
        password_confirmation: "password123"
      )
      FinderWorkspaceInitializer.ensure_for_user!(@user)
      @parent = Apps::FinderController.workspace_section_root(@user, "documents")
    end

    teardown do
      Document.delete_all
      User.where(id: @user&.id).delete_all
    end

    test "creates default note file" do
      result = Documents::CreateFile.call(parent: @parent, content_type: "note")

      assert result.success?
      created = Document.find(result.payload[:file_id])
      assert_equal "note", created.content_type
      assert_equal @parent.id, created.parent_id
    end

    test "rejects non-folder parent" do
      file = Document.create!(is_folder: false, parent: @parent, title: "x", content_type: "note", content: "<p>x</p>")
      result = Documents::CreateFile.call(parent: file, content_type: "note")

      assert_not result.success?
      assert_equal :forbidden, result.status
    end
  end
end
