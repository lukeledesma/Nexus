require "test_helper"
require "securerandom"

module Documents
  class CreateSubfolderTest < ActiveSupport::TestCase
    setup do
      suffix = SecureRandom.hex(4)
      @user = User.create!(
        email: "create_subfolder_test_#{suffix}@example.com",
        username: "create_subfolder_user_#{suffix}",
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

    test "creates subfolder under folder parent" do
      result = Documents::CreateSubfolder.call(parent: @parent, title: "Project Files")

      assert result.success?
      created = Document.find(result.payload[:id])
      assert_equal @parent.id, created.parent_id
      assert_equal "Project Files", created.title
      assert created.folder?
    end

    test "rejects blank title" do
      result = Documents::CreateSubfolder.call(parent: @parent, title: "  ")

      assert_not result.success?
      assert_equal :unprocessable_entity, result.status
      assert_match(/required/i, result.error)
    end
  end
end
