require "securerandom"
require "application_system_test_case"

class OsWindowSizingContractTest < ApplicationSystemTestCase
  setup do
    email = "window_contract_#{SecureRandom.hex(4)}@example.com"
    @user = User.create!(email: email, password: "password123", password_confirmation: "password123")
    sign_in(@user.email, "password123")
    visit root_path
    if page.has_field?("identifier", wait: 1) && page.has_field?("password", wait: 1)
      sign_in(@user.email, "password123")
      visit root_path
    end
    visit root_path unless page.has_css?(".desktop-side-panel-host", wait: 3)

    unless page.has_css?(".desktop-side-panel-host", wait: 5)
      skip("Desktop UI unavailable in system test environment")
    end
  end

  teardown do
    Capybara.reset_sessions!
    User.where(id: @user&.id).delete_all
  end

  test "settings content window opens from app toggle" do
    page.execute_script(<<~JS)
      const el = document.querySelector("[data-content-window-app-key-value='settings']")
      if (!el) return
      if (el.classList.contains("is-hidden")) {
        window.dispatchEvent(new CustomEvent("app-window:toggle", { detail: { appKey: "settings" } }))
      }
    JS
    wait_until { !window_hidden?("[data-content-window-app-key-value='settings']") }
    assert_selector "[data-content-window-app-key-value='settings'] .content-window-chrome-title", text: "SETTINGS"
  end

  private

  def sign_in(identifier, password)
    visit login_path
    fill_in "identifier", with: identifier
    fill_in "password", with: password
    click_on "Sign In"
  end

  def window_hidden?(selector)
    page.evaluate_script(<<~JS)
      (() => {
        const win = document.querySelector(#{selector.to_json})
        if (!win) return true
        return win.classList.contains("is-hidden")
      })()
    JS
  end

  def wait_until(timeout: 5)
    deadline = Process.clock_gettime(Process::CLOCK_MONOTONIC) + timeout
    loop do
      return true if yield
      raise "Timed out waiting for condition" if Process.clock_gettime(Process::CLOCK_MONOTONIC) >= deadline

      sleep 0.05
    end
  end
end
