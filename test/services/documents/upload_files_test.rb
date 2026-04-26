require "test_helper"
require "securerandom"

module Documents
  class UploadFilesTest < ActiveSupport::TestCase
    setup do
      suffix = SecureRandom.hex(4)
      @user = User.create!(
        email: "upload_files_test_#{suffix}@example.com",
        username: "upload_files_user_#{suffix}",
        password: "password123",
        password_confirmation: "password123"
      )
      FinderWorkspaceInitializer.ensure_for_user!(@user)
      @folder = Document.create!(is_folder: true, parent: Apps::FinderController.workspace_section_root(@user, "documents"), title: "Uploads")
    end

    teardown do
      Document.delete_all
      User.where(id: @user&.id).delete_all
    end

    test "rejects when no files provided" do
      result = Documents::UploadFiles.call(user: @user, folder: @folder, files: nil)

      assert_not result.success?
      assert_equal :unprocessable_entity, result.status
      assert_match(/No files/i, result.error)
    end

    test "imports text file upload" do
      tempfile = Tempfile.new([ "upload", ".txt" ])
      tempfile.binmode
      tempfile.write("Simple note")
      tempfile.rewind
      uploaded = Rack::Test::UploadedFile.new(tempfile.path, "text/plain", original_filename: "Simple.txt")

      result = Documents::UploadFiles.call(user: @user, folder: @folder, files: [ uploaded ])

      assert result.success?
      assert_equal 1, result.payload[:ids].length
    ensure
      tempfile&.close!
    end
  end
end
