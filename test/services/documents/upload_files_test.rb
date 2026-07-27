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
      UserAppState.delete_all
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

    test "imports xml upload as alchemy file outside alchemy section" do
      tempfile = Tempfile.new([ "upload", ".xml" ])
      tempfile.binmode
      tempfile.write("<?xml version=\"1.0\"?><XML><TagA><FUNCCODE>\"03\"</FUNCCODE></TagA></XML>")
      tempfile.rewind
      uploaded = Rack::Test::UploadedFile.new(tempfile.path, "application/xml", original_filename: "Tags.xml")

      result = Documents::UploadFiles.call(user: @user, folder: @folder, files: [ uploaded ])

      assert result.success?
      created = Document.find(result.payload[:ids].first)
      assert_equal "alchemy_tag_list", created.content_type
    ensure
      tempfile&.close!
    end

    test "allows upload into protected finder section root" do
      section_root = Apps::FinderController.workspace_section_root(@user, "documents")
      tempfile = Tempfile.new([ "upload", ".txt" ])
      tempfile.binmode
      tempfile.write("Root upload")
      tempfile.rewind
      uploaded = Rack::Test::UploadedFile.new(tempfile.path, "text/plain", original_filename: "Root.txt")

      result = Documents::UploadFiles.call(user: @user, folder: section_root, files: [ uploaded ])

      assert result.success?
      assert_equal :ok, result.status
      assert_equal 1, result.payload[:ids].length
    ensure
      tempfile&.close!
    end
  end
end
