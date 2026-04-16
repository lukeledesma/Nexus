# frozen_string_literal: true

module Apps
  class SettingsController < BaseController
    def show
      user_label = current_user.username.presence || current_user.email.to_s

      @settings_sections = [
        { key: "user", label: user_label },
        { key: "wallpaper", label: "Wallpaper", icon: :wallpaper },
        { key: "saved_themes", label: "Shell", icon: :palette }
      ].freeze

      requested = params[:section].to_s
      allowed = @settings_sections.map { |item| item[:key] }
      @active_settings_section = allowed.include?(requested) ? requested : "wallpaper"

      if @active_settings_section == "wallpaper"
        assign_wallpaper_picker_state
        assign_wallpaper_iimage_state
      end

      render layout: false if turbo_frame_request?
    end

    private

    def assign_wallpaper_picker_state
      @wallpaper_picker = { kind: nil, image_document_id: 0 }

      return unless logged_in?

      boot = WorkspaceThemeBoot.payload_for(current_user.username)
      @wallpaper_picker = wallpaper_picker_view_model(boot)
    rescue StandardError
      @wallpaper_picker = { kind: nil, image_document_id: 0 }
    end

    def wallpaper_picker_view_model(boot)
      h = boot.is_a?(Hash) ? boot : {}
      img = h["wallpaper_image_document_id"]
      img_i = img.present? ? img.to_i : 0
      {
        kind: h["wallpaper_background_kind"].to_s.presence,
        image_document_id: img_i.positive? ? img_i : 0
      }
    end

    def assign_wallpaper_iimage_state
      @wallpaper_iimage_folder = nil
      @wallpaper_iimage_files = []
      return unless logged_in?

      DocumentDiskLoader.sync!
      @wallpaper_iimage_folder = EmbeddedIimageFolder.document_for(current_user)
      if @wallpaper_iimage_folder.blank?
        return
      end

      list =
        @wallpaper_iimage_folder.children.files.where(content_type: "asset").order(Arel.sql("LOWER(title) ASC"))
      @wallpaper_iimage_files = list.select { |f| EmbeddedIimageFolder.eligible_asset?(f) }
    rescue StandardError
      @wallpaper_iimage_folder = nil
      @wallpaper_iimage_files = []
    end

  end
end
