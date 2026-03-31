require "securerandom"
require "application_system_test_case"

class OsWindowSizingContractTest < ApplicationSystemTestCase
  setup do
    email = "window_contract_#{SecureRandom.hex(4)}@example.com"
    @user = User.create!(email: email, password: "password123", password_confirmation: "password123")
    sign_in(@user.email, "password123")
    visit root_path
    if page.has_field?("email", wait: 1) && page.has_field?("password", wait: 1)
      sign_in(@user.email, "password123")
      visit root_path
    end
    visit root_path unless page.has_css?(".app-dock-button--launcher", wait: 3)

    unless page.has_css?(".app-dock-button--launcher", wait: 5)
      skip("Desktop UI unavailable in system test environment")
    end
  end

  teardown do
    Capybara.reset_sessions!
    User.where(id: @user&.id).delete_all
  end

  test "launcher remeasures on open and grows and shrinks with content" do
    page.execute_script(<<~JS)
      const win = document.getElementById("organizer-window")
      if (!win) return
      win.classList.remove("is-hidden")
      win.style.height = "24px"
    JS

    wait_until { !window_hidden?("#organizer-window") }
    wait_until { window_height("#organizer-window") > 24 }
    initial_height = window_height("#organizer-window")

    page.execute_script(<<~JS)
      const grid = document.querySelector(".organizer-tools-grid")
      if (!grid) return

      for (let index = 1; index <= 2; index += 1) {
        const probe = document.createElement("button")
        probe.type = "button"
        probe.id = `launcher-sizing-probe-${index}`
        probe.className = "os-window-card"
        probe.innerHTML = `<div class="os-window-card-content"><dt class="os-window-card-label">TEST ${index}</dt><dd class="os-window-card-value">growth</dd></div>`
        grid.appendChild(probe)
      }
    JS

    wait_until { window_height("#organizer-window") > initial_height + 10 }
    grown_height = window_height("#organizer-window")

    page.execute_script(<<~JS)
      document.getElementById("launcher-sizing-probe-1")?.remove()
      document.getElementById("launcher-sizing-probe-2")?.remove()
    JS

    wait_until { (window_height("#organizer-window") - content_shell_height(".organizer-panel")).abs <= 8 }
    shrunk_height = window_height("#organizer-window")
    content_height = content_shell_height(".organizer-panel")

    assert_operator initial_height, :>, 24, "expected launcher window to ignore stale inline height when shown"
    assert_operator grown_height, :>, initial_height, "expected launcher window to grow when launcher content grows"
    assert_operator shrunk_height, :<=, grown_height, "expected launcher window not to remain at its expanded height after launcher content shrinks"
    assert_in_delta content_height, shrunk_height, 8, "expected launcher height to wrap organizer panel after content shrinks"
  end

  test "settings remeasures on open and grows and shrinks with content" do
    verify_os_window_contract(
      button_selector: ".app-dock-button--settings",
      window_selector: ".settings-window",
      content_selector: ".settings-panel",
      open_window: nil,
      grow_content: lambda {
        page.execute_script(<<~JS)
          const panel = document.querySelector(".settings-panel")
          if (!panel) return

          panel.dataset.testPaddingBottom = panel.style.paddingBottom || ""
          panel.style.paddingBottom = "140px"
        JS
      },
      shrink_content: lambda {
        page.execute_script(<<~JS)
          const panel = document.querySelector(".settings-panel")
          if (!panel) return
          panel.style.paddingBottom = panel.dataset.testPaddingBottom || ""
          delete panel.dataset.testPaddingBottom
        JS
      }
    )
  end

  test "db health remeasures on open and grows and shrinks with content" do
    verify_os_window_contract(
      button_selector: ".app-dock-button--db-health",
      window_selector: ".db-health-window",
      content_selector: ".db-health-panel",
      open_window: nil,
      grow_content: lambda {
        page.execute_script(<<~JS)
          const panel = document.querySelector(".db-health-panel")
          if (!panel) return

          panel.dataset.testPaddingBottom = panel.style.paddingBottom || ""
          panel.style.paddingBottom = "140px"
        JS
      },
      shrink_content: lambda {
        page.execute_script(<<~JS)
          const panel = document.querySelector(".db-health-panel")
          if (!panel) return
          panel.style.paddingBottom = panel.dataset.testPaddingBottom || ""
          delete panel.dataset.testPaddingBottom
        JS
      }
    )
  end

  private

  def sign_in(email, password)
    visit login_path
    fill_in "email", with: email
    fill_in "password", with: password
    click_on "Sign In"
  end

  def verify_os_window_contract(button_selector:, window_selector:, content_selector:, open_window:, grow_content:, shrink_content:)
    page.execute_script("const win = document.querySelector(#{window_selector.to_json}); if (win) win.style.height = '24px';")

    if open_window.respond_to?(:call)
      open_window.call
    else
      find(button_selector, visible: :all).click
    end
    wait_until { !window_hidden?(window_selector) }
    wait_until { window_height(window_selector) > 24 }

    synced_height = window_height(window_selector)
    assert_operator synced_height, :>, 24, "expected #{window_selector} to ignore stale inline height on open"

    initial_height = synced_height
    grow_content.call

    wait_until { window_height(window_selector) > initial_height + 10 }
    grown_height = window_height(window_selector)
    assert_operator grown_height, :>, initial_height, "expected #{window_selector} to grow when content grows"

    shrink_content.call

    wait_until { window_height(window_selector) < grown_height - 10 }
    shrunk_height = window_height(window_selector)
    assert_in_delta initial_height, shrunk_height, 8, "expected #{window_selector} to shrink back when content shrinks"

    content_height = content_shell_height(content_selector)
    assert_in_delta content_height, shrunk_height, 8, "expected #{window_selector} height to wrap #{content_selector}"
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

  def window_height(selector)
    page.evaluate_script(<<~JS)
      (() => {
        const win = document.querySelector(#{selector.to_json})
        if (!win) return 0
        return Math.ceil(win.getBoundingClientRect().height)
      })()
    JS
  end

  def content_shell_height(selector)
    page.evaluate_script(<<~JS)
      (() => {
        const content = document.querySelector(#{selector.to_json})
        if (!content) return 0
        return Math.max(Math.ceil(content.getBoundingClientRect().height), Math.ceil(content.scrollHeight))
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