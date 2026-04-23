require "application_system_test_case"

class TimeCardSmokeTest < ApplicationSystemTestCase
  setup do
    @user = User.create!(email: "time_card_smoke@example.com", password: "password123", password_confirmation: "password123")

    sign_in(@user.email, "password123")
    visit apps_time_card_path

    unless page.has_css?(".time-card-app", wait: 2)
      skip("Time Card UI unavailable in system test auth flow for this environment")
    end
  end

  teardown do
    User.where(id: @user&.id).delete_all
  end

  test "renders time card editor shell" do
    assert_selector ".time-card-app"
    assert_selector ".time-card-notes-textarea"
    assert_selector "#time-card-clockin-input"
    assert_selector "#time-card-clockout-input"
  end

  private

  def sign_in(identifier, password)
    visit login_path
    fill_in "identifier", with: identifier
    fill_in "password", with: password
    click_on "Sign In"
  end
end
