# frozen_string_literal: true

# Stores and retrieves workspace layout in a shared text file:
# storage/workspace/OSConfig.txt
#
# File format:
# ========= OS CONFIG =========
#
# [POSITIONS]
#
#   [POSITIONS.DEFAULTS]
#   # windowKey | x | y | w | h | z | state
#   conversion-chart | 782 | 88 | 407 | 407 | 1506 | closed
#
#   [POSITIONS.CURRENT]
#   # windowKey | x | y | w | h | z | state
#   conversion-chart | 790 | 96 | 407 | 407 | 1506 | open
class WorkspacePreferencesController < ApplicationController
  STORAGE_DIR = Rails.root.join("storage", "workspace").freeze
  OS_CONFIG_FILE = STORAGE_DIR.join("OSConfig.txt").freeze
  LEGACY_WINDOWS_FILE = STORAGE_DIR.join("Windows.txt").freeze

  DEFAULT_WINDOWS = {
    "db-health" => { "x" => 41, "y" => 6, "width" => 320, "height" => 235, "z" => 1501, "open" => false },
    "settings" => { "x" => 41, "y" => 256, "width" => 320, "height" => 180, "z" => 1502, "open" => false },
    "launcher" => { "x" => 376, "y" => 6, "width" => 320, "height" => 180, "z" => 1503, "open" => false },
    "singular-note" => { "x" => 711, "y" => 6, "width" => 407, "height" => 407, "z" => 1504, "open" => false },
    "singular-task-list" => { "x" => 747, "y" => 48, "width" => 407, "height" => 407, "z" => 1505, "open" => false },
    "conversion-chart" => { "x" => 782, "y" => 88, "width" => 407, "height" => 407, "z" => 1506, "open" => false },
    "timer" => { "x" => 376, "y" => 196, "width" => 320, "height" => 250, "z" => 1507, "open" => false }
  }.freeze

  DEFAULT_APPEARANCE = {
    "hue" => 180,
    "saturation" => 0,
    "brightness" => 15,
    "transparency" => 0.15
  }.freeze

  def show
    render json: {
      "windows" => read_rows_for_user,
      "appearance" => read_appearance_for_user
    }
  end

  def update
    incoming = normalize_windows_payload(params[:windows])
    merged_windows = read_rows_for_user.deep_merge(incoming)
    merged_appearance = read_appearance_for_user.merge(normalize_appearance_payload(params[:appearance]))
    rewrite_config(merged_windows, merged_appearance)
    render json: { ok: true }
  end

  def destroy
    rewrite_config({}, DEFAULT_APPEARANCE)
    render json: { ok: true }
  end

  private

  def read_rows_for_user
    current_rows = parse_os_config_current_rows
    normalize_rows_with_defaults(DEFAULT_WINDOWS.deep_merge(current_rows))
  end

  def parse_os_config_current_rows
    ensure_os_config_file

    rows = {}
    in_current = false

    File.readlines(OS_CONFIG_FILE, chomp: true).each do |line|
      stripped = line.to_s.strip
      next if stripped.blank? || stripped.start_with?("#")

      if stripped.start_with?("[")
        upper = stripped.upcase
        in_current = upper == "[POSITIONS.CURRENT]" || upper == "[WINDOWS.CURRENT]"
        next
      end

      next unless in_current

      tokens = stripped.split("|").map { |token| token.to_s.strip }
      next if tokens.empty?

      # Backward compatibility with previous formats:
      # user_id | window_key | x | y | width | height | state
      # window_key | x | y | width | height | state
      # window_key | x | y | width | height | z|l | state
      if tokens[0].match?(/^\d+$/) && tokens.length >= 8
        window_key, x_raw, y_raw, width_raw, height_raw, z_raw, open_raw = tokens[1, 7]
      elsif tokens[0].match?(/^\d+$/) && tokens.length >= 7
        window_key, x_raw, y_raw, width_raw, height_raw, open_raw = tokens[1, 6]
        z_raw = nil
      elsif tokens.length >= 7
        window_key, x_raw, y_raw, width_raw, height_raw, z_raw, open_raw = tokens[0, 7]
      elsif tokens.length >= 6
        window_key, x_raw, y_raw, width_raw, height_raw, open_raw = tokens[0, 6]
        z_raw = nil
      else
        next
      end

      next if window_key.blank?
      raw_window_key = window_key.to_s
      window_key = canonical_window_key(window_key)
      next unless DEFAULT_WINDOWS.key?(window_key)
      next if window_key == "launcher" && raw_window_key == "tools" && rows.key?("launcher")

      rows[window_key] = {
        "x" => Integer(x_raw),
        "y" => Integer(y_raw),
        "width" => Integer(width_raw),
        "height" => Integer(height_raw),
        "z" => integer_or_default(z_raw, DEFAULT_WINDOWS[window_key]["z"]),
        "open" => open_raw.to_s.downcase == "open"
      }
    rescue ArgumentError
      next
    end

    rows
  end

  def read_appearance_for_user
    normalize_appearance(parse_os_config_appearance)
  end

  def parse_os_config_appearance
    ensure_os_config_file

    in_hsb_current = false
    appearance = {}

    File.readlines(OS_CONFIG_FILE, chomp: true).each do |line|
      stripped = line.to_s.strip
      next if stripped.blank? || stripped.start_with?("#")

      if stripped.start_with?("[")
        upper = stripped.upcase
        in_hsb_current = upper == "[HSB.CURRENT]" || upper == "[HSB]"
        next
      end

      next unless in_hsb_current

      key, value = if stripped.include?("|")
        tokens = stripped.split("|", 2).map { |token| token.to_s.strip }
        [tokens[0], tokens[1]]
      elsif stripped.include?(":")
        tokens = stripped.split(":", 2).map { |token| token.to_s.strip }
        [tokens[0], tokens[1]]
      else
        [nil, nil]
      end

      next if key.blank? || value.blank?

      normalized_key = key.to_s.downcase
      next unless DEFAULT_APPEARANCE.key?(normalized_key)

      appearance[normalized_key] = Float(value)
    rescue ArgumentError, TypeError
      next
    end

    appearance
  end

  def normalize_appearance_payload(raw)
    payload = if raw.respond_to?(:to_unsafe_h)
      raw.to_unsafe_h
    elsif raw.respond_to?(:to_h)
      raw.to_h
    else
      {}
    end

    return {} if payload.blank?

    keyed = payload.transform_keys { |key| key.to_s.downcase }
    normalized = {}

    if keyed.key?("hue")
      normalized["hue"] = clamp_integer(keyed["hue"], 0, 360, DEFAULT_APPEARANCE["hue"])
    end

    if keyed.key?("saturation")
      normalized["saturation"] = clamp_integer(keyed["saturation"], 0, 100, DEFAULT_APPEARANCE["saturation"])
    end

    if keyed.key?("brightness")
      normalized["brightness"] = clamp_integer(keyed["brightness"], 0, 100, DEFAULT_APPEARANCE["brightness"])
    end

    if keyed.key?("transparency")
      normalized["transparency"] = clamp_float(keyed["transparency"], 0.15, 0.95, DEFAULT_APPEARANCE["transparency"])
    end

    normalized
  end

  def normalize_appearance(raw)
    input = if raw.respond_to?(:transform_keys)
      raw.transform_keys { |key| key.to_s.downcase }
    else
      {}
    end

    {
      "hue" => clamp_integer(input["hue"], 0, 360, DEFAULT_APPEARANCE["hue"]),
      "saturation" => clamp_integer(input["saturation"], 0, 100, DEFAULT_APPEARANCE["saturation"]),
      "brightness" => clamp_integer(input["brightness"], 0, 100, DEFAULT_APPEARANCE["brightness"]),
      "transparency" => clamp_float(input["transparency"], 0.15, 0.95, DEFAULT_APPEARANCE["transparency"])
    }
  end

  def normalize_windows_payload(raw_windows)
    windows = if raw_windows.respond_to?(:to_unsafe_h)
      raw_windows.to_unsafe_h
    elsif raw_windows.respond_to?(:to_h)
      raw_windows.to_h
    else
      {}
    end

    windows.each_with_object({}) do |(window_key, state), normalized|
      next unless state.respond_to?(:to_h)
      canonical_key = canonical_window_key(window_key)
      next unless DEFAULT_WINDOWS.key?(canonical_key)

      state_hash = state.respond_to?(:to_unsafe_h) ? state.to_unsafe_h : state.to_h
      open_value = state_hash[:open]
      open_value = state_hash["open"] if open_value.nil?

      defaults = DEFAULT_WINDOWS[canonical_key] || {
        "x" => 41, "y" => 6, "width" => 407, "height" => 407, "z" => 1500, "open" => false
      }

      z_value = state_hash[:z] || state_hash["z"] || state_hash[:layer] || state_hash["layer"]

      normalized[canonical_key] = {
        "x" => integer_or_default(state_hash[:x] || state_hash["x"], defaults["x"]),
        "y" => integer_or_default(state_hash[:y] || state_hash["y"], defaults["y"]),
        "width" => integer_or_default(state_hash[:width] || state_hash["width"], defaults["width"]),
        "height" => integer_or_default(state_hash[:height] || state_hash["height"], defaults["height"]),
        "z" => integer_or_default(z_value, defaults["z"]),
        "open" => ActiveModel::Type::Boolean.new.cast(open_value)
      }
    end
  end

  def rewrite_config(user_windows, appearance = DEFAULT_APPEARANCE)
    current_rows = normalize_rows_with_defaults(DEFAULT_WINDOWS.deep_merge(user_windows))
    current_appearance = normalize_appearance(appearance)
    write_os_config_file(current_rows, current_appearance)
  end

  def write_os_config_file(current_rows, appearance)
    FileUtils.mkdir_p(STORAGE_DIR)

    output = []
    output << "========= OS CONFIG ========="
    output << ""
    output << "[POSITIONS]"
    output << ""
    output << "  [POSITIONS.DEFAULTS]"
    output << "  windowKey | x | y | w | h | z | state"

    DEFAULT_WINDOWS.keys.sort.each do |window_key|
      output << "  #{format_row(window_key, DEFAULT_WINDOWS[window_key])}"
    end

    output << ""
    output << "  [POSITIONS.CURRENT]"
    output << "  windowKey | x | y | w | h | z | state"

    current_rows.keys.sort.each do |window_key|
      output << "  #{format_row(window_key, current_rows[window_key])}"
    end

    output << ""
    output << "__________"
    output << ""
    output << "[HSB]"
    output << ""
    output << "  [HSB.DEFAULTS]"
    output << "  key | value"
    output << "  hue | #{DEFAULT_APPEARANCE["hue"]}"
    output << "  saturation | #{DEFAULT_APPEARANCE["saturation"]}"
    output << "  brightness | #{DEFAULT_APPEARANCE["brightness"]}"
    output << "  transparency | #{format("%.2f", DEFAULT_APPEARANCE["transparency"])}"
    output << ""
    output << "  [HSB.CURRENT]"
    output << "  key | value"
    output << "  hue | #{appearance["hue"]}"
    output << "  saturation | #{appearance["saturation"]}"
    output << "  brightness | #{appearance["brightness"]}"
    output << "  transparency | #{format("%.2f", appearance["transparency"])}"

    File.write(OS_CONFIG_FILE, output.join("\n") + "\n")
  end

  def ensure_os_config_file
    FileUtils.mkdir_p(STORAGE_DIR)
    return if File.exist?(OS_CONFIG_FILE)

    if File.exist?(LEGACY_WINDOWS_FILE)
      write_os_config_file(parse_legacy_windows_rows, DEFAULT_APPEARANCE)
    else
      write_os_config_file({}, DEFAULT_APPEARANCE)
    end
  end

  def parse_legacy_windows_rows
    rows = {}

    File.readlines(LEGACY_WINDOWS_FILE, chomp: true).each do |line|
      stripped = line.to_s.strip
      next if stripped.blank? || stripped.start_with?("#")

      user_id, window_key, x_raw, y_raw, open_raw = stripped.split("|", 5)
      next if user_id.blank? || window_key.blank?
      next if user_id == "default"
      next unless user_id.to_s == current_user.id.to_s

      raw_window_key = window_key.to_s
      window_key = canonical_window_key(window_key)
      next unless DEFAULT_WINDOWS.key?(window_key)
      next if window_key == "launcher" && raw_window_key == "tools" && rows.key?("launcher")

      defaults = DEFAULT_WINDOWS[window_key] || {
        "x" => 41, "y" => 6, "width" => 407, "height" => 407, "z" => 1500, "open" => false
      }

      rows[window_key] = {
        "x" => integer_or_default(x_raw, defaults["x"]),
        "y" => integer_or_default(y_raw, defaults["y"]),
        "width" => defaults["width"],
        "height" => defaults["height"],
        "z" => defaults["z"],
        "open" => open_raw.to_s.downcase == "open"
      }
    end

    rows
  end

  def normalize_rows_with_defaults(rows)
    rows.each_with_object({}) do |(window_key, state), normalized|
      next unless DEFAULT_WINDOWS.key?(window_key)

      default_state = DEFAULT_WINDOWS[window_key] || {
        "x" => 41,
        "y" => 6,
        "width" => 407,
        "height" => 407,
        "z" => 1500,
        "open" => false
      }

      x = integer_or_default(state["x"], default_state["x"])
      y = integer_or_default(state["y"], default_state["y"])
      width = integer_or_default(state["width"], default_state["width"])
      height = integer_or_default(state["height"], default_state["height"])
      z = integer_or_default(state["z"] || state["layer"], default_state["z"])

      x = default_state["x"] if x <= 0
      y = default_state["y"] if y < 0
      width = default_state["width"] if width <= 0
      height = default_state["height"] if height <= 0
      height = default_state["height"] if window_key == "launcher" && height < default_state["height"]
      z = default_state["z"] if z <= 0

      normalized[window_key] = {
        "x" => x,
        "y" => y,
        "width" => width,
        "height" => height,
        "z" => z,
        "open" => ActiveModel::Type::Boolean.new.cast(state["open"])
      }
    end
  end

  def format_row(window_key, state)
    open_value = state["open"] ? "open" : "closed"
    [window_key, state["x"], state["y"], state["width"], state["height"], state["z"], open_value].join(" | ")
  end

  def integer_or_default(value, default)
    Integer(value)
  rescue ArgumentError, TypeError
    default
  end

  def clamp_integer(value, minimum, maximum, default)
    parsed = Integer(value)
    return minimum if parsed < minimum
    return maximum if parsed > maximum

    parsed
  rescue ArgumentError, TypeError
    default
  end

  def clamp_float(value, minimum, maximum, default)
    parsed = Float(value)
    return minimum if parsed < minimum
    return maximum if parsed > maximum

    parsed
  rescue ArgumentError, TypeError
    default
  end

  def canonical_window_key(window_key)
    key = window_key.to_s
    return "launcher" if %w[stationary tools launcher].include?(key)

    key
  end
end
