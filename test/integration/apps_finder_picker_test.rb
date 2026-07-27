require "test_helper"
require "securerandom"

class AppsFinderPickerTest < ActionDispatch::IntegrationTest
  setup do
    suffix = SecureRandom.hex(4)
    @user = User.create!(
      email: "apps_finder_picker_#{suffix}@example.com",
      username: "apps_finder_picker_#{suffix}",
      password: "password123",
      password_confirmation: "password123"
    )

    post login_path, params: { identifier: @user.email, password: "password123" }
    FinderWorkspaceInitializer.ensure_for_user!(@user)
  end

  teardown do
    UserAppState.delete_all
    Document.delete_all
    User.where(id: @user&.id).delete_all
  end

  test "tasks picker shows only task list files" do
    storage_root = Apps::FinderController.workspace_section_root(@user, "documents")
    task_doc = storage_root.children.create!(title: "Picker Task", is_folder: false, content_type: "task_list", tasks: [])
    note_doc = storage_root.children.create!(title: "Picker Note", is_folder: false, content_type: "note", content: "<p>n</p>")

    get apps_finder_path, params: { mode: "save_as", frame_id: "tasks-pane" }

    assert_response :success
    assert_includes response.body, task_doc.title
    assert_not_includes response.body, note_doc.title
  end

  test "quartz picker shows only note files" do
    storage_root = Apps::FinderController.workspace_section_root(@user, "quartz")
    note_doc = storage_root.children.create!(title: "Picker Quartz Note", is_folder: false, content_type: "note", content: "<p>q</p>")
    task_doc = storage_root.children.create!(title: "Picker Quartz Task", is_folder: false, content_type: "task_list", tasks: [])

    get apps_finder_path, params: { mode: "save_as", frame_id: "quartz-pane" }

    assert_response :success
    assert_includes response.body, note_doc.title
    assert_not_includes response.body, task_doc.title
  end

  test "alchemy picker shows only alchemy tag list files" do
    storage_root = Apps::FinderController.workspace_section_root(@user, "alchemy")
    alchemy_doc = storage_root.children.create!(title: "Picker Tags", is_folder: false, content_type: "alchemy_tag_list", content: "<XML></XML>")
    note_doc = storage_root.children.create!(title: "Picker Other Note", is_folder: false, content_type: "note", content: "<p>no</p>")

    get apps_finder_path, params: { mode: "save_as", frame_id: "alchemy-pane" }

    assert_response :success
    assert_includes response.body, alchemy_doc.title
    assert_not_includes response.body, note_doc.title
  end
end
