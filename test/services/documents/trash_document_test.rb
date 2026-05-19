require "test_helper"
require "securerandom"

class DocumentsTrashDocumentTest < ActiveSupport::TestCase
  setup do
    suffix = SecureRandom.hex(4)
    @user = User.create!(
      email: "trash_document_test_#{suffix}@example.com",
      username: "trash_document_user_#{suffix}",
      password: "password123",
      password_confirmation: "password123"
    )
    FinderWorkspaceInitializer.ensure_for_user!(@user)
  end

  teardown do
    UserAppState.delete_all
    Document.delete_all
    User.where(id: @user&.id).delete_all
  end

  test "trash moves file to Trash and restore returns it to original folder" do
    docs = Apps::FinderController.workspace_section_root(@user, "documents")
    trash = Apps::FinderController.workspace_trash_root(@user)
    file = docs.children.create!(
      title: "Trash Me",
      is_folder: false,
      content_type: "note",
      content: "hello"
    )

    trash_result = Documents::TrashDocument.call(user: @user, document: file)
    assert_equal true, trash_result.success?
    assert_equal trash.id, file.reload.parent_id

    restore_result = Documents::RestoreFromTrash.call(user: @user, document: file)
    assert_equal true, restore_result.success?
    assert_equal docs.id, file.reload.parent_id
  end

  test "trash repairs blank Trash folder storage path before moving file" do
    docs = Apps::FinderController.workspace_section_root(@user, "documents")
    trash = Apps::FinderController.workspace_trash_root(@user)
    trash.update_column(:storage_path, nil)

    file = docs.children.create!(
      title: "Repair Trash Path",
      is_folder: false,
      content_type: "note",
      content: "hello"
    )

    trash_result = Documents::TrashDocument.call(user: @user, document: file)
    assert_equal true, trash_result.success?

    repaired_trash = trash.reload
    assert_equal true, repaired_trash.storage_path.present?
    assert_equal repaired_trash.id, file.reload.parent_id
    assert_includes file.storage_path.to_s, repaired_trash.storage_path
  end

  test "restore falls back to documents section when original parent is missing" do
    docs = Apps::FinderController.workspace_section_root(@user, "documents")
    temp_folder = docs.children.create!(is_folder: true, title: "Temp")
    file = temp_folder.children.create!(
      title: "Fallback",
      is_folder: false,
      content_type: "note",
      content: "hello"
    )

    trash_result = Documents::TrashDocument.call(user: @user, document: file)
    assert_equal true, trash_result.success?

    temp_folder.destroy!

    restore_result = Documents::RestoreFromTrash.call(user: @user, document: file)
    assert_equal true, restore_result.success?
    assert_equal docs.id, file.reload.parent_id
  end
end
