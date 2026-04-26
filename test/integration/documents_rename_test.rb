require "test_helper"

class DocumentsRenameTest < ActionDispatch::IntegrationTest
  setup do
    @user = User.create!(
      email: "documents_rename_test@example.com",
      password: "password123",
      password_confirmation: "password123"
    )
    post login_path, params: { identifier: @user.email, password: "password123" }
  end

  teardown do
    Document.delete_all
    User.where(id: @user&.id).delete_all
  end

  test "allows case-only rename for file in same folder" do
    folder = Document.create!(is_folder: true, title: "Sample Client", storage_path: "Sample Client")
    file = Document.create!(
      is_folder: false,
      parent: folder,
      title: "sample export",
      content_type: "note",
      content: "<p>sample</p>",
      storage_path: "Sample Client/sample_export.rtf"
    )

    patch rename_document_path(file), params: { name: "Sample Export" }

    assert_response :success
    file.reload
    assert_match(/\ASample Export(?: \d+)?\z/, file.title)
  end

  test "rejects rename when name starts with period" do
    folder = Document.create!(is_folder: true, title: "Sample Client", storage_path: "Sample Client")
    file = Document.create!(
      is_folder: false,
      parent: folder,
      title: "sample export",
      content_type: "note",
      content: "<p>sample</p>",
      storage_path: "Sample Client/sample_export.rtf"
    )
    original_title = file.title

    patch rename_document_path(file), params: { name: ".hidden" }

    assert_response :unprocessable_entity
    assert_match "Name cannot start with a period", response.parsed_body["error"]
    file.reload
    assert_equal original_title, file.title
  end
end
