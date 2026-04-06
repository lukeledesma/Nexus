# frozen_string_literal: true

module Apps
  class SettingsController < BaseController
    def show
      user_label = current_user.username.presence || current_user.email.to_s
      classic_ui = workspace_active_theme_id == "classic"

      @settings_sections = [
        { key: "user", label: user_label },
        { key: "saved_themes", label: "Saved Themes", icon: :palette },
        { key: "theme_studio", label: "Theme Studio", icon: :tune }
      ].freeze
      @settings_sections = @settings_sections.reject { |item| item[:key] == "theme_studio" } if classic_ui

      requested = params[:section].to_s
      allowed = @settings_sections.map { |item| item[:key] }
      @active_settings_section = allowed.include?(requested) ? requested : "saved_themes"
      @active_settings_section = "saved_themes" if classic_ui && requested == "theme_studio"

      render layout: false if turbo_frame_request?
    end

    private

    def workspace_embedded_dir
      u = current_user&.username.to_s.strip
      if u.present?
        Rails.root.join("storage", "workspace", u, "Embedded")
      else
        Rails.root.join("storage", "workspace", "Embedded")
      end
    end

    def workspace_active_theme_id
      path = workspace_embedded_dir.join("WorkspaceState.txt")
      return nil unless File.exist?(path)

      data = JSON.parse(File.read(path))
      data["active_theme_id"].to_s.presence
    rescue JSON::ParserError, Errno::ENOENT
      nil
    end
  end
end
