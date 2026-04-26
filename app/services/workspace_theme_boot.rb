# frozen_string_literal: true

# Read-only workspace theme snapshot for first paint (matches /workspace_preferences + lib/nexus_workspace_chrome.js).
class WorkspaceThemeBoot
  MANAGER = WorkspacePreferences::Manager

  class << self
    def payload_for(username)
      manager_for_username(username)&.wallpaper_state_for_boot
    end

    # Saved-theme rows for Settings → Wallpaper → Gradient (same IDs as Saved Themes hub).
    def wallpaper_gradient_picker_for(username)
      empty = {
        themes: [],
        row_unsaved: false,
        chrome_status_text: MANAGER::DEFAULT_THEME_NAME
      }
      manager = manager_for_username(username)
      return empty unless manager

      manager.theme_picker_payload
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

    def manager_for_username(username)
      user = User.find_by(username: username.to_s.strip)
      MANAGER.new(user: user)
    end

    def modern_root_css(a, wallpaper_image_first_paint: false)
      hue = clamp_i(a["hue"], 0, 360, MANAGER::DEFAULT_APPEARANCE["hue"])
      saturation = clamp_i(a["saturation"], 0, 100, MANAGER::DEFAULT_APPEARANCE["saturation"])
      brightness = clamp_i(a["brightness"], 0, 100, MANAGER::DEFAULT_APPEARANCE["brightness"])
      alpha = clamp_f(a["transparency"], 0.15, 1, MANAGER::DEFAULT_APPEARANCE["transparency"])

      # Wallpaper gradient mode is removed; desktop fallback is pure black.
      # Image wallpapers still override via `syncNexusDesktopWallpaper`.
      c1h = 0
      c1s = 0
      c1b = 0
      c2h = 0
      c2s = 0
      c2b = 0
      angle = 180

      font1 = clamp_i(a["font_1"], 0, 100, MANAGER::DEFAULT_APPEARANCE["font_1"])
      font1_alpha = clamp_i(a["font_1_alpha"], 0, 100, MANAGER::DEFAULT_APPEARANCE["font_1_alpha"])
      font2 = clamp_i(a["font_2"], 0, 100, MANAGER::DEFAULT_APPEARANCE["font_2"])
      font2_alpha = clamp_i(a["font_2_alpha"], 0, 100, MANAGER::DEFAULT_APPEARANCE["font_2_alpha"])

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
