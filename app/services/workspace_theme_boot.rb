# frozen_string_literal: true

# Read-only workspace theme snapshot for first paint (matches /workspace_preferences + lib/nexus_workspace_chrome.js).
class WorkspaceThemeBoot
  CTRL = WorkspacePreferencesController

  class << self
    def payload_for(username)
      reader = disk_reader(username)
      return nil unless reader

      state = reader.send(:read_state_data)
      themes = reader.send(:ensure_default_theme, reader.send(:read_themes_data))
      active_theme_id = state["active_theme_id"].presence || CTRL::DEFAULT_THEME_ID
      active_theme = themes.find { |theme| theme["id"] == active_theme_id }

      if active_theme.blank?
        active_theme_id = CTRL::DEFAULT_THEME_ID
        active_theme = themes.find { |theme| theme["id"] == CTRL::DEFAULT_THEME_ID }
        state["active_theme_id"] = active_theme_id
      end

      user = User.find_by(username: username.to_s.strip)
      if user && active_theme
        wp_dirty, th_dirty = reader.send(:sync_state_wallpaper_from_theme!, themes, state, active_theme, user: user)
        reader.send(:write_state_data, state) if wp_dirty
        reader.send(:write_themes_data, themes) if th_dirty
      end

      appearance = reader.send(
        :normalize_appearance,
        active_theme&.dig("appearance") || CTRL::DEFAULT_APPEARANCE
      )

      is_custom_layout = active_theme_id == CTRL::CUSTOM_THEME_ID
      active_theme_name = if is_custom_layout
        CTRL::CUSTOM_THEME_NAME
      else
        active_theme&.dig("name").presence || CTRL::DEFAULT_THEME_NAME
      end

      {
        "active_theme_id" => active_theme_id,
        "appearance" => appearance,
        "active_theme_name" => active_theme_name,
        "is_custom_layout" => is_custom_layout,
        "gradient_source_theme_id" => state["gradient_source_theme_id"],
        "gradient_source_theme_name" => state["gradient_source_theme_name"],
        "wallpaper_background_kind" => state["wallpaper_background_kind"],
        "wallpaper_image_document_id" => state["wallpaper_image_document_id"],
        "wallpaper_gradient_theme_id" => state["wallpaper_gradient_theme_id"],
        "wallpaper_gradient_theme_name" => state["wallpaper_gradient_theme_name"]
      }
    end

    # Saved-theme rows for Settings → Wallpaper → Gradient (same IDs as Saved Themes hub).
    def wallpaper_gradient_picker_for(username)
      reader = disk_reader(username)
      empty = {
        themes: [],
        row_unsaved: false,
        chrome_status_text: CTRL::DEFAULT_THEME_NAME
      }
      return empty unless reader

      state = reader.send(:read_state_data)
      themes = reader.send(:ensure_default_theme, reader.send(:read_themes_data))
      summaries = reader.send(:theme_summaries, themes)

      active_id = state["active_theme_id"].presence || CTRL::DEFAULT_THEME_ID
      is_custom = active_id == CTRL::CUSTOM_THEME_ID

      chrome_status_text =
        if is_custom
          "Unsaved Theme"
        else
          themes.find { |t| t["id"] == active_id }&.dig("name").presence || CTRL::DEFAULT_THEME_NAME
        end

      {
        themes: summaries,
        row_unsaved: is_custom,
        chrome_status_text: chrome_status_text
      }
    end

    def root_css_for_payload(payload)
      return +"" unless payload.is_a?(Hash)

      modern_root_css(
        payload["appearance"] || {},
        wallpaper_image_first_paint: wallpaper_image_boot_active?(payload)
      )
    end

    private

    def wallpaper_image_boot_active?(payload)
      payload.is_a?(Hash) &&
        payload["wallpaper_background_kind"].to_s == "image" &&
        payload["wallpaper_image_document_id"].to_i.positive?
    end

    def disk_reader(username)
      ctrl = CTRL.allocate
      ctrl.define_singleton_method(:workspace_storage_dir) do
        u = username.to_s.strip
        if u.present?
          CTRL::STORAGE_ROOT.join(u, "Embedded")
        else
          CTRL::STORAGE_ROOT.join("Embedded")
        end
      end
      ctrl
    end

    def modern_root_css(a, wallpaper_image_first_paint: false)
      hue = clamp_i(a["hue"], 0, 360, CTRL::DEFAULT_APPEARANCE["hue"])
      saturation = clamp_i(a["saturation"], 0, 100, CTRL::DEFAULT_APPEARANCE["saturation"])
      brightness = clamp_i(a["brightness"], 0, 100, CTRL::DEFAULT_APPEARANCE["brightness"])
      alpha = clamp_f(a["transparency"], 0.15, 1, CTRL::DEFAULT_APPEARANCE["transparency"])

      # Wallpaper gradient mode is removed; desktop fallback is pure black.
      # Image wallpapers still override via `syncNexusDesktopWallpaper`.
      c1h = 0
      c1s = 0
      c1b = 0
      c2h = 0
      c2s = 0
      c2b = 0
      angle = 180

      font1 = clamp_i(a["font_1"], 0, 100, CTRL::DEFAULT_APPEARANCE["font_1"])
      font1_alpha = clamp_i(a["font_1_alpha"], 0, 100, CTRL::DEFAULT_APPEARANCE["font_1_alpha"])
      font2 = clamp_i(a["font_2"], 0, 100, CTRL::DEFAULT_APPEARANCE["font_2"])
      font2_alpha = clamp_i(a["font_2_alpha"], 0, 100, CTRL::DEFAULT_APPEARANCE["font_2_alpha"])

      <<~CSS.strip
        :root {
          --window-bg-h: #{hue};
          --window-bg-saturation: #{saturation}%;
          --window-bg-brightness: #{brightness}%;
          --window-bg-alpha: #{format("%.2f", alpha)};
          --window-ui-hue: #{hue};
          --window-ui-saturation: #{saturation}%;
          --window-ui-brightness: #{brightness}%;
          --desktop-bg-1-hue: #{c1h};
          --desktop-bg-1-saturation: #{c1s}%;
          --desktop-bg-1-brightness: #{c1b}%;
          --desktop-bg-2-hue: #{c2h};
          --desktop-bg-2-saturation: #{c2s}%;
          --desktop-bg-2-brightness: #{c2b}%;
          --desktop-bg-angle: #{angle}deg;
          --font-1-tone: #{font1};
          --font-1-alpha: #{format("%.2f", font1_alpha / 100.0)};
          --font-2-tone: #{font2};
          --font-2-alpha: #{format("%.2f", font2_alpha / 100.0)};
        }
      CSS
    end

    def clamp_i(value, min, max, fallback)
      parsed = Integer(value)
      return min if parsed < min
      return max if parsed > max

      parsed
    rescue ArgumentError, TypeError
      fallback
    end

    def clamp_f(value, min, max, fallback)
      parsed = Float(value)
      return min if parsed < min
      return max if parsed > max

      parsed
    rescue ArgumentError, TypeError
      fallback
    end
  end
end
