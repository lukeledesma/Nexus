# frozen_string_literal: true

require "json"
require "securerandom"

# Persists workspace state and saved themes in text files under storage/workspace:
# - WorkspaceState.txt: current open state, positions, and appearance
# - LayoutThemes.txt: default + custom named theme snapshots
class WorkspacePreferencesController < ApplicationController
  STORAGE_DIR = Rails.root.join("storage", "workspace").freeze
  WORKSPACE_STATE_FILE = STORAGE_DIR.join("WorkspaceState.txt").freeze
  LAYOUT_THEMES_FILE = STORAGE_DIR.join("LayoutThemes.txt").freeze
  LEGACY_OS_CONFIG_FILE = STORAGE_DIR.join("OSConfig.txt").freeze
  LEGACY_WINDOWS_FILE = STORAGE_DIR.join("Windows.txt").freeze

  DEFAULT_THEME_ID = "default"
  DEFAULT_THEME_NAME = "Default"
  CUSTOM_THEME_ID = "custom"
  CUSTOM_THEME_NAME = "CUSTOM"

  DEFAULT_WINDOWS = {
    "db-health" => { "x" => 6, "y" => 6, "width" => 320, "height" => 235, "z" => 1501, "open" => true },
    "settings" => { "x" => 6, "y" => 256, "width" => 320, "height" => 180, "z" => 1502, "open" => true },
    "theme-builder" => { "x" => 6, "y" => 256, "width" => 760, "height" => 430, "z" => 1508, "open" => false },
    "launcher" => { "x" => 376, "y" => 6, "width" => 320, "height" => 180, "z" => 1503, "open" => true },
    "singular-note" => { "x" => 711, "y" => 6, "width" => 560, "height" => 430, "z" => 1504, "open" => false },
    "singular-task-list" => { "x" => 747, "y" => 48, "width" => 407, "height" => 407, "z" => 1505, "open" => true },
    "singular-whiteboard" => { "x" => 789, "y" => 78, "width" => 407, "height" => 407, "z" => 1509, "open" => false },
    "singular-excalidraw" => { "x" => 830, "y" => 120, "width" => 800, "height" => 600, "z" => 1510, "open" => false },
    "conversion-chart" => { "x" => 782, "y" => 88, "width" => 407, "height" => 407, "z" => 1506, "open" => true },
    "timer" => { "x" => 376, "y" => 196, "width" => 320, "height" => 250, "z" => 1507, "open" => true }
  }.freeze

  DEFAULT_APPEARANCE = {
    "hue" => 180,
    "saturation" => 0,
    "brightness" => 15,
    "transparency" => 0.15,
    "font_1" => 89,
    "font_1_alpha" => 100,
    "font_2" => 63,
    "font_2_alpha" => 100,
    "border" => 20,
    "border_alpha" => 100,
    "color_1_hue" => 240,
    "color_1_saturation" => 28,
    "color_1_brightness" => 14,
    "color_2_hue" => 213,
    "color_2_saturation" => 73,
    "color_2_brightness" => 22,
    "angle" => 135
  }.freeze

  def show
    ensure_storage_files
    render_current_payload
  end

  def update
    ensure_storage_files

    if params[:theme].present?
      update_theme
      return
    end

    state = read_state_data
    themes = ensure_default_theme(read_themes_data)

    incoming_windows = normalize_windows_payload(params[:windows])
    state["windows"] = normalize_rows_with_defaults((state["windows"] || {}).deep_merge(incoming_windows))

    incoming_appearance = normalize_appearance_payload(params[:appearance])
    if incoming_appearance.present?
      current_appearance = active_theme_appearance(themes, state)
      merged_appearance = normalize_appearance(current_appearance.merge(incoming_appearance))
      state["active_theme_id"] = apply_or_clear_custom_theme!(themes, merged_appearance)
      write_themes_data(themes)
    end

    write_state_data(state)
    render_current_payload
  end

  def destroy
    ensure_storage_files
    write_state_data(default_state)
    render_current_payload
  end

  private

  def update_theme
    payload = params[:theme].respond_to?(:to_unsafe_h) ? params[:theme].to_unsafe_h : params[:theme].to_h
    action = payload["action"].to_s.downcase

    state = read_state_data
    themes = ensure_default_theme(read_themes_data)

    case action
    when "save"
      apply_save_theme!(themes, state, payload)
    when "rename"
      apply_rename_theme!(themes, payload)
    when "delete"
      apply_delete_theme!(themes, state, payload)
    when "apply"
      apply_theme_snapshot!(themes, state, payload)
    else
      render json: { error: "Invalid theme action" }, status: :unprocessable_entity
      return
    end

    write_themes_data(themes)
    write_state_data(state)
    render_current_payload
  end

  def apply_save_theme!(themes, state, payload)
    name = payload["name"].to_s.strip
    name = next_theme_name(themes) if name.blank? || name.casecmp?(DEFAULT_THEME_NAME) || name.casecmp?(CUSTOM_THEME_NAME)

    appearance_raw = payload["appearance"]
    appearance_hash = appearance_raw.respond_to?(:to_unsafe_h) ? appearance_raw.to_unsafe_h : appearance_raw.to_h
    appearance = normalize_appearance(appearance_hash)
    id = "theme-#{SecureRandom.hex(4)}"

    themes << {
      "id" => id,
      "name" => name.first(64),
      "locked" => false,
      "appearance" => appearance
    }

    remove_custom_theme!(themes)
    state["active_theme_id"] = id
  end

  def apply_rename_theme!(themes, payload)
    theme_id = payload["theme_id"].to_s
    name = payload["name"].to_s.strip.first(64)
    return if theme_id.blank? || name.blank? || name.casecmp?(DEFAULT_THEME_NAME)

    theme = themes.find { |item| item["id"] == theme_id }
    return if theme.blank? || ActiveModel::Type::Boolean.new.cast(theme["locked"])

    theme["name"] = name
  end

  def apply_delete_theme!(themes, state, payload)
    theme_id = payload["theme_id"].to_s
    return if theme_id.blank? || theme_id == DEFAULT_THEME_ID

    theme = themes.find { |item| item["id"] == theme_id }
    return if theme.blank? || ActiveModel::Type::Boolean.new.cast(theme["locked"])

    themes.reject! { |item| item["id"] == theme_id }

    state["active_theme_id"] = DEFAULT_THEME_ID if state["active_theme_id"] == theme_id
  end

  def apply_theme_snapshot!(themes, state, payload)
    theme_id = payload["theme_id"].to_s
    return if theme_id.blank?

    theme = themes.find { |item| item["id"] == theme_id }
    return if theme.blank?

    remove_custom_theme!(themes)
    state["active_theme_id"] = theme["id"]
  end

  def next_theme_name(themes)
    base = "Custom Layout"
    existing = themes.map { |theme| theme["name"].to_s.downcase }
    return base unless existing.include?(base.downcase)

    suffix = 2
    loop do
      candidate = "#{base} #{suffix}"
      return candidate unless existing.include?(candidate.downcase)

      suffix += 1
    end
  end

  def render_current_payload
    state = read_state_data
    themes = ensure_default_theme(read_themes_data)
    active_theme_id = state["active_theme_id"].presence || DEFAULT_THEME_ID
    active_theme = themes.find { |theme| theme["id"] == active_theme_id }

    if active_theme.blank?
      active_theme_id = DEFAULT_THEME_ID
      active_theme = themes.find { |theme| theme["id"] == DEFAULT_THEME_ID }
    end

    current_appearance = normalize_appearance(active_theme&.dig("appearance") || DEFAULT_APPEARANCE)
    is_custom_layout = active_theme_id == CUSTOM_THEME_ID
    active_theme_name = if is_custom_layout
      CUSTOM_THEME_NAME
    else
      active_theme&.dig("name").presence || DEFAULT_THEME_NAME
    end

    render json: {
      "windows" => normalize_rows_with_defaults(state["windows"] || {}),
      "appearance" => current_appearance,
      "active_theme_id" => active_theme_id,
      "active_theme_name" => active_theme_name,
      "is_custom_layout" => is_custom_layout,
      "themes" => theme_summaries(themes)
    }
  end

  def theme_summaries(themes)
    themes.reject { |theme| theme["id"] == CUSTOM_THEME_ID }.map do |theme|
      {
        "id" => theme["id"].to_s,
        "name" => theme["name"].to_s,
        "locked" => ActiveModel::Type::Boolean.new.cast(theme["locked"])
      }
    end.sort_by do |theme|
      [theme["locked"] ? 0 : 1, theme["name"].downcase]
    end
  end

  def default_state
    {
      "active_theme_id" => DEFAULT_THEME_ID,
      "windows" => normalize_rows_with_defaults(DEFAULT_WINDOWS)
    }
  end

  def default_theme_snapshot
    {
      "id" => DEFAULT_THEME_ID,
      "name" => DEFAULT_THEME_NAME,
      "locked" => true,
      "appearance" => normalize_appearance(DEFAULT_APPEARANCE)
    }
  end

  def ensure_default_theme(themes)
    list = Array(themes).map { |theme| normalize_theme(theme) }.compact
    default_theme = list.find { |theme| theme["id"] == DEFAULT_THEME_ID }

    if default_theme
      default_theme["name"] = DEFAULT_THEME_NAME
      default_theme["locked"] = true
      default_theme["appearance"] = normalize_appearance(DEFAULT_APPEARANCE)
    else
      list << default_theme_snapshot
    end

    list.uniq { |theme| theme["id"] }
  end

  def normalize_theme(theme)
    return nil unless theme.respond_to?(:to_h)

    raw = theme.to_h.transform_keys(&:to_s)
    id = raw["id"].to_s.presence
    name = raw["name"].to_s.strip.presence
    return nil if id.blank? || name.blank?

    if id == CUSTOM_THEME_ID
      name = CUSTOM_THEME_NAME
    elsif name.casecmp?(CUSTOM_THEME_NAME)
      return nil
    end

    {
      "id" => id,
      "name" => name.first(64),
      "locked" => id == CUSTOM_THEME_ID ? true : ActiveModel::Type::Boolean.new.cast(raw["locked"]),
      "appearance" => normalize_appearance(raw["appearance"] || {})
    }
  end

  def ensure_storage_files
    FileUtils.mkdir_p(STORAGE_DIR)
    return if File.exist?(WORKSPACE_STATE_FILE) && File.exist?(LAYOUT_THEMES_FILE)

    state = default_state

    legacy_rows = parse_legacy_os_config_current_rows
    legacy_rows = parse_legacy_windows_rows if legacy_rows.blank?
    state["windows"] = normalize_rows_with_defaults(DEFAULT_WINDOWS.deep_merge(legacy_rows)) if legacy_rows.present?

    write_state_data(state)
    write_themes_data([default_theme_snapshot])
  end

  def read_state_data
    payload = parse_json_file(WORKSPACE_STATE_FILE)
    return default_state unless payload.respond_to?(:to_h)

    state = payload.to_h.transform_keys(&:to_s)
    {
      "active_theme_id" => state["active_theme_id"].presence || DEFAULT_THEME_ID,
      "windows" => normalize_rows_with_defaults(state["windows"] || {})
    }
  end

  def write_state_data(state)
    output = {
      "active_theme_id" => state["active_theme_id"].presence || DEFAULT_THEME_ID,
      "windows" => normalize_rows_with_defaults(state["windows"] || {})
    }
    File.write(WORKSPACE_STATE_FILE, JSON.pretty_generate(output) + "\n")
  end

  def read_themes_data
    payload = parse_json_file(LAYOUT_THEMES_FILE)
    themes = payload.respond_to?(:to_h) ? payload.to_h["themes"] : []
    ensure_default_theme(themes)
  end

  def write_themes_data(themes)
    output = { "themes" => ensure_default_theme(themes) }
    File.write(LAYOUT_THEMES_FILE, JSON.pretty_generate(output) + "\n")
  end

  def parse_json_file(path)
    return {} unless File.exist?(path)

    JSON.parse(File.read(path))
  rescue JSON::ParserError
    {}
  end

  def parse_legacy_os_config_current_rows
    return {} unless File.exist?(LEGACY_OS_CONFIG_FILE)

    rows = {}
    in_current = false

    File.readlines(LEGACY_OS_CONFIG_FILE, chomp: true).each do |line|
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
      normalized_key = canonical_window_key(window_key)
      next unless DEFAULT_WINDOWS.key?(normalized_key)

      rows[normalized_key] = {
        "x" => Integer(x_raw),
        "y" => Integer(y_raw),
        "width" => Integer(width_raw),
        "height" => Integer(height_raw),
        "z" => integer_or_default(z_raw, DEFAULT_WINDOWS[normalized_key]["z"]),
        "open" => open_raw.to_s.downcase == "open"
      }
    rescue ArgumentError
      next
    end

    rows
  end

  def parse_legacy_os_config_appearance
    return {} unless File.exist?(LEGACY_OS_CONFIG_FILE)

    in_shell_current = false
    in_background_current = false
    appearance = {}

    File.readlines(LEGACY_OS_CONFIG_FILE, chomp: true).each do |line|
      stripped = line.to_s.strip
      next if stripped.blank? || stripped.start_with?("#")

      if stripped.start_with?("[")
        upper = stripped.upcase
        in_shell_current = upper == "[SHELL.CURRENT]" || upper == "[HSB.CURRENT]" || upper == "[HSB]"
        in_background_current = upper == "[BACKGROUND.CURRENT]" || upper == "[BACKGROUND]"
        next
      end

      next unless in_shell_current || in_background_current

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

  def parse_legacy_windows_rows
    return {} unless File.exist?(LEGACY_WINDOWS_FILE)

    rows = {}

    File.readlines(LEGACY_WINDOWS_FILE, chomp: true).each do |line|
      stripped = line.to_s.strip
      next if stripped.blank? || stripped.start_with?("#")

      _user_id, window_key, x_raw, y_raw, open_raw = stripped.split("|", 5)
      next if window_key.blank?

      normalized_key = canonical_window_key(window_key)
      next unless DEFAULT_WINDOWS.key?(normalized_key)

      defaults = DEFAULT_WINDOWS[normalized_key]
      rows[normalized_key] = {
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

    normalized["hue"] = clamp_integer(keyed["hue"], 0, 360, DEFAULT_APPEARANCE["hue"]) if keyed.key?("hue")
    normalized["saturation"] = clamp_integer(keyed["saturation"], 0, 100, DEFAULT_APPEARANCE["saturation"]) if keyed.key?("saturation")
    normalized["brightness"] = clamp_integer(keyed["brightness"], 0, 100, DEFAULT_APPEARANCE["brightness"]) if keyed.key?("brightness")
    normalized["transparency"] = clamp_float(keyed["transparency"], 0.15, 0.95, DEFAULT_APPEARANCE["transparency"]) if keyed.key?("transparency")
    normalized["font_1"] = clamp_integer(keyed["font_1"], 0, 100, DEFAULT_APPEARANCE["font_1"]) if keyed.key?("font_1")
    normalized["font_1_alpha"] = clamp_integer(keyed["font_1_alpha"], 0, 100, DEFAULT_APPEARANCE["font_1_alpha"]) if keyed.key?("font_1_alpha")
    normalized["font_2"] = clamp_integer(keyed["font_2"], 0, 100, DEFAULT_APPEARANCE["font_2"]) if keyed.key?("font_2")
    normalized["font_2_alpha"] = clamp_integer(keyed["font_2_alpha"], 0, 100, DEFAULT_APPEARANCE["font_2_alpha"]) if keyed.key?("font_2_alpha")
    normalized["border"] = clamp_integer(keyed["border"], 0, 100, DEFAULT_APPEARANCE["border"]) if keyed.key?("border")
    normalized["border_alpha"] = clamp_integer(keyed["border_alpha"], 0, 100, DEFAULT_APPEARANCE["border_alpha"]) if keyed.key?("border_alpha")
    normalized["color_1_hue"] = clamp_integer(keyed["color_1_hue"], 0, 360, DEFAULT_APPEARANCE["color_1_hue"]) if keyed.key?("color_1_hue")
    normalized["color_1_saturation"] = clamp_integer(keyed["color_1_saturation"], 0, 100, DEFAULT_APPEARANCE["color_1_saturation"]) if keyed.key?("color_1_saturation")
    normalized["color_1_brightness"] = clamp_integer(keyed["color_1_brightness"], 0, 100, DEFAULT_APPEARANCE["color_1_brightness"]) if keyed.key?("color_1_brightness")
    normalized["color_2_hue"] = clamp_integer(keyed["color_2_hue"], 0, 360, DEFAULT_APPEARANCE["color_2_hue"]) if keyed.key?("color_2_hue")
    normalized["color_2_saturation"] = clamp_integer(keyed["color_2_saturation"], 0, 100, DEFAULT_APPEARANCE["color_2_saturation"]) if keyed.key?("color_2_saturation")
    normalized["color_2_brightness"] = clamp_integer(keyed["color_2_brightness"], 0, 100, DEFAULT_APPEARANCE["color_2_brightness"]) if keyed.key?("color_2_brightness")
    normalized["angle"] = clamp_integer(keyed["angle"], 0, 360, DEFAULT_APPEARANCE["angle"]) if keyed.key?("angle")

    normalized
  end

  def normalize_appearance(raw)
    input = raw.respond_to?(:transform_keys) ? raw.transform_keys { |key| key.to_s.downcase } : {}

    {
      "hue" => clamp_integer(input["hue"], 0, 360, DEFAULT_APPEARANCE["hue"]),
      "saturation" => clamp_integer(input["saturation"], 0, 100, DEFAULT_APPEARANCE["saturation"]),
      "brightness" => clamp_integer(input["brightness"], 0, 100, DEFAULT_APPEARANCE["brightness"]),
      "transparency" => clamp_float(input["transparency"], 0.15, 0.95, DEFAULT_APPEARANCE["transparency"]),
      "font_1" => clamp_integer(input["font_1"], 0, 100, DEFAULT_APPEARANCE["font_1"]),
      "font_1_alpha" => clamp_integer(input["font_1_alpha"], 0, 100, DEFAULT_APPEARANCE["font_1_alpha"]),
      "font_2" => clamp_integer(input["font_2"], 0, 100, DEFAULT_APPEARANCE["font_2"]),
      "font_2_alpha" => clamp_integer(input["font_2_alpha"], 0, 100, DEFAULT_APPEARANCE["font_2_alpha"]),
      "border" => clamp_integer(input["border"], 0, 100, DEFAULT_APPEARANCE["border"]),
      "border_alpha" => clamp_integer(input["border_alpha"], 0, 100, DEFAULT_APPEARANCE["border_alpha"]),
      "color_1_hue" => clamp_integer(input["color_1_hue"], 0, 360, DEFAULT_APPEARANCE["color_1_hue"]),
      "color_1_saturation" => clamp_integer(input["color_1_saturation"], 0, 100, DEFAULT_APPEARANCE["color_1_saturation"]),
      "color_1_brightness" => clamp_integer(input["color_1_brightness"], 0, 100, DEFAULT_APPEARANCE["color_1_brightness"]),
      "color_2_hue" => clamp_integer(input["color_2_hue"], 0, 360, DEFAULT_APPEARANCE["color_2_hue"]),
      "color_2_saturation" => clamp_integer(input["color_2_saturation"], 0, 100, DEFAULT_APPEARANCE["color_2_saturation"]),
      "color_2_brightness" => clamp_integer(input["color_2_brightness"], 0, 100, DEFAULT_APPEARANCE["color_2_brightness"]),
      "angle" => clamp_integer(input["angle"], 0, 360, DEFAULT_APPEARANCE["angle"])
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

      defaults = DEFAULT_WINDOWS[canonical_key]
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

  def normalize_rows_with_defaults(rows)
    rows.each_with_object({}) do |(window_key, state), normalized|
      next unless DEFAULT_WINDOWS.key?(window_key)

      default_state = DEFAULT_WINDOWS[window_key]
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

  def active_theme_appearance(themes, state)
    active_theme_id = state["active_theme_id"].presence || DEFAULT_THEME_ID
    active_theme = themes.find { |theme| theme["id"] == active_theme_id }
    normalize_appearance(active_theme&.dig("appearance") || DEFAULT_APPEARANCE)
  end

  def apply_or_clear_custom_theme!(themes, appearance)
    matching_theme = themes.find do |theme|
      theme["id"] != CUSTOM_THEME_ID &&
        !appearance_changed?(appearance, theme["appearance"])
    end

    if matching_theme
      remove_custom_theme!(themes)
      return matching_theme["id"]
    end

    upsert_custom_theme!(themes, appearance)
    CUSTOM_THEME_ID
  end

  def upsert_custom_theme!(themes, appearance)
    custom_theme = themes.find { |theme| theme["id"] == CUSTOM_THEME_ID }
    if custom_theme
      custom_theme["name"] = CUSTOM_THEME_NAME
      custom_theme["locked"] = true
      custom_theme["appearance"] = normalize_appearance(appearance)
    else
      themes << {
        "id" => CUSTOM_THEME_ID,
        "name" => CUSTOM_THEME_NAME,
        "locked" => true,
        "appearance" => normalize_appearance(appearance)
      }
    end
  end

  def remove_custom_theme!(themes)
    themes.reject! { |theme| theme["id"] == CUSTOM_THEME_ID }
  end

  def appearance_changed?(current, baseline)
    current_hash = normalize_appearance(current || {})
    baseline_hash = normalize_appearance(baseline || {})

    current_hash.any? do |key, value|
      if key == "transparency"
        (value.to_f - baseline_hash[key].to_f).abs > 0.005
      else
        value.to_i != baseline_hash[key].to_i
      end
    end
  end
end
