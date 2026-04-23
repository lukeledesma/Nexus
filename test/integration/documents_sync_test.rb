require "test_helper"

class DocumentsSyncTest < ActionDispatch::IntegrationTest
  setup do
    @user = User.create!(
      email: "documents_sync_test@example.com",
      password: "password123",
      password_confirmation: "password123"
    )
    post login_path, params: { identifier: @user.email, password: "password123" }
  end

  teardown do
    Document.delete_all
    User.where(id: @user&.id).delete_all
  end

  test "organizer load removes db file missing on disk" do
    folder = Document.create!(is_folder: true, title: "sync-folder", storage_path: "sync-folder")
    file = Document.create!(
      is_folder: false,
      parent: folder,
      title: "ghost",
      content_type: "note",
      content: "<p>ghost</p>",
      storage_path: "sync-folder/ghost.xml",
    )

    FileUtils.rm_f(DocumentStorageSyncLite.storage_root.join(file.storage_path.to_s))

    get root_path

    assert_nil Document.find_by(id: file.id)
  ensure
    FileUtils.rm_rf(DocumentStorageSyncLite.storage_root.join("sync-folder"))
    Document.folders.where(storage_path: "sync-folder").delete_all
  end

  test "organizer load ingests supported text file from disk into db" do
    folder_path = DocumentStorageSyncLite.storage_root.join("finder-folder")
    FileUtils.mkdir_p(folder_path)
    text_path = folder_path.join("from_finder.txt")
    File.write(text_path, "Imported from disk")

    assert_nil Document.files.find_by(storage_path: "finder-folder/from_finder.txt")

    get root_path

    created = Document.files.find_by(storage_path: "finder-folder/from_finder.txt")
    assert_not_nil created
    assert_equal "from_finder", created.title
    assert_equal "note", created.content_type
  ensure
    FileUtils.rm_rf(DocumentStorageSyncLite.storage_root.join("finder-folder"))
    Document.files.where(storage_path: "finder-folder/from_finder.txt").delete_all
    Document.folders.where(storage_path: "finder-folder").delete_all
  end

  test "organizer ignores unsupported files without ingesting them" do
    folder_path = DocumentStorageSyncLite.storage_root.join("mixed-folder")
    FileUtils.mkdir_p(folder_path)
    unsupported_path = folder_path.join("notes.xml")
    File.write(unsupported_path, "<xml/>")

    get root_path

    assert_response :success
    assert_not_includes @response.body, "notes.xml"
    assert_nil Document.files.find_by(storage_path: "mixed-folder/notes.xml")
  ensure
    FileUtils.rm_rf(DocumentStorageSyncLite.storage_root.join("mixed-folder"))
    Document.folders.where(storage_path: "mixed-folder").delete_all
  end
end
