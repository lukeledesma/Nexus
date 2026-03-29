# frozen_string_literal: true

module Apps
  class SingularController < BaseController
    before_action :redirect_top_level_frame_requests, only: %i[note task_list]
    before_action :ensure_singular_items

    # GET /apps/singular_note
    def note
      @note = @app_folder.items.find_by(item_type: "note")
    end

    # GET /apps/singular_task_list
    def task_list
      @task_list = @app_folder.items.find_by(item_type: "task_list")
      @tasks_for_view = normalize_tasks(@task_list.tasks) if @task_list
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
  end
end
