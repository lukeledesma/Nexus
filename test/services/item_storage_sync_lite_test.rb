require "test_helper"

class ItemStorageSyncLiteTest < ActiveSupport::TestCase
  test "task list export includes subtasks in workspace text" do
    folder = Folder.create!(name: "App")
    item = Item.create!(
      folder: folder,
      item_type: "task_list",
      name: "Tasks",
      tasks: [
        {
          "text" => "Main task",
          "checked" => false,
          "subtasks" => [
            { "text" => "First subtask", "checked" => true },
            { "text" => "Second subtask", "checked" => false }
          ]
        },
        {
          "text" => "Standalone task",
          "checked" => true,
          "subtasks" => []
        }
      ]
    )

    contents = ItemStorageSyncLite.new.send(:task_list_contents, item)

    assert_includes contents, "[ ] Main task"
    assert_includes contents, "- [x] First subtask"
    assert_includes contents, "- [ ] Second subtask"
    assert_includes contents, "\n\n[x] Standalone task"
  end
end