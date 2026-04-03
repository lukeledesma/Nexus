# frozen_string_literal: true

module Apps
  class SettingsController < BaseController
    def show
      @settings_sections = [
        { key: "saved_themes", label: "Saved Themes", icon: :tune },
        { key: "user", label: "User", icon: :account_circle }
      ].sort_by { |item| item[:label].to_s.downcase }.freeze
      requested = params[:section].to_s
      @active_settings_section = @settings_sections.map { |item| item[:key] }.include?(requested) ? requested : "saved_themes"

      render layout: false if turbo_frame_request?
    end
  end
end
