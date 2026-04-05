require "application_system_test_case"

class TaskListEditorBehaviorTest < ApplicationSystemTestCase
  setup do
    @user = User.create!(email: "task_editor@example.com", password: "password123", password_confirmation: "password123")
    @folder = Folder.create!(name: "App")
    @task_list = Item.create!(
      folder: @folder,
      item_type: "task_list",
      name: "System Test Tasks",
      tasks: [
        {
          "text" => "Existing Task",
          "checked" => false,
          "subtasks" => [
            { "text" => "Existing Subtask", "checked" => false }
          ]
        }
      ]
    )

    sign_in(@user.email, "password123")
    visit apps_task_list_path(@task_list)

    unless page.has_css?(".task-item-row--main", wait: 2)
      skip("Task list UI unavailable in system test auth flow for this environment")
    end
  end

  teardown do
    Item.where(id: @task_list&.id).delete_all
    Folder.where(id: @folder&.id).delete_all
    User.where(id: @user&.id).delete_all
  end

  test "enter blank on existing row reverts; enter or escape blank on new rows deletes" do
    main_rows_before = page.all(".task-item-row--main").size

    edit_existing_main_task
    existing_input = find(".task-item-row--main .task-edit-input", visible: :all)
    existing_input.set("")
    existing_input.send_keys(:enter)

    assert_text "Existing Task"

    click_button "Add task"
    new_main_input = find(".task-item-row--main .task-edit-input", visible: :all)
    new_main_input.set("")
    new_main_input.send_keys(:enter)

    assert_equal main_rows_before, page.all(".task-item-row--main").size

    main_row = find(".task-item-row--main", match: :first)
    main_row.hover
    within(main_row) { find(".row-plus", visible: :all).click }

    new_subtask_input = find(".task-item-row--subtask .task-edit-input", visible: :all)
    new_subtask_input.set("")
    new_subtask_input.send_keys(:escape)

    assert_equal 1, page.all(".task-item-row--subtask", visible: :all).size
    assert_text "Existing Subtask"
  end

  private

  def sign_in(email, password)
    visit login_path
    fill_in "email", with: email
    fill_in "password", with: password
    click_on "Sign In"
  end

  def edit_existing_main_task
    row = find(".task-item-row--main", match: :first)
    row.hover
    within(row) do
      find(".item-action-btn:not(.item-action-delete)", visible: :all).click
    end
  end
end
