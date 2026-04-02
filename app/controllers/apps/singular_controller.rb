# frozen_string_literal: true

module Apps
  class SingularController < BaseController
before_action :redirect_top_level_frame_requests, only: %i[note task_list whiteboard excalidraw]
    before_action :ensure_singular_items

    # GET /apps/singular_note
    def note
      @note = @app_folder.items.find_by(item_type: "note")
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
      @tasks_for_view = normalize_tasks(@task_list.tasks) if @task_list
    end

    # GET /apps/singular_whiteboard
    def whiteboard
      @whiteboard = @app_folder.items.find_by(item_type: "whiteboard")
      @stickies = parse_stickies(@whiteboard&.body)
    end

    # PATCH /apps/singular_whiteboard
    def update_whiteboard
      @whiteboard = @app_folder.items.find_by(item_type: "whiteboard")
      return head :not_found unless @whiteboard

      raw = params[:stickies]
      stickies_json = raw.is_a?(String) ? raw : raw.to_json

      if @whiteboard.update(body: stickies_json)
        ItemStorageSyncLite.sync_all!
        render json: { ok: true }
      else
        render json: { errors: @whiteboard.errors.full_messages }, status: :unprocessable_entity
      end
    end

    # GET /apps/singular_excalidraw
    def excalidraw
      @drawing = @app_folder.items.find_by(item_type: "excalidraw")
    end

    # PATCH /apps/singular_excalidraw
    def update_excalidraw
      @drawing = @app_folder.items.find_by(item_type: "excalidraw")
      return head :not_found unless @drawing

      if @drawing.update(excalidraw_params)
        render json: {
          ok: true,
          id: @drawing.id,
          item_type: @drawing.item_type,
          name: @drawing.name,
          updated_at: @drawing.updated_at&.utc&.iso8601
        }
      else
        render json: { errors: @drawing.errors.full_messages }, status: :unprocessable_entity
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

      # Ensure Whiteboard item exists
      Item.find_or_create_by!(folder_id: @app_folder.id, item_type: "whiteboard") do |item|
        item.folder_id = @app_folder.id
        item.name = "Whiteboard"
        item.item_type = "whiteboard"
        item.body = "[]"
        item.tasks = []
      end

      # Ensure Excalidraw item exists
      Item.find_or_create_by!(folder_id: @app_folder.id, item_type: "excalidraw") do |item|
        item.folder_id = @app_folder.id
        item.name = "Excalidraw"
        item.item_type = "excalidraw"
        item.body = "{\"elements\":[],\"appState\":{},\"files\":{}}"
        item.tasks = []
      end

      # Sync to disk to ensure workspace text files exist.
      # Rare cache-clear reload spikes can trigger transient file races; retry once.
      begin
        ItemStorageSyncLite.sync_all!
      rescue Errno::ENOENT
        sleep 0.03
        ItemStorageSyncLite.sync_all!
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

    def excalidraw_params
      params.require(:item).permit(:body)
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
  end
end
