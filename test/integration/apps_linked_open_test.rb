require "test_helper"
require "securerandom"

class AppsLinkedOpenTest < ActionDispatch::IntegrationTest
  setup do
    suffix = SecureRandom.hex(4)
    @user = User.create!(
      email: "apps_linked_open_#{suffix}@example.com",
      username: "apps_open_user_#{suffix}",
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

  test "quartz opens linked note when allowed" do
    quartz_root = Apps::FinderController.workspace_section_root(@user, "quartz")
    doc = quartz_root.children.create!(
      title: "Quartz Log",
      is_folder: false,
      content_type: "note",
      content: QuartzDocumentCodec.dump("#timer\n09:00")
    )

    get apps_quartz_path, params: { document_id: doc.id }

    assert_response :success
    assert_includes response.body, %(name="document[content]")
    assert_includes response.body, %(data-controller="quartz")
  end

  test "quartz rehydrates without trailing blank line after disk round-trip" do
    quartz_root = Apps::FinderController.workspace_section_root(@user, "quartz")
    doc = quartz_root.children.create!(
      title: "Single Line",
      is_folder: false,
      content_type: "note",
      content: QuartzDocumentCodec.dump("hello")
    )

    DocumentDiskLoader.sync!
    doc.reload

    get apps_quartz_path, params: { document_id: doc.id }

    assert_response :success
    shell = Nokogiri::HTML(response.body).at_css("section[data-controller='quartz']")
    assert shell
    assert_match(/data-quartz-linked-document-id-value="\d+"/, response.body)
  end

  test "quartz falls back to draft editor for invalid id" do
    get apps_quartz_path, params: { document_id: "nope" }

    assert_response :success
    assert_includes response.body, %(data-controller="quartz")
    assert_match(/data-quartz-linked-document-id-value="\d+"/, response.body)
  end

  test "quartz falls back to draft editor for missing document" do
    get apps_quartz_path, params: { document_id: 999_999 }

    assert_response :success
    assert_includes response.body, %(data-controller="quartz")
    assert_match(/data-quartz-linked-document-id-value="\d+"/, response.body)
  end

  test "quartz opens linked note in quartz section" do
    quartz_root = Apps::FinderController.workspace_section_root(@user, "quartz")
    doc = quartz_root.children.create!(
      title: "Today",
      is_folder: false,
      content_type: "note",
      content: QuartzDocumentCodec.dump("#timecard\n10:00-11:00 Client")
    )

    get apps_quartz_path, params: { document_id: doc.id }

    assert_response :success
    assert_includes response.body, %(data-controller="quartz")
    assert_match(%r{/documents/\d+}, response.body)
  end

  test "quartz falls back to embedded draft for non numeric id" do
    get apps_quartz_path, params: { document_id: "bad" }

    assert_response :success
    assert_includes response.body, %(data-controller="quartz")
    assert_match(/data-quartz-linked-document-id-value="\d+"/, response.body)
  end

  test "calendar app renders standalone shell" do
    get apps_calendar_path

    assert_response :success
    assert_includes response.body, %(data-controller="calendar-app")
    assert_includes response.body, %(id="calendar-pane")
  end

  test "images renders linked image when extension matches" do
    images_root = Apps::FinderController.workspace_section_root(@user, "images")
    doc = images_root.children.create!(title: "photo.jpg", is_folder: false, content_type: "asset", content: "")
    doc.update_columns(storage_path: "Finder/Images/photo.jpg")

    get apps_images_path, params: { document_id: doc.id }

    assert_response :success
    assert_includes response.body, asset_file_document_path(doc.id)
  end

  test "images shows empty state for non image asset" do
    images_root = Apps::FinderController.workspace_section_root(@user, "images")
    doc = images_root.children.create!(title: "song.mp3", is_folder: false, content_type: "asset", content: "")

    get apps_images_path, params: { document_id: doc.id }

    assert_response :success
    assert_includes response.body, "Select an image file in Finder to open it here."
  end

  test "audio renders linked audio when extension matches" do
    audio_root = Apps::FinderController.workspace_section_root(@user, "audio")
    doc = audio_root.children.create!(title: "clip.mp3", is_folder: false, content_type: "asset", content: "")
    doc.update_columns(
      title: "clip.mp3",
      storage_path: "Finder/Audio/clip.mp3"
    )

    get apps_audio_path, params: { document_id: doc.id }

    assert_response :success
    assert_includes response.body, "audio-app"
  end

  test "audio shows empty state for invalid document id" do
    get apps_audio_path, params: { document_id: "bad" }

    assert_response :success
    assert_includes response.body, "Select an audio file in Finder to open it here."
  end

  test "tasks opens linked task list in documents section" do
    docs_root = Apps::FinderController.workspace_section_root(@user, "documents")
    doc = docs_root.children.create!(title: "Task Board", is_folder: false, content_type: "task_list", tasks: [])

    get apps_tasks_path, params: { document_id: doc.id }

    assert_response :success
    assert_includes response.body, "task-list-form"
  end

  test "tasks falls back to embedded draft for invalid document id" do
    get apps_tasks_path, params: { document_id: "bad" }

    assert_response :success
    assert_includes response.body, "data-linked-app-has-linked-document=\"true\""
    assert_includes response.body, "task-list-form"
  end
end
