require "test_helper"

class DocumentsDestroyTest < ActionDispatch::IntegrationTest
  setup do
    @user = User.create!(
      email: "documents_destroy_test@example.com",
      password: "password123",
      password_confirmation: "password123"
    )
    post login_path, params: { identifier: @user.email, password: "password123" }
  end

  teardown do
    UserAppState.delete_all
    Document.delete_all
    User.where(id: @user&.id).delete_all
  end

  test "moves regular file to Trash via json request" do
    root = FinderListedFolders.workspace_root_for(@user)
    docs = Apps::FinderController.workspace_section_root(@user, "documents")
    trash = Apps::FinderController.workspace_trash_root(@user)
    file = Document.create!(
      is_folder: false,
      parent: docs,
      title: "destroy_me",
      content_type: "note",
      content: "<p>bye</p>"
    )

    assert Document.exists?(file.id)
    assert DocumentStorageSyncLite.storage_root.join(file.storage_path).file?
    assert trash

    delete document_path(file), as: :json

    assert_response :no_content
    assert Document.exists?(file.id)
    assert_match(/\A#{Regexp.escape(Apps::FinderController::TRASH_SECTION_TITLE)}(?:\s+\d+)?\z/i, file.reload.parent.title)
    assert DocumentStorageSyncLite.storage_root.join(file.storage_path).exist?
    assert root
  end

  test "restores file from Trash to original parent" do
    docs = Apps::FinderController.workspace_section_root(@user, "documents")
    trash = Apps::FinderController.workspace_trash_root(@user)
    file = Document.create!(
      is_folder: false,
      parent: docs,
      title: "restore_me",
      content_type: "note",
      content: "<p>restore</p>"
    )

    delete document_path(file), as: :json
    assert_response :no_content
    assert_equal Apps::FinderController::TRASH_SECTION_TITLE, file.reload.parent.title

    patch restore_from_trash_document_path(file), as: :json

    assert_response :success
    assert_match(/\AStorage(?:\s+\d+)?\z/i, file.reload.parent.title)
  end

  test "rejects destroy for storage root" do
    docs = Apps::FinderController.workspace_section_root(@user, "documents")
    assert docs
    assert docs.user_workspace_root?

    delete document_path(docs), as: :json

    assert_response :forbidden
    assert_match(/protected/i, response.parsed_body.fetch("error"))
    assert Document.exists?(docs.id)
  end

  test "destroys folder subtree via json request" do
    docs = Apps::FinderController.workspace_section_root(@user, "documents")
    folder = Document.create!(is_folder: true, parent: docs, title: "delete-folder")
    file = Document.create!(
      is_folder: false,
      parent: folder,
      title: "delete-leaf",
      content_type: "note",
      content: "<p>leaf</p>"
    )

    folder_path = DocumentStorageSyncLite.storage_root.join(folder.storage_path)
    file_path = DocumentStorageSyncLite.storage_root.join(file.storage_path)
    assert folder_path.directory?
    assert file_path.file?

    delete document_path(folder), as: :json

    assert_response :no_content
    assert_not Document.exists?(folder.id)
    assert_not Document.exists?(file.id)
    assert_not folder_path.exist?
    assert_not file_path.exist?
  end

  test "returns unprocessable when persistence destroy fails" do
    docs = Apps::FinderController.workspace_section_root(@user, "documents")
    folder = Document.create!(is_folder: true, parent: docs, title: "cannot-delete")

    original_destroy = DocumentPersistence.method(:destroy)
    DocumentPersistence.singleton_class.define_method(:destroy) do |_document|
      DocumentPersistence::Result.new(
        success?: false,
        document: nil,
        error: "Injected destroy failure",
        code: :persistence_failed
      )
    end

    delete document_path(folder), as: :json

    assert_response :unprocessable_entity
    assert_equal "Injected destroy failure", response.parsed_body.fetch("error")
    assert Document.exists?(folder.id)
  ensure
    DocumentPersistence.singleton_class.define_method(:destroy, original_destroy) if original_destroy
  end
end
