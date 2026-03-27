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
end