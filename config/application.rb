require_relative "boot"

require "rails/all"

Bundler.require(*Rails.groups)

module Nexus
  class Application < Rails::Application
    config.load_defaults 8.1

    config.autoload_lib(ignore: %w[assets tasks])

    # Load services in both development and eager-load contexts.
    services_path = Rails.root.join("app/services")
    config.autoload_paths << services_path
    config.eager_load_paths << services_path

    # Disk sync is performed per-request in the controller, not at boot.
  end
end
