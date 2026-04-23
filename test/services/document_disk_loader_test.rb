require "test_helper"

class DocumentDiskLoaderTest < ActiveSupport::TestCase
  test "task list parser understands explicit main and subtask markers" do
    lines = [
      "# NEXUS_TASK_LIST",
      "# title: Tasks",
      "",
      "[ ] Main task",
      "- [x] First subtask",
      "- [ ] Second subtask",
      "",
      "[x] Standalone task"
    ]

    parsed = DocumentDiskLoader.send(:parse_task_list, lines)

    assert_equal 2, parsed[:tasks].length
    assert_equal "Main task", parsed[:tasks][0]["text"]
    assert_equal 2, parsed[:tasks][0]["subtasks"].length
    assert_equal "First subtask", parsed[:tasks][0]["subtasks"][0]["text"]
    assert_equal true, parsed[:tasks][0]["subtasks"][0]["checked"]
    assert_equal false, parsed[:tasks][0]["checked"]
    assert_equal "Standalone task", parsed[:tasks][1]["text"]
    assert_equal true, parsed[:tasks][1]["checked"]
  end

  test "task list parser keeps supporting legacy grouped dash format" do
    lines = [
      "# NEXUS_TASK_LIST",
      "# title: Tasks",
      "",
      "- [ ] Legacy main",
      "- [x] Legacy subtask"
    ]

    parsed = DocumentDiskLoader.send(:parse_task_list, lines)

    assert_equal 1, parsed[:tasks].length
    assert_equal "Legacy main", parsed[:tasks][0]["text"]
    assert_equal 1, parsed[:tasks][0]["subtasks"].length
    assert_equal "Legacy subtask", parsed[:tasks][0]["subtasks"][0]["text"]
  end

  test "wav and related extensions are indexed as asset documents" do
    assert DocumentDiskLoader.send(:supported_file_extension?, "/tmp/x.wav")
    assert DocumentDiskLoader.send(:supported_file_extension?, "/tmp/x.WAV")
    assert DocumentDiskLoader.send(:disk_asset_file?, "/a/b/c.mp3")
    assert_equal "707 Crash", DocumentDiskLoader.send(:basename_without_supported_extension, "/Cymbals/707 Crash.wav")

    attrs = DocumentDiskLoader.send(:asset_file_attributes)
    assert_equal "asset", attrs[:content_type]
    assert_nil attrs[:content]
  end

  test "markdown task files are supported and title strips md extension" do
    assert DocumentDiskLoader.send(:supported_file_extension?, "/tmp/Kanban/Backlog.md")
    assert_equal "Backlog", DocumentDiskLoader.send(:basename_without_supported_extension, "/tmp/Kanban/Backlog.md")
  end

  test "purge removes missing folders and files" do
    stale_folder = Document.create!(is_folder: true, title: "Stale Folder", storage_path: "stale-folder")
    stale_file = Document.create!(
      is_folder: false,
      parent: stale_folder,
      title: "Stale",
      content_type: "note",
      content: "<p>x</p>",
      storage_path: "stale-folder/stale.rtf"
    )
    FileUtils.rm_rf(DocumentStorageSyncLite.storage_root.join("stale-folder"))

    DocumentDiskLoader.send(:purge_missing_from_database!, [])

    assert_not Document.exists?(stale_folder.id), "expected missing folders to be purged"
    assert_not Document.exists?(stale_file.id), "expected missing files to still be purged"
  end
end