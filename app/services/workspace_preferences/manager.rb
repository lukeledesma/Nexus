# frozen_string_literal: true

module WorkspacePreferences
  class Manager
    DEFAULT_THEME_ID = "default"
    DEFAULT_THEME_NAME = "Modern"
    CUSTOM_THEME_ID = "custom"
    CUSTOM_THEME_NAME = "CUSTOM"
    ALLOWED_THEME_IDS = [ DEFAULT_THEME_ID ].freeze
    WORKSPACE_STATE_KEY = "workspace.preferences".freeze

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

    class << self
      def wallpaper_apply_image_document_id_param(raw)
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
    end

    def initialize(user:)
      @user = user
      @state = nil
      @themes = nil
    end

    def payload
      ensure_loaded!

      active_theme_id = @state["active_theme_id"].presence
      active_theme_id = DEFAULT_THEME_ID unless ALLOWED_THEME_IDS.include?(active_theme_id)
      active_theme = @themes.find { |theme| theme["id"] == active_theme_id } || default_theme_snapshot
      @state["active_theme_id"] = active_theme_id

      state_dirty, themes_dirty = sync_state_wallpaper_from_theme!(@themes, @state, active_theme)
      write_workspace_state(@state) if state_dirty
      write_themes_data(@themes) if themes_dirty

      Support::OperationResult.new(
        status: :ok,
        payload: {
          "appearance" => normalize_appearance(active_theme["appearance"] || DEFAULT_APPEARANCE),
          "active_theme_id" => active_theme_id,
          "active_theme_name" => active_theme["name"].to_s,
          "is_custom_layout" => false,
          "themes" => theme_summaries(@themes),
          "gradient_source_theme_id" => nil,
          "gradient_source_theme_name" => nil,
          "wallpaper_background_kind" => @state["wallpaper_background_kind"],
          "wallpaper_image_document_id" => @state["wallpaper_image_document_id"],
          "wallpaper_gradient_theme_id" => nil,
          "wallpaper_gradient_theme_name" => nil
        }
      )
    end

    def apply_theme(theme_param)
      ensure_loaded!

      payload = theme_param.respond_to?(:to_unsafe_h) ? theme_param.to_unsafe_h : theme_param.to_h
      action = payload["action"].to_s.downcase
      return failure("Only shell apply is supported.") if action != "apply"

      theme_id = payload["theme_id"].to_s
      return failure("Only Modern shell is available.") unless ALLOWED_THEME_IDS.include?(theme_id)

      @state["active_theme_id"] = theme_id
      ok
    end

    def apply_wallpaper_image(doc_id)
      ensure_loaded!

      return failure("Not signed in.") unless @user

      doc = Document.find_by(id: doc_id)
      return failure("Wallpaper not found.") unless wallpaper_doc_eligible_for_user?(doc)

      @state["wallpaper_background_kind"] = "image"
      @state["wallpaper_image_document_id"] = doc.id
      @state["wallpaper_image_storage_path"] = doc.storage_path
      @state["wallpaper_gradient_theme_id"] = nil
      @state["wallpaper_gradient_theme_name"] = nil
      @state["gradient_source_theme_id"] = nil
      @state["gradient_source_theme_name"] = nil
      ok
    end

    def persist!
      ensure_loaded!
      active_theme = @themes.find { |theme| theme["id"] == @state["active_theme_id"] }
      sync_state_wallpaper_from_theme!(@themes, @state, active_theme)
      write_workspace_state(@state)
      write_themes_data(@themes)
      ok
    end

    def wallpaper_state_for_boot
      ensure_loaded!
      active_theme_id = @state["active_theme_id"].presence || DEFAULT_THEME_ID
      active_theme = @themes.find { |theme| theme["id"] == active_theme_id }

      if active_theme.blank?
        active_theme_id = DEFAULT_THEME_ID
        active_theme = @themes.find { |theme| theme["id"] == DEFAULT_THEME_ID }
        @state["active_theme_id"] = active_theme_id
      end

      if @user && active_theme
        wp_dirty, th_dirty = sync_state_wallpaper_from_theme!(@themes, @state, active_theme, user: @user)
        write_workspace_state(@state) if wp_dirty
        write_themes_data(@themes) if th_dirty
      end

      appearance = normalize_appearance(active_theme&.dig("appearance") || DEFAULT_APPEARANCE)
      is_custom_layout = active_theme_id == CUSTOM_THEME_ID
      active_theme_name = if is_custom_layout
        CUSTOM_THEME_NAME
      else
        active_theme&.dig("name").presence || DEFAULT_THEME_NAME
      end

      {
        "active_theme_id" => active_theme_id,
        "appearance" => appearance,
        "active_theme_name" => active_theme_name,
        "is_custom_layout" => is_custom_layout,
        "gradient_source_theme_id" => @state["gradient_source_theme_id"],
        "gradient_source_theme_name" => @state["gradient_source_theme_name"],
        "wallpaper_background_kind" => @state["wallpaper_background_kind"],
        "wallpaper_image_document_id" => @state["wallpaper_image_document_id"],
        "wallpaper_gradient_theme_id" => @state["wallpaper_gradient_theme_id"],
        "wallpaper_gradient_theme_name" => @state["wallpaper_gradient_theme_name"]
      }
    end

    def theme_picker_payload
      ensure_loaded!
      summaries = theme_summaries(@themes)
      active_id = @state["active_theme_id"].presence || DEFAULT_THEME_ID
      is_custom = active_id == CUSTOM_THEME_ID

      chrome_status_text =
        if is_custom
          "Unsaved Theme"
        else
          @themes.find { |t| t["id"] == active_id }&.dig("name").presence || DEFAULT_THEME_NAME
        end

      {
        themes: summaries,
        row_unsaved: is_custom,
        chrome_status_text: chrome_status_text
      }
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

    # Kept for WorkspaceThemeBoot compatibility and read-time state repair.
    def sync_state_wallpaper_from_theme!(themes, state, _theme, user: @user)
      [ false, false ]
    end

    private

    def ensure_loaded!
      return if @state && @themes

      @state = read_state_data
      state_dirty = reconcile_wallpaper_reference!(@state)
      @themes = ensure_default_theme(read_themes_data)
      write_workspace_state(@state) if state_dirty
    end

    def default_state
      {
        "active_theme_id" => DEFAULT_THEME_ID,
        "gradient_source_theme_id" => nil,
        "gradient_source_theme_name" => nil,
        "wallpaper_background_kind" => nil,
        "wallpaper_image_document_id" => nil,
        "wallpaper_image_storage_path" => nil,
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

    def ensure_default_theme(_themes)
      [ default_theme_snapshot ]
    end

    def read_state_data
      payload = read_workspace_state
      return default_state.dup unless payload.is_a?(Hash)

      state = default_state.merge(payload.transform_keys(&:to_s))
      state["active_theme_id"] = DEFAULT_THEME_ID unless ALLOWED_THEME_IDS.include?(state["active_theme_id"].to_s)
      state["gradient_source_theme_id"] = nil
      state["gradient_source_theme_name"] = nil
      state["wallpaper_gradient_theme_id"] = nil
      state["wallpaper_gradient_theme_name"] = nil
      
      # NEVER clear wallpaper_background_kind or wallpaper_image_document_id here
      # They are preserved from the merge above if present in the file
      state
    end

    def write_workspace_state(state)
      return unless @user

      normalized_wallpaper_kind = state["wallpaper_background_kind"].to_s == "image" ? "image" : nil
      normalized_wallpaper_id = state["wallpaper_image_document_id"].presence&.to_i
      normalized_wallpaper_path = state["wallpaper_image_storage_path"].presence

      if normalized_wallpaper_kind != "image" || normalized_wallpaper_id.to_i <= 0
        normalized_wallpaper_kind = nil
        normalized_wallpaper_id = nil
        normalized_wallpaper_path = nil
      end

      output = default_state.merge(
        "active_theme_id" => ALLOWED_THEME_IDS.include?(state["active_theme_id"].to_s) ? state["active_theme_id"] : DEFAULT_THEME_ID,
        "wallpaper_background_kind" => normalized_wallpaper_kind,
        "wallpaper_image_document_id" => normalized_wallpaper_id,
        "wallpaper_image_storage_path" => normalized_wallpaper_path
      )
      UserAppState.put(user: @user, key: WORKSPACE_STATE_KEY, value: output)
    end

    def read_themes_data
      ensure_default_theme(nil)
    end

    def write_themes_data(_themes)
      nil
    end

    def read_workspace_state
      return {} unless @user

      UserAppState.find_by(user_id: @user.id, key: WORKSPACE_STATE_KEY)&.data || {}
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

    def wallpaper_state_slice(state)
      {
        "wallpaper_background_kind" => state["wallpaper_background_kind"].presence,
        "wallpaper_image_document_id" => state["wallpaper_image_document_id"].presence&.to_i,
        "wallpaper_image_storage_path" => state["wallpaper_image_storage_path"].presence
      }
    end

    def clear_wallpaper_picks!(state)
      state["wallpaper_background_kind"] = nil
      state["wallpaper_image_document_id"] = nil
      state["wallpaper_image_storage_path"] = nil
      state["wallpaper_gradient_theme_id"] = nil
      state["wallpaper_gradient_theme_name"] = nil
      state["gradient_source_theme_id"] = nil
      state["gradient_source_theme_name"] = nil
    end

    # Keeps wallpaper stable across document row churn by resolving the saved
    # storage_path back to a current document ID when possible.
    def reconcile_wallpaper_reference!(state)
      return false unless state.is_a?(Hash)
      return false unless state["wallpaper_background_kind"].to_s == "image"

      dirty = false
      current_id = state["wallpaper_image_document_id"].presence&.to_i
      current_path = state["wallpaper_image_storage_path"].to_s.presence

      doc_by_id = current_id.present? ? Document.find_by(id: current_id) : nil
      if wallpaper_doc_eligible_for_user?(doc_by_id)
        if doc_by_id.storage_path.present? && current_path != doc_by_id.storage_path
          state["wallpaper_image_storage_path"] = doc_by_id.storage_path
          dirty = true
        end
        return dirty
      end

      return dirty if current_path.blank?

      doc_by_path = Document.find_by(storage_path: current_path)
      return dirty unless wallpaper_doc_eligible_for_user?(doc_by_path)

      if state["wallpaper_image_document_id"].to_i != doc_by_path.id
        state["wallpaper_image_document_id"] = doc_by_path.id
        dirty = true
      end
      if state["wallpaper_image_storage_path"] != doc_by_path.storage_path
        state["wallpaper_image_storage_path"] = doc_by_path.storage_path
        dirty = true
      end

      dirty
    end

    def wallpaper_doc_eligible_for_user?(doc)
      return false unless @user && doc&.file? && doc.content_type.to_s == "asset"
      return false unless EmbeddedIimageFolder.eligible_asset?(doc)

      in_embedded_wallpaper = doc.parent_id == EmbeddedIimageFolder.document_for(@user)&.id
      in_finder_sections = ::DocumentPolicy.new(user: @user, document: doc).in_finder_section?
      in_embedded_wallpaper || in_finder_sections
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

    def ok
      Support::OperationResult.new(status: :ok)
    end

    def failure(message)
      Support::OperationResult.new(status: :unprocessable_entity, payload: { error: message })
    end
  end
end
