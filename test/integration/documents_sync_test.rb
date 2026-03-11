require "test_helper"

class DocumentsSyncTest < ActionDispatch::IntegrationTest
  test "organizer load removes db file missing on disk" do
    folder = Document.create!(is_folder: true, metadata_filename: "sync-folder", storage_path: "sync-folder", records: [])
    file = Document.create!(
      is_folder: false,
      parent: folder,
      metadata_filename: "ghost.xml",
      storage_path: "sync-folder/ghost.xml",
      records: []
    )

    get root_path

    assert_nil Document.find_by(id: file.id)
  end

  test "organizer load ingests xml file from disk into db" do
    folder_path = Rails.root.join("storage", "tag_lists", "finder-folder")
    FileUtils.mkdir_p(folder_path)
    xml_path = folder_path.join("from_finder.xml")
    File.write(xml_path, <<~XML)
      <?xml version="1.0" encoding="UTF-8"?>
      <GLOBAL><XML></XML></GLOBAL>
    XML

    assert_nil Document.files.find_by(storage_path: "finder-folder/from_finder.xml")

    get root_path

    created = Document.files.find_by(storage_path: "finder-folder/from_finder.xml")
    assert_not_nil created
    assert_equal "from_finder.xml", created.metadata_filename
  ensure
    FileUtils.rm_rf(Rails.root.join("storage", "tag_lists", "finder-folder"))
    Document.files.where(storage_path: "finder-folder/from_finder.xml").delete_all
    Document.folders.where(storage_path: "finder-folder").delete_all
  end

  test "organizer shows non-xml files as read-only without ingesting them" do
    folder_path = Rails.root.join("storage", "tag_lists", "mixed-folder")
    FileUtils.mkdir_p(folder_path)
    txt_path = folder_path.join("notes.txt")
    File.write(txt_path, "hello")

    get root_path

    assert_response :success
    assert_includes @response.body, "notes.txt"
    assert_nil Document.files.find_by(storage_path: "mixed-folder/notes.txt")
  ensure
    FileUtils.rm_rf(Rails.root.join("storage", "tag_lists", "mixed-folder"))
    Document.folders.where(storage_path: "mixed-folder").delete_all
  end
end
