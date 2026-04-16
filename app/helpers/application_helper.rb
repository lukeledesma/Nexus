module ApplicationHelper
  include NexusUiHelper
  include MaterialIconsHelper

  # Wraps turbo-frame in .window-content plus the “not enough space” resize overlay (content-window controller).
  # +singular_save_picker:+ when true, stacks an iframe layer for Finder so the app turbo-frame is not replaced.
  def content_window_shell(singular_save_picker: false, &block)
    inner = capture(&block)
    render partial: "shared/content_window_window_content",
      locals: { inner: inner, singular_save_picker: singular_save_picker }
  end

  # Single source for launcher grid tiles: order, labels, icons, and click handlers.
  # Add rows here to grow the grid; CSS keeps 2 columns with wrap.
  def launcher_grid_entries
    [
      { window_key: "singular-task-list", pin_key: "singular-task-list", label: "TASKS", icon: :task_checklist },
      { window_key: "loops", pin_key: "loops", label: "AUDIO", icon: :graphic_eq },
      { window_key: "finder", pin_key: "finder", label: "FINDER", icon: :folder },
      { window_key: "settings", pin_key: "settings", label: "SETTINGS", icon: :settings }
    ].freeze
  end

  # Finder / title bar: show names without .txt/.rtf/.nexus (on-disk type is implicit).
  def finder_document_display_title(title)
    s = title.to_s.strip
    return "Untitled" if s.blank?

    s.sub(/\.(txt|nexus|rtf|wav|aiff?|mp3|m4a|flac|ogg)\z/i, "").strip.presence || "Untitled"
  end

  def finder_file_icon_for_content_type(content_type)
    case content_type.to_s
    when "note" then :file_document
    when "task_list" then :task_checklist
    when "asset" then :graphic_eq
    else :file_document
    end
  end

  # First-paint workspace chrome (avoids default theme flash before /workspace_preferences fetch).
  def workspace_theme_boot_html_attributes
    p = workspace_theme_boot_payload
    return "".html_safe if p.blank?
    return "".html_safe unless p["active_theme_id"].to_s == WorkspacePreferencesController::CLASSIC_THEME_ID

    ' data-nexus-theme="classic"'.html_safe
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
