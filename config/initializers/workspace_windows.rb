# frozen_string_literal: true

require "json"

workspace_dir = Rails.root.join("storage", "workspace")
workspace_state_file = workspace_dir.join("WorkspaceState.txt")
layout_themes_file = workspace_dir.join("LayoutThemes.txt")

FileUtils.mkdir_p(workspace_dir)

unless File.exist?(workspace_state_file)
  state_payload = {
    "active_theme_id" => "default",
    "windows" => {
      "conversion-chart" => { "x" => 782, "y" => 88, "width" => 407, "height" => 407, "z" => 1506, "open" => true },
      "db-health" => { "x" => 41, "y" => 6, "width" => 320, "height" => 235, "z" => 1501, "open" => true },
      "launcher" => { "x" => 376, "y" => 6, "width" => 320, "height" => 180, "z" => 1503, "open" => true },
      "settings" => { "x" => 41, "y" => 256, "width" => 320, "height" => 180, "z" => 1502, "open" => true },
      "theme-builder" => { "x" => 41, "y" => 256, "width" => 760, "height" => 430, "z" => 1508, "open" => false },
      "singular-note" => { "x" => 711, "y" => 6, "width" => 407, "height" => 407, "z" => 1504, "open" => true },
      "singular-task-list" => { "x" => 747, "y" => 48, "width" => 407, "height" => 407, "z" => 1505, "open" => true },
      "timer" => { "x" => 376, "y" => 196, "width" => 320, "height" => 250, "z" => 1507, "open" => true }
    },
    "appearance" => {
      "hue" => 180,
      "saturation" => 0,
      "brightness" => 15,
      "transparency" => 0.15,
      "color_1_hue" => 240,
      "color_1_saturation" => 28,
      "color_1_brightness" => 14,
      "color_2_hue" => 213,
      "color_2_saturation" => 73,
      "color_2_brightness" => 22,
      "angle" => 135
    }
  }

  File.write(workspace_state_file, JSON.pretty_generate(state_payload) + "\n")
end

unless File.exist?(layout_themes_file)
  themes_payload = {
    "themes" => [
      {
        "id" => "default",
        "name" => "Default",
        "locked" => true,
        "appearance" => {
          "hue" => 180,
          "saturation" => 0,
          "brightness" => 15,
          "transparency" => 0.15,
          "color_1_hue" => 240,
          "color_1_saturation" => 28,
          "color_1_brightness" => 14,
          "color_2_hue" => 213,
          "color_2_saturation" => 73,
          "color_2_brightness" => 22,
          "angle" => 135
        }
      }
    ]
  }

  File.write(layout_themes_file, JSON.pretty_generate(themes_payload) + "\n")
end
