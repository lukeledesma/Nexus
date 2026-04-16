# frozen_string_literal: true

require "json"

# Minimal workspace preferences:
# - Shell choice: default | classic
# - Wallpaper choice: image | none (black fallback)
class WorkspacePreferencesController < ApplicationController
  STORAGE_ROOT = Rails.root.join("storage", "workspace").freeze

  DEFAULT_THEME_ID = "default"
  DEFAULT_THEME_NAME = "Modern"
  CLASSIC_THEME_ID = "classic"
  CLASSIC_THEME_NAME = "Classic"
  # Legacy id referenced by WorkspaceThemeBoot; workspace is always default/classic now.
  CUSTOM_THEME_ID = "custom"
  CUSTOM_THEME_NAME = "CUSTOM"
  ALLOWED_THEME_IDS = [DEFAULT_THEME_ID, CLASSIC_THEME_ID].freeze

  # Forest-like dark shell (desktop fallback gradient is forced to black in chrome sync).
  DEFAULT_APPEARANCE = {
    "hue" => 200,
    "saturation" => 5,
    "brightness" => 13,
    "transparency" => 0.95,
    "font_1" => 85,
    "font_1_alpha" => 100,
    "font_2" => 60,
    "font_2_alpha" => 100,
    "color_1_hue" => 190,
    "color_1_saturation" => 18,
    "color_1_brightness" => 55,
    "color_2_hue" => 195,
    "color_2_saturation" => 25,
    "color_2_brightness" => 20,
    "angle" => 333
  }.freeze

  CLASSIC_APPEARANCE = {
    "hue" => 214,
    "saturation" => 22,
    "brightness" => 92,
    "transparency" => 0.9,
    "font_1" => 15,
    "font_1_alpha" => 100,
    "font_2" => 38,
    "font_2_alpha" => 100,
    "color_1_hue" => 210,
    "color_1_saturation" => 16,
    "color_1_brightness" => 93,
    "color_2_hue" => 218,
    "color_2_saturation" => 18,
    "color_2_brightness" => 88,
    "angle" => 180
  }.freeze

  def show
    ensure_storage_files
    render_current_payload
  end

  def update
    ensure_storage_files
    state = read_state_data
    themes = ensure_default_theme(read_themes_data)

    if params[:theme].present?
      payload = params[:theme].respond_to?(:to_unsafe_h) ? params[:theme].to_unsafe_h : params[:theme].to_h
      action = payload["action"].to_s.downcase
      if action != "apply"
        render json: { error: "Only shell apply is supported." }, status: :unprocessable_entity
        return
      end

      theme_id = payload["theme_id"].to_s
      unless ALLOWED_THEME_IDS.include?(theme_id)
        render json: { error: "Only Modern and Classic shells are available." }, status: :unprocessable_entity
        return
      end
      state["active_theme_id"] = theme_id
    end

    if params[:apply_theme_gradient].present?
      render json: { error: "Gradient wallpaper is no longer supported." }, status: :unprocessable_entity
      return
    end

    if params[:appearance].present?
      render json: { error: "Custom shell editing is no longer supported." }, status: :unprocessable_entity
      return
    end

    wallpaper_image_doc_id = wallpaper_apply_image_document_id_param
    if wallpaper_image_doc_id.present?
      ok, err = apply_wallpaper_image_pick!(state, wallpaper_image_doc_id)
      unless ok
        render json: { error: err || "Could not select image." }, status: :unprocessable_entity
        return
      end
    end

    active_theme = themes.find { |theme| theme["id"] == state["active_theme_id"] }
    sync_state_wallpaper_from_theme!(themes, state, active_theme)
    write_state_data(state)
    write_themes_data(themes)
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

  def render_current_payload
    state = read_state_data
    themes = ensure_default_theme(read_themes_data)
    active_theme_id = state["active_theme_id"].presence
    active_theme_id = DEFAULT_THEME_ID unless ALLOWED_THEME_IDS.include?(active_theme_id)
    active_theme = themes.find { |theme| theme["id"] == active_theme_id } || default_theme_snapshot
    state["active_theme_id"] = active_theme_id

    state_dirty, themes_dirty = sync_state_wallpaper_from_theme!(themes, state, active_theme)
    write_state_data(state) if state_dirty
    write_themes_data(themes) if themes_dirty

    render json: {
      "appearance" => normalize_appearance(active_theme["appearance"] || DEFAULT_APPEARANCE),
      "active_theme_id" => active_theme_id,
      "active_theme_name" => active_theme["name"].to_s,
      "is_custom_layout" => false,
      "themes" => theme_summaries(themes),
      "gradient_source_theme_id" => nil,
      "gradient_source_theme_name" => nil,
      "wallpaper_background_kind" => state["wallpaper_background_kind"],
      "wallpaper_image_document_id" => state["wallpaper_image_document_id"],
      "wallpaper_gradient_theme_id" => nil,
      "wallpaper_gradient_theme_name" => nil
    }
  end

  def theme_summaries(themes)
    themes.map do |theme|
      {
        "id" => theme["id"].to_s,
        "name" => theme["name"].to_s,
        "locked" => true
      }
    end
  end

  def default_state
    {
      "active_theme_id" => DEFAULT_THEME_ID,
      "gradient_source_theme_id" => nil,
      "gradient_source_theme_name" => nil,
      "wallpaper_background_kind" => nil,
      "wallpaper_image_document_id" => nil,
      "wallpaper_gradient_theme_id" => nil,
      "wallpaper_gradient_theme_name" => nil
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

  def classic_theme_snapshot
    {
      "id" => CLASSIC_THEME_ID,
      "name" => CLASSIC_THEME_NAME,
      "locked" => true,
      "appearance" => normalize_appearance(CLASSIC_APPEARANCE)
    }
  end

  # Strict shell set: only Default + Classic.
  def ensure_default_theme(_themes)
    [default_theme_snapshot, classic_theme_snapshot]
  end

  def ensure_storage_files
    FileUtils.mkdir_p(workspace_storage_dir)
    return if File.exist?(workspace_state_file) && File.exist?(layout_themes_file)

    write_state_data(default_state)
    write_themes_data(ensure_default_theme(nil))
  end

  def read_state_data
    payload = parse_json_file(workspace_state_file)
    return default_state.dup unless payload.respond_to?(:to_h)

    state = default_state.merge(payload.to_h.transform_keys(&:to_s))
    state["active_theme_id"] = DEFAULT_THEME_ID unless ALLOWED_THEME_IDS.include?(state["active_theme_id"].to_s)
    state["gradient_source_theme_id"] = nil
    state["gradient_source_theme_name"] = nil
    state["wallpaper_gradient_theme_id"] = nil
    state["wallpaper_gradient_theme_name"] = nil
    state
  end

  def write_state_data(state)
    output = default_state.merge(
      "active_theme_id" => ALLOWED_THEME_IDS.include?(state["active_theme_id"].to_s) ? state["active_theme_id"] : DEFAULT_THEME_ID,
      "wallpaper_background_kind" => state["wallpaper_background_kind"].presence,
      "wallpaper_image_document_id" => state["wallpaper_image_document_id"].presence
    )
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

  def wallpaper_state_slice(state)
    {
      "wallpaper_background_kind" => state["wallpaper_background_kind"].presence,
      "wallpaper_image_document_id" => state["wallpaper_image_document_id"].presence&.to_i
    }
  end

  def clear_wallpaper_picks!(state)
    state["wallpaper_background_kind"] = nil
    state["wallpaper_image_document_id"] = nil
    state["wallpaper_gradient_theme_id"] = nil
    state["wallpaper_gradient_theme_name"] = nil
    state["gradient_source_theme_id"] = nil
    state["gradient_source_theme_name"] = nil
  end

  def wallpaper_doc_eligible_for_user?(doc)
    return false unless current_user && doc&.file? && doc.content_type.to_s == "asset"

    EmbeddedIimageFolder.eligible_asset?(doc) && doc.parent_id == EmbeddedIimageFolder.document_for(current_user)&.id
  end

  # Kept for WorkspaceThemeBoot compatibility (`send`) and for read-time state repair.
  def sync_state_wallpaper_from_theme!(_themes, state, _theme, user: current_user)
    before_wp = wallpaper_state_slice(state)
    if state["wallpaper_background_kind"].to_s == "image"
      doc = Document.find_by(id: state["wallpaper_image_document_id"].to_i)
      folder = EmbeddedIimageFolder.document_for(user)
      valid = doc&.file? && doc.content_type.to_s == "asset" && folder && doc.parent_id == folder.id &&
        EmbeddedIimageFolder.eligible_asset?(doc)
      clear_wallpaper_picks!(state) unless valid
    end
    [wallpaper_state_slice(state) != before_wp, false]
  end

  def wallpaper_apply_image_document_id_param
    raw = params[:apply_wallpaper_image]
    hash =
      if raw.respond_to?(:to_unsafe_h)
        raw.to_unsafe_h
      elsif raw.respond_to?(:to_h)
        raw.to_h
      else
        {}
      end
    hash = hash.transform_keys(&:to_s)
    id = hash["document_id"]
    return nil if id.blank?

    id.to_i
  end

  def apply_wallpaper_image_pick!(state, doc_id)
    return [false, "Not signed in."] unless current_user

    folder = EmbeddedIimageFolder.document_for(current_user)
    return [false, "Wallpaper folder not available."] if folder.blank?

    doc = Document.find_by(id: doc_id)
    return [false, "Wallpaper not found."] unless doc&.file? && doc.parent_id == folder.id
    return [false, "Invalid wallpaper image."] unless EmbeddedIimageFolder.eligible_asset?(doc)

    state["wallpaper_background_kind"] = "image"
    state["wallpaper_image_document_id"] = doc.id
    state["wallpaper_gradient_theme_id"] = nil
    state["wallpaper_gradient_theme_name"] = nil
    state["gradient_source_theme_id"] = nil
    state["gradient_source_theme_name"] = nil
    [true, nil]
  end
end
