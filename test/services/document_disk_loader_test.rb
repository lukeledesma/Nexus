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

  test "purge removes missing folders and files" do
    stale_folder = Document.create!(is_folder: true, title: "Stale Folder", storage_path: "stale-folder")
    stale_file = Document.create!(is_folder: false, title: "Stale", content_type: "note", content: "x", storage_path: "stale.txt")

    DocumentDiskLoader.send(:purge_missing_from_database!, [])

    assert_not Document.exists?(stale_folder.id), "expected missing folders to be purged"
    assert_not Document.exists?(stale_file.id), "expected missing files to still be purged"
  end
end