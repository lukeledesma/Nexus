module ApplicationHelper
  include NexusUiHelper
  include MaterialIconsHelper

  # Wraps turbo-frame in .window-content plus the “not enough space” resize overlay (content-window controller).
  # +linked_app_save_picker:+ when true, stacks an iframe layer for Finder so the app turbo-frame is not replaced.
  def content_window_shell(linked_app_save_picker: false, &block)
    inner = capture(&block)
    render partial: "shared/content_window_window_content",
      locals: { inner: inner, linked_app_save_picker: linked_app_save_picker }
  end

  # Single source for launcher grid tiles: order, labels, icons, and click handlers.
  # Add rows here to grow the grid; CSS keeps 2 columns with wrap.
  def launcher_grid_entries
    [
      { window_key: "finder", pin_key: "finder", label: "Finder", icon: :folder },
      { window_key: "tasks", pin_key: "tasks", label: "Tasks", icon: :task_checklist },
      { window_key: "notes", pin_key: "notes", label: "Notes", icon: :edit_note },
      { window_key: "time-card", pin_key: "time-card", label: "Time Card", icon: :overview },
      { window_key: "calendar", pin_key: "calendar", label: "Calendar", icon: :calendar_month },
      { window_key: "images", pin_key: "images", label: "Images", icon: :wallpaper },
      { window_key: "audio", pin_key: "audio", label: "Audio", icon: :graphic_eq }
    ].freeze
  end

  # Finder / title bar: show names without known content extensions (on-disk type is implicit).
  def finder_document_display_title(title)
    s = title.to_s.strip
    return "Untitled" if s.blank?

    s.sub(/\.(txt|md|nexus|rtf|wav|aiff?|mp3|m4a|flac|ogg)\z/i, "").strip.presence || "Untitled"
  end

  def finder_asset_file_kind_from_extension(extension)
    ext = extension.to_s.downcase
    return "image" if Document::IMAGE_EXTENSIONS.include?(ext)
    return "audio" if Document::AUDIO_EXTENSIONS.include?(ext)

    "other"
  end

  def finder_file_icon_for_content_type(content_type, source_extension: nil, section_key: nil)
    section = section_key.to_s.strip.downcase
    case content_type.to_s
    when "note"
      return :overview if section == "time_card"
      :edit_note
    when "task_list" then :task_checklist
    when "asset"
      case finder_asset_file_kind_from_extension(source_extension)
      when "image" then :wallpaper
      when "audio" then :graphic_eq
      else :file_document
      end
    else :file_document
    end
  end

  # First-paint workspace chrome (avoids default theme flash before /workspace_preferences fetch).
  def workspace_theme_boot_html_attributes
    "".html_safe
  end

  def workspace_theme_boot_style_tag
    p = workspace_theme_boot_payload
    return "".html_safe if p.blank?

    css = WorkspaceThemeBoot.root_css_for_payload(p)
    return "".html_safe if css.blank?

    content_tag(:style, css.html_safe, id: "nexus-theme-boot")
  end

  def workspace_theme_boot_payload
    return @workspace_theme_boot_payload if defined?(@workspace_theme_boot_payload)

    @workspace_theme_boot_payload =
      begin
        if logged_in?
          WorkspaceThemeBoot.payload_for(current_user.username)
        end
      rescue StandardError
        nil
      end
  end

  # First-paint desktop image (starts fetch before Stimulus); black underlay while the asset loads.
  def workspace_desktop_boot_layer_attributes
    p = workspace_theme_boot_payload
    return "".html_safe unless p.is_a?(Hash)
    return "".html_safe unless p["wallpaper_background_kind"].to_s == "image"

    id = p["wallpaper_image_document_id"].to_i
    return "".html_safe unless id.positive?

    url = "/documents/#{id}/asset_file"
    attrs = +%( style="background-color:#000;background-image:url(#{url});background-size:cover;background-position:center;background-repeat:no-repeat;")
    attrs << %( data-nexus-wallpaper="image")
    attrs.html_safe
  end
end
