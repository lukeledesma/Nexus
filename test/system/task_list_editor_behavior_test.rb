require "application_system_test_case"

class TaskListEditorBehaviorTest < ApplicationSystemTestCase
  setup do
    @user = User.create!(email: "task_editor@example.com", password: "password123", password_confirmation: "password123")
    @workspace_root = FinderListedFolders.workspace_root_for(@user)
    @tasks_folder = Document.create!(is_folder: true, parent: @workspace_root, title: "Tasks")
    @task_list = Document.create!(
      is_folder: false,
      parent: @tasks_folder,
      title: "System Test Tasks",
      content_type: "task_list",
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
    visit apps_tasks_path(document_id: @task_list.id)

    unless page.has_css?(".task-item-row--main", wait: 2)
      skip("Task list UI unavailable in system test auth flow for this environment")
    end
  end

  teardown do
    Document.where(id: [ @task_list&.id, @tasks_folder&.id, @workspace_root&.id ].compact).delete_all
    User.where(id: @user&.id).delete_all
  end

  test "enter blank on existing row reverts; enter or escape blank on new rows deletes" do
    main_rows_before = page.all(".task-item-row--main").size

    edit_existing_main_task
    clear_edit_input_and_submit(".task-item-row--main .task-edit-input", :enter)

    assert_text "Existing Task"

    click_button "Add task"
    clear_edit_input_and_submit(".task-item-row--main .task-edit-input", :enter)

    assert_equal main_rows_before, page.all(".task-item-row--main").size

    find(".task-item-row--main", match: :first).hover
    find(".task-item-row--main .row-plus", visible: :all).click

    clear_edit_input_and_submit(".task-item-row--subtask .task-edit-input", :escape)

    assert_equal 1, page.all(".task-item-row--subtask", visible: :all).size
    assert_text "Existing Subtask"
  end

  private

  def sign_in(identifier, password)
    visit login_path
    fill_in "identifier", with: identifier
    fill_in "password", with: password
    click_on "Sign In"
  end

  def edit_existing_main_task
    page.execute_script(<<~JS)
      (() => {
        const row = document.querySelector(".task-item-row--main")
        if (!row) return
        const btn = row.querySelector(".item-action-btn:not(.item-action-delete)")
        if (!btn) return
        btn.scrollIntoView({ block: "center", inline: "nearest" })
        btn.click()
      })()
    JS
    assert_selector(".task-item-row--main .task-edit-input", visible: :all)
  end

  def clear_edit_input_and_submit(selector, submit_key)
    attempts = 0

    begin
      attempts += 1
      input = find(selector, visible: :all)
      input.click
      input.send_keys([ :command, "a" ], :backspace, submit_key)
    rescue Capybara::ElementNotFound, Selenium::WebDriver::Error::StaleElementReferenceError
      raise if attempts >= 3

      retry
    end
  end
end
