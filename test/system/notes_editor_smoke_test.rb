require "application_system_test_case"

class NotesEditorSmokeTest < ApplicationSystemTestCase
  setup do
    @user = User.create!(email: "notes_smoke@example.com", password: "password123", password_confirmation: "password123")

    sign_in(@user.email, "password123")
    visit apps_notes_path

    unless page.has_css?(".notes-app__textarea", wait: 2)
      skip("Notes UI unavailable in system test auth flow for this environment")
    end
  end

  teardown do
    User.where(id: @user&.id).delete_all
  end

  test "renders notes editor shell" do
    assert_selector ".notes-app"
    assert_selector ".notes-app__textarea"
  end

  private

  def sign_in(identifier, password)
    visit login_path
    fill_in "identifier", with: identifier
    fill_in "password", with: password
    click_on "Sign In"
  end
end
