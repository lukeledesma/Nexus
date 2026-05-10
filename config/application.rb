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

    # Policies are used by service objects in production (eager_load=true).
    policies_path = Rails.root.join("app/policies")
    config.autoload_paths << policies_path
    config.eager_load_paths << policies_path

    # Updated folder structure to align with modern conventions
    # Added autoload paths for new folder structure
    config.autoload_paths += %W(
      #{Rails.root.join('app/services/finder')}
      #{Rails.root.join('app/services/document')}
    )

    # Disk sync is performed per-request in the controller, not at boot.
  end
end
