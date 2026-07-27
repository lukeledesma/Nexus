ENV["RAILS_ENV"] ||= "test"
require_relative "../config/environment"
require "rails/test_help"
require "fileutils"

module ActiveSupport
  class TestCase
    # Run tests in parallel with specified workers
    parallelize(workers: :number_of_processors)

    # Setup all fixtures in test/fixtures/*.yml for all tests in alphabetical order.
    fixtures :all

    # Add more helper methods to be used by all tests here...
    private

    def before_setup
      cleanup_test_storage_root!
      super
    end

    def after_teardown
      super
      cleanup_test_storage_root!
    end

    def cleanup_test_storage_root!
      root = DocumentStorageSyncLite.storage_root
      FileUtils.rm_rf(root)
      FileUtils.mkdir_p(root)
    end
  end
end
