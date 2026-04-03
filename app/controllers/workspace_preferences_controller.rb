# frozen_string_literal: true

require "json"
require "securerandom"

# Persists the active theme choice and saved theme snapshots in text files under
# storage/workspace/<username>:
# - WorkspaceState.txt: active_theme_id only (window bounds live in the browser)
# - LayoutThemes.txt: default + custom named theme snapshots
class WorkspacePreferencesController < ApplicationController
  STORAGE_ROOT = Rails.root.join("storage", "workspace").freeze

  DEFAULT_THEME_ID = "default"
  DEFAULT_THEME_NAME = "Default"
  CUSTOM_THEME_ID = "custom"
  CUSTOM_THEME_NAME = "CUSTOM"

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

  private

  def workspace_storage_dir
    username = current_user&.username.to_s.strip
    if username.present?
      STORAGE_ROOT.join(username, "Embedded")
    else
      STORAGE_ROOT.join("Embedded")
    end
  end

  def workspace_state_file
    workspace_storage_dir.join("WorkspaceState.txt")
  end

  def layout_themes_file
    workspace_storage_dir.join("LayoutThemes.txt")
  end

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
    base = "Custom theme"
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
      "active_theme_id" => DEFAULT_THEME_ID
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
    FileUtils.mkdir_p(workspace_storage_dir)
    return if File.exist?(workspace_state_file) && File.exist?(layout_themes_file)

    write_state_data(default_state)
    write_themes_data([default_theme_snapshot])
  end

  def read_state_data
    payload = parse_json_file(workspace_state_file)
    return default_state unless payload.respond_to?(:to_h)

    state = payload.to_h.transform_keys(&:to_s)
    {
      "active_theme_id" => state["active_theme_id"].presence || DEFAULT_THEME_ID
    }
  end

  def write_state_data(state)
    output = {
      "active_theme_id" => state["active_theme_id"].presence || DEFAULT_THEME_ID
    }
    File.write(workspace_state_file, JSON.pretty_generate(output) + "\n")
  end

  def read_themes_data
    payload = parse_json_file(layout_themes_file)
    themes = payload.respond_to?(:to_h) ? payload.to_h["themes"] : []
    ensure_default_theme(themes)
  end

  def write_themes_data(themes)
    output = { "themes" => ensure_default_theme(themes) }
    File.write(layout_themes_file, JSON.pretty_generate(output) + "\n")
  end

  def parse_json_file(path)
    return {} unless File.exist?(path)

    JSON.parse(File.read(path))
  rescue JSON::ParserError
    {}
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
