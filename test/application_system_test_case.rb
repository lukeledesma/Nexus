require "test_helper"

class ApplicationSystemTestCase < ActionDispatch::SystemTestCase
  fixtures
  self.fixture_table_names = []
  self.use_transactional_tests = false
  driven_by :selenium, using: :headless_chrome, screen_size: [1400, 900]
end
