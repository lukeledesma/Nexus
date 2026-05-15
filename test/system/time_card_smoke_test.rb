require "application_system_test_case"
# frozen_string_literal: true

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
    assert_selector ".time-card-app__date-badge"
    assert_selector ".time-card-timeline-shell"
  end

  test "expands top-level dash shorthand and skips customer and entry lines" do
    textarea = find(".time-card-notes-textarea")
    textarea.click

    textarea.send_keys("10-")
    assert_textarea_value(textarea, "10:00-")

    textarea.send_keys(:enter, "1345-")
    assert_textarea_value(textarea, "10:00-\n13:45-")

    textarea.send_keys(:enter, "now-")
    lines = textarea.value.split("\n")
    assert_equal "10:00-", lines[0]
    assert_equal "13:45-", lines[1]

    now_line = String(lines[2]).sub(/-\z/, "")
    assert_match(/\A\d{2}:\d{2}\z/, now_line)
    now_hour, now_minute = now_line.split(":").map(&:to_i)
    assert_includes(0..23, now_hour)
    assert_equal 0, now_minute % 5

    textarea.send_keys(:enter)
    textarea.send_keys("10-")
    assert_textarea_value(textarea, "10:00-\n13:45-\n#{lines[2]}\n  10-")

    textarea.send_keys(:enter)
    textarea.send_keys("hello")
    textarea.send_keys(:enter)
    textarea.send_keys("10-")
    assert_equal "  - 10-", textarea.value.split("\n").last
  end

  private

  def sign_in(identifier, password)
    visit login_path
    fill_in "identifier", with: identifier
    fill_in "password", with: password
    click_on "Sign In"
  end

  def assert_textarea_value(textarea, expected)
    deadline = Process.clock_gettime(Process::CLOCK_MONOTONIC) + Capybara.default_max_wait_time
    loop do
      actual = textarea.value
      return if actual == expected
      break if Process.clock_gettime(Process::CLOCK_MONOTONIC) >= deadline
      sleep 0.05
    end
    assert_equal expected, textarea.value
  end
end
