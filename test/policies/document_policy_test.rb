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
    UserAppState.delete_all
    Document.delete_all
    User.where(id: @user&.id).delete_all
  end

  test "allows opening note document anywhere in finder" do
    notes_root = Apps::FinderController.workspace_section_root(@user, "desktop")
    note = Document.create!(
      is_folder: false,
      parent: notes_root,
      title: "Policy Note",
      content_type: "note",
      content: "<p>ok</p>"
    )

    policy = DocumentPolicy.new(user: @user, document: note)

    assert policy.can_open_in_app?(content_type: "note", allow_embedded: true)
    assert_not policy.can_open_in_app?(content_type: "task_list", allow_embedded: true)
  end

  test "allows saving only into finder folders" do
    documents_root = Apps::FinderController.workspace_section_root(@user, "documents")
    workspace_root = FinderListedFolders.workspace_root_for(@user)

    assert DocumentPolicy.new(user: @user, document: documents_root).can_save_into_folder?
    assert_not DocumentPolicy.new(user: @user, document: workspace_root).can_save_into_folder?
  end

  test "blocks delete for storage root" do
    documents_root = Apps::FinderController.workspace_section_root(@user, "documents")
    workspace_root = FinderListedFolders.workspace_root_for(@user)

    policy = DocumentPolicy.new(user: @user, document: documents_root)
    workspace_policy = DocumentPolicy.new(user: @user, document: workspace_root)

    assert policy.protected_workspace_structure?
    assert_not policy.can_delete?
    assert workspace_policy.user_workspace_root?
    assert_not workspace_policy.can_delete?
  end

  test "allows uploads into section roots but still blocks trash" do
    images_root = Apps::FinderController.workspace_section_root(@user, "images")
    trash_root = Apps::FinderController.workspace_trash_root(@user)
    images_policy = DocumentPolicy.new(user: @user, document: images_root)
    trash_policy = DocumentPolicy.new(user: @user, document: trash_root)

    assert images_policy.can_upload_to_folder?
    assert_not trash_policy.can_upload_to_folder?
  end
end
