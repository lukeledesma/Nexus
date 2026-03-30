# frozen_string_literal: true

workspace_dir = Rails.root.join("storage", "workspace")
os_config_file = workspace_dir.join("OSConfig.txt")
legacy_windows_file = workspace_dir.join("Windows.txt")

unless File.exist?(os_config_file)
  FileUtils.mkdir_p(workspace_dir)

  rows = [
    "========= OS CONFIG =========",
    "",
    "[POSITIONS]",
    "",
    "  [POSITIONS.DEFAULTS]",
    "  windowKey | x | y | w | h | z | state",
    "  conversion-chart | 782 | 88 | 407 | 407 | 1506 | closed",
    "  db-health | 41 | 6 | 320 | 235 | 1501 | closed",
    "  timer | 376 | 196 | 320 | 250 | 1507 | closed",
    "  launcher | 376 | 6 | 320 | 180 | 1503 | closed",
    "  settings | 41 | 256 | 320 | 180 | 1502 | closed",
    "  singular-note | 711 | 6 | 407 | 407 | 1504 | closed",
    "  singular-task-list | 747 | 48 | 407 | 407 | 1505 | closed",
    "",
    "  [POSITIONS.CURRENT]",
    "  windowKey | x | y | w | h | z | state",
    "",
    "__________",
    "",
    "[HSB]",
    "",
    "  [HSB.DEFAULTS]",
    "  key | value",
    "  hue | 180",
    "  saturation | 0",
    "  brightness | 15",
    "  transparency | 0.15",
    "",
    "  [HSB.CURRENT]",
    "  key | value",
    "  hue | 180",
    "  saturation | 0",
    "  brightness | 15",
    "  transparency | 0.15"
  ]

  if File.exist?(legacy_windows_file)
    current_rows = File.readlines(legacy_windows_file, chomp: true)
      .map(&:strip)
      .reject { |line| line.empty? || line.start_with?("#") || line.start_with?("default|") }
      .filter_map do |line|
        user_id, window_key, x_raw, y_raw, open_raw = line.split("|", 5)
        next if user_id.blank? || window_key.blank?
        next_key = %w[stationary tools launcher].include?(window_key) ? "launcher" : window_key

        width, height = if %w[conversion-chart singular-note singular-task-list].include?(next_key)
          [407, 407]
        elsif next_key == "db-health"
          [320, 235]
        elsif next_key == "settings"
          [320, 125]
        elsif next_key == "launcher"
          [320, 180]
        else
          [407, 407]
        end

        z = if next_key == "db-health"
          1501
        elsif next_key == "settings"
          1502
        elsif next_key == "launcher"
          1503
        elsif next_key == "singular-note"
          1504
        elsif next_key == "singular-task-list"
          1505
        elsif next_key == "conversion-chart"
          1506
        else
          1500
        end

        open_value = open_raw.to_s.downcase == "open" ? "open" : "closed"
        "  #{next_key} | #{x_raw.to_i} | #{y_raw.to_i} | #{width} | #{height} | #{z} | #{open_value}"
      end

    rows.concat(current_rows)
  end

  File.write(os_config_file, rows.join("\n") + "\n")
end
