# frozen_string_literal: true

module Apps
  class SettingsController < BaseController
    def show
      user_label = current_user.username.presence || current_user.email.to_s
      @settings_sections = [
        { key: "user", label: user_label },
        { key: "saved_themes", label: "Saved Themes", icon: :palette }
      ].freeze
      requested = params[:section].to_s
      @active_settings_section = @settings_sections.map { |item| item[:key] }.include?(requested) ? requested : "saved_themes"

      render layout: false if turbo_frame_request?
    end
  end
end
