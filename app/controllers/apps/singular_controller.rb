# frozen_string_literal: true

module Apps
  class SingularController < BaseController
    before_action :redirect_top_level_frame_requests, only: %i[note task_list sticky_notes]

    before_action :ensure_singular_items

    # GET /apps/singular_note
    def note
      @note = @app_folder.items.find_by(item_type: "note")
      apply_singular_document_or_blank(@note, "note")
    end

    # PATCH /apps/singular_note
    def update_note
      @note = @app_folder.items.find_by(item_type: "note")
      return head :not_found unless @note

      if @note.update(note_params)
        render json: {
          ok: true,
          id: @note.id,
          item_type: @note.item_type,
          name: @note.name,
          updated_at: @note.updated_at&.utc&.iso8601
        }
      else
        render json: { errors: @note.errors.full_messages }, status: :unprocessable_entity
      end
    end

    # GET /apps/singular_task_list
    def task_list
      @task_list = @app_folder.items.find_by(item_type: "task_list")
      apply_singular_document_or_blank(@task_list, "task_list")
      @tasks_for_view = normalize_tasks(@task_list.tasks) if @task_list
    end

    # GET /apps/singular_sticky_notes
    def sticky_notes
      @sticky_notes_item = @app_folder.items.find_by(item_type: "stickynotes")
      apply_singular_document_or_blank(@sticky_notes_item, "stickynotes")
      @stickies = parse_stickies(@sticky_notes_item&.body)
    end

    # PATCH /apps/singular_sticky_notes
    def update_sticky_notes
      @sticky_notes_item = @app_folder.items.find_by(item_type: "stickynotes")
      return head :not_found unless @sticky_notes_item

      raw = params[:stickies]
      stickies_json = raw.is_a?(String) ? raw : raw.to_json

      if @sticky_notes_item.update(body: stickies_json)
        ItemStorageSyncLite.sync_all!(username: current_user&.username)
        render json: {
          ok: true,
          item_type: "stickynotes",
          updated_at: @sticky_notes_item.updated_at&.utc&.iso8601
        }
      else
        render json: { errors: @sticky_notes_item.errors.full_messages }, status: :unprocessable_entity
      end
    end

    # POST /apps/singular/save_file
    def save_file
      folder_id = params[:folder_id].presence
      frame_id = params[:frame_id].to_s
      filename = params[:filename].to_s
      document_id = params[:document_id].presence

      if folder_id.blank? || frame_id.blank? || filename.blank?
        render json: { error: "folder_id, frame_id, and filename are required" }, status: :bad_request
        return
      end

      result, payload = SingularSaveToDocument.new(
        user: current_user,
        folder_id: folder_id,
        frame_id: frame_id,
        filename: filename,
        document_id: document_id
      ).call

      case result
      when :ok
        disp = helpers.finder_document_display_title(payload[:title])
        render json: payload.merge(ok: true, display_title: disp)
      when :not_found
        head :not_found
      when :forbidden
        head :forbidden
      when :unprocessable_entity
        render json: payload || { error: "Could not save file." }, status: :unprocessable_entity
      when :bad_request
        render json: payload, status: :bad_request
      else
        head :internal_server_error
      end
    end

    private

      def redirect_top_level_frame_requests
        return if params[:frame_id].blank?
        return if request.headers["Turbo-Frame"].present?

        redirect_to root_path
      end

    def ensure_singular_items
      @app_folder = Folder.find_or_create_by!(name: "App") do |folder|
        folder.name = "App"
      end

      # Ensure Note item exists
      Item.find_or_create_by!(folder_id: @app_folder.id, item_type: "note") do |item|
        item.folder_id = @app_folder.id
        item.name = "Notes"
        item.item_type = "note"
        item.body = ""
        item.tasks = []
      end

      # Ensure TaskList item exists
      Item.find_or_create_by!(folder_id: @app_folder.id, item_type: "task_list") do |item|
        item.folder_id = @app_folder.id
        item.name = "Tasks"
        item.item_type = "task_list"
        item.body = nil
        item.tasks = []
      end

      # Ensure Sticky Notes item exists
      Item.find_or_create_by!(folder_id: @app_folder.id, item_type: "stickynotes") do |item|
        item.folder_id = @app_folder.id
        item.name = "Sticky Notes"
        item.item_type = "stickynotes"
        item.body = "[]"
        item.tasks = []
      end

      # Sync to disk to ensure workspace text files exist.
      # Rare cache-clear reload spikes can trigger transient file races; retry once.
      begin
        ItemStorageSyncLite.sync_all!(username: current_user&.username)
      rescue Errno::ENOENT
        sleep 0.03
        ItemStorageSyncLite.sync_all!(username: current_user&.username)
      end
    rescue StandardError => e
      Rails.logger.error("[SingularController] ensure_singular_items failed: #{e.class}: #{e.message}")
      raise
    end

    def parse_stickies(body)
      return [] if body.blank?

      JSON.parse(body)
    rescue JSON::ParserError
      []
    end

    def normalize_tasks(value)
      Array(value).filter_map do |task|
        if task.is_a?(String)
          text = task.to_s.strip
          next if text.empty?

          { "text" => text, "checked" => false, "note" => "", "subtasks" => [] }
        elsif task.respond_to?(:to_h)
          hash = task.to_h
          text = hash["text"].to_s.strip
          next if text.empty?

          note = hash["note"].to_s

          subtasks = Array(hash["subtasks"]).filter_map do |subtask|
            next unless subtask.respond_to?(:to_h)

            subtask_hash = subtask.to_h
            subtask_text = subtask_hash["text"].to_s.strip
            next if subtask_text.empty?

            {
              "text" => subtask_text,
              "checked" => ActiveModel::Type::Boolean.new.cast(subtask_hash["checked"]),
              "note" => subtask_hash["note"].to_s
            }
          end

          checked = ActiveModel::Type::Boolean.new.cast(hash["checked"])
          checked = subtasks.present? ? subtasks.all? { |subtask| subtask["checked"] } : checked

          {
            "text" => text,
            "checked" => checked,
            "note" => note,
            "subtasks" => subtasks
          }
        end
      end
    end

    def note_params
      params.require(:item).permit(:body)
    end

    def apply_singular_document_or_blank(item, expected_type)
      return unless item

      if params[:document_id].present?
        hydrate_item_from_finder_document(item, expected_type)
      elsif params[:blank].to_s == "1"
        reset_singular_item_to_blank(item, expected_type)
      end
    end

    def hydrate_item_from_finder_document(item, expected_type)
      did = params[:document_id].presence
      return if did.blank? || !item

      doc = WorkspaceDocumentAccess.openable_document_for(current_user, did, content_type: expected_type)
      return unless doc

      case expected_type
      when "note"
        item.update!(body: doc.content.to_s)
      when "task_list"
        item.update!(tasks: doc.tasks || [])
      when "stickynotes"
        item.update!(body: doc.content.to_s)
      end
    end

    def reset_singular_item_to_blank(item, expected_type)
      case expected_type
      when "note"
        item.update!(body: "")
      when "task_list"
        item.update!(tasks: [])
      when "stickynotes"
        item.update!(body: "[]")
      end
    end
  end
end
