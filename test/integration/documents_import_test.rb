require "test_helper"

class DocumentsImportTest < ActionDispatch::IntegrationTest
  setup do
    @user = User.create!(
      email: "documents_import_test@example.com",
      password: "password123",
      password_confirmation: "password123"
    )
    post login_path, params: { identifier: @user.email, password: "password123" }
  end

  teardown do
    Document.delete_all
    User.where(id: @user&.id).delete_all
  end

  test "creates a note file inside a folder" do
    documents_root = Apps::FinderController.workspace_section_root(@user, "documents")
    assert_not_nil documents_root
    folder = Document.create!(is_folder: true, parent: documents_root, title: "Uploads")

    assert_difference -> { Document.where(parent_id: folder.id, is_folder: false).count }, 1 do
      post create_file_document_path(folder), params: { content_type: "note" }
    end

    assert_redirected_to root_path

    created = Document.where(parent_id: folder.id, is_folder: false).order(:id).last
    assert_not_nil created
    assert_equal "note", created.content_type
  end

  test "rejects upload when destination is not a folder" do
    folder = Document.create!(is_folder: true, title: "Parent", storage_path: "Parent")
    file_doc = Document.create!(
      is_folder: false,
      parent: folder,
      title: "Existing",
      content_type: "note",
      content: "<p>existing</p>",
      storage_path: "Parent/existing.rtf"
    )

    upload_file = Tempfile.new([ "bad_upload", ".txt" ])
    upload_file.binmode
    upload_file.write("should fail")
    upload_file.rewind

    assert_no_difference -> { Document.where(parent_id: file_doc.id, is_folder: false).count } do
      post upload_images_document_path(file_doc), params: {
        files: Rack::Test::UploadedFile.new(
          upload_file.path,
          "text/plain",
          original_filename: "bad_upload.txt"
        )
      }
    end

    assert_response :unprocessable_entity
  ensure
    upload_file&.close!
  end
end
