require "test_helper"
require "securerandom"

class AppsOpenLinkedDocumentTest < ActiveSupport::TestCase
  setup do
    suffix = SecureRandom.hex(4)
    @user = User.create!(
      email: "open_linked_doc_#{suffix}@example.com",
      username: "open_doc_user_#{suffix}",
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

  test "returns ok for a note in requested section" do
    docs_root = Apps::FinderController.workspace_section_root(@user, "documents")
    doc = docs_root.children.create!(title: "Daily Note", is_folder: false, content_type: "note", content: "Hello")

    result = Apps::OpenLinkedDocument.call(
      user: @user,
      document_id: doc.id,
      content_type: "note",
      section_key: "documents",
      allow_embedded: true
    )

    assert result.success?
    assert_equal :ok, result.status
    assert_equal doc.id, result.payload.fetch(:document).id
  end

  test "returns invalid_id for non numeric document id" do
    result = Apps::OpenLinkedDocument.call(
      user: @user,
      document_id: "abc",
      content_type: "note",
      section_key: "documents",
      allow_embedded: true
    )

    assert_equal :invalid_id, result.status
    assert_not result.success?
  end

  test "returns not_found for missing document" do
    result = Apps::OpenLinkedDocument.call(
      user: @user,
      document_id: 999_999,
      content_type: "note",
      section_key: "documents",
      allow_embedded: true
    )

    assert_equal :not_found, result.status
    assert_not result.success?
  end

  test "returns ok for section mismatch when document is still in storage" do
    desktop_root = Apps::FinderController.workspace_section_root(@user, "desktop")
    doc = desktop_root.children.create!(title: "Task Note", is_folder: false, content_type: "note", content: "x")

    result = Apps::OpenLinkedDocument.call(
      user: @user,
      document_id: doc.id,
      content_type: "note",
      section_key: "documents",
      allow_embedded: true
    )

    assert_equal :ok, result.status
    assert result.success?
  end

  test "returns ok for task list in documents section" do
    docs_root = Apps::FinderController.workspace_section_root(@user, "documents")
    doc = docs_root.children.create!(title: "Daily Tasks", is_folder: false, content_type: "task_list", tasks: [])

    result = Apps::OpenLinkedDocument.call(
      user: @user,
      document_id: doc.id,
      content_type: "task_list",
      section_key: "documents",
      allow_embedded: true
    )

    assert result.success?
    assert_equal doc.id, result.payload.fetch(:document).id
  end

  test "returns ok for audio section mismatch when asset is still in storage" do
    images_root = Apps::FinderController.workspace_section_root(@user, "images")
    doc = images_root.children.create!(title: "clip.mp3", is_folder: false, content_type: "asset", content: "")

    result = Apps::OpenLinkedDocument.call(
      user: @user,
      document_id: doc.id,
      content_type: "asset",
      section_key: "audio",
      allow_embedded: true
    )

    assert_equal :ok, result.status
    assert result.success?
  end

  test "returns unauthorized for document in trash" do
    docs_root = Apps::FinderController.workspace_section_root(@user, "documents")
    doc = docs_root.children.create!(title: "Trashed Note", is_folder: false, content_type: "note", content: "Hello")

    trash_result = Documents::TrashDocument.call(user: @user, document: doc)
    assert_equal true, trash_result.success?

    result = Apps::OpenLinkedDocument.call(
      user: @user,
      document_id: doc.id,
      content_type: "note",
      section_key: "documents",
      allow_embedded: true
    )

    assert_equal :unauthorized, result.status
    assert_not result.success?
  end
end
