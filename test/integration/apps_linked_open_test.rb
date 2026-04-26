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
    Document.delete_all
    User.where(id: @user&.id).delete_all
  end

  test "notes opens linked note when allowed" do
    notes_root = Apps::FinderController.workspace_section_root(@user, "notes")
    doc = notes_root.children.create!(
      title: "Design Notes",
      is_folder: false,
      content_type: "note",
      content: "<p>Hello<br>World</p>"
    )

    get apps_notes_path, params: { document_id: doc.id }

    assert_response :success
    assert_includes response.body, %(name="document[content]")
    assert_includes response.body, document_path(doc.id)
  end

  test "notes falls back to draft editor for invalid id" do
    get apps_notes_path, params: { document_id: "nope" }

    assert_response :success
    assert_includes response.body, %(data-notes-editor-frame-id-value="notes-pane")
    assert_includes response.body, %(data-linked-app-has-linked-document="false")
  end

  test "notes falls back to draft editor for missing document" do
    get apps_notes_path, params: { document_id: 999_999 }

    assert_response :success
    assert_includes response.body, %(data-linked-app-has-linked-document="false")
  end

  test "time card opens linked note in time card section" do
    time_card_root = Apps::FinderController.workspace_section_root(@user, "time_card")
    payload = TimeCardDocumentCodec.dump(
      {
        clockInMinutes: 480,
        clockInAtMs: nil,
        clockOutAtMs: nil,
        clockOutMinutes: nil,
        running: false,
        notesText: "entry"
      }
    )
    doc = time_card_root.children.create!(title: "Today", is_folder: false, content_type: "note", content: payload)

    get apps_time_card_path, params: { document_id: doc.id }

    assert_response :success
    assert_includes response.body, %(data-time-card-linked-document-id-value="#{doc.id}")
    assert_includes response.body, document_path(doc.id)
  end

  test "time card keeps default state for non numeric id" do
    get apps_time_card_path, params: { document_id: "bad" }

    assert_response :success
    assert_includes response.body, %(data-time-card-linked-document-id-value="0")
  end

  test "images renders linked image when extension matches" do
    images_root = Apps::FinderController.workspace_section_root(@user, "images")
    doc = images_root.children.create!(title: "photo.jpg", is_folder: false, content_type: "asset", content: "")
    doc.update_columns(storage_path: "#{@user.username}/Finder/Images/photo.jpg")

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
      storage_path: "#{@user.username}/Finder/Audio/clip.mp3"
    )

    get apps_audio_path, params: { document_id: doc.id }

    assert_response :success
    assert_includes response.body, %(data-audio-initial-document-id="#{doc.id}")
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
    assert_includes response.body, %(data-task-list-linked-document-id="#{doc.id}")
    assert_includes response.body, document_path(doc.id)
  end

  test "tasks falls back to embedded draft for invalid document id" do
    get apps_tasks_path, params: { document_id: "bad" }

    assert_response :success
    assert_includes response.body, "data-linked-app-has-linked-document=\"true\""
    assert_includes response.body, "task-list-form"
  end
end