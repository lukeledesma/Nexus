# frozen_string_literal: true

# Ensure custom channels are loaded/reloaded in development so Action Cable can
# resolve subscription class names reliably after code changes.
Rails.application.config.to_prepare do
  require_dependency Rails.root.join("app/channels/application_cable/channel").to_s
  require_dependency Rails.root.join("app/channels/application_cable/connection").to_s
  require_dependency Rails.root.join("app/channels/user_sync_channel").to_s
end
