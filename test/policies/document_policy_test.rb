require "test_helper"
require "securerandom"

class DocumentPolicyTest < ActiveSupport::TestCase
  setup do
    suffix = SecureRandom.hex(4)
    @user = User.create!(
      email: "policy_test_#{suffix}@example.com",
      username: "policy_user_#{suffix}",
      password: "password123",
      password_confirmation: "password123"
    )
    FinderWorkspaceInitializer.ensure_for_user!(@user)
  end

  teardown do
    Document.delete_all
    User.where(id: @user&.id).delete_all
  end

  test "allows opening note document in quartz app" do
    notes_root = Apps::FinderController.workspace_section_root(@user, "quartz")
    note = Document.create!(
      is_folder: false,
      parent: notes_root,
      title: "Policy Note",
      content_type: "note",
      content: "<p>ok</p>"
    )

    policy = DocumentPolicy.new(user: @user, document: note)

    assert policy.can_open_in_app?(content_type: "note", section_key: "quartz", allow_embedded: true)
    assert_not policy.can_open_in_app?(content_type: "task_list", section_key: "quartz", allow_embedded: true)
  end

  test "allows saving only into finder folders" do
    documents_root = Apps::FinderController.workspace_section_root(@user, "documents")
    embedded_root = FinderListedFolders.workspace_root_for(@user).children.folders.find { |d| d.title.to_s.casecmp?("Embedded") }

    assert DocumentPolicy.new(user: @user, document: documents_root).can_save_into_folder?
    assert_not DocumentPolicy.new(user: @user, document: embedded_root).can_save_into_folder?
  end

  test "blocks delete for protected workspace structure" do
    documents_root = Apps::FinderController.workspace_section_root(@user, "documents")

    policy = DocumentPolicy.new(user: @user, document: documents_root)

    assert policy.protected_workspace_structure?
    assert_not policy.can_delete?
  end

  test "allows wallpaper upload target for iimage embedded folder" do
    iimage_folder = EmbeddedIimageFolder.document_for(@user)
    policy = DocumentPolicy.new(user: @user, document: iimage_folder)

    assert policy.can_upload_to_folder?(iimage_folder_id: iimage_folder.id)
  end
end
