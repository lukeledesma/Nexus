# frozen_string_literal: true

module Apps
  class TasksController < BaseController
    before_action :redirect_top_level_frame_requests, only: %i[show]

    before_action :ensure_task_items

    # GET /apps/tasks
    def show
      @task_list = @app_folder.items.find_by(item_type: "task_list")
      @linked_document_id = resolved_task_list_document_id
      @task_list_updated_at = @task_list&.updated_at

      if @linked_document_id.present?
        doc = WorkspaceDocumentAccess.openable_document_for(
          current_user,
          @linked_document_id,
          content_type: "task_list"
        )
        @tasks_for_view = normalize_tasks(doc&.tasks || [])
        @linked_document_display_title = helpers.finder_document_display_title(doc&.title.to_s)
        @task_list_updated_at = doc&.updated_at || @task_list_updated_at
      else
        apply_linked_document_or_blank(@task_list, "task_list")
        @tasks_for_view = normalize_tasks(@task_list&.tasks || [])
      end
    end



    # POST /apps/tasks/save_file
    def save_file
      folder_id = params[:folder_id].presence
      frame_id = params[:frame_id].to_s
      filename = params[:filename].to_s
      document_id = params[:document_id].presence

      if folder_id.blank? || frame_id.blank? || filename.blank?
        render json: { error: "folder_id, frame_id, and filename are required" }, status: :bad_request
        return
      end

      result, payload = LinkedAppSaveToDocument.new(
        user: current_user,
        folder_id: folder_id,
        frame_id: frame_id,
        filename: filename,
        document_id: document_id,
        note_text: params[:note_text]
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

    # GET /apps/tasks/draft_file?app_key=notes|time-card|tasks
    def draft_file
      app_key = params[:app_key].to_s
      doc = EmbeddedDraftDocument.fetch_or_create(user: current_user, app_key: app_key)
      if doc
        render json: {
          ok: true,
          document_id: doc.id,
          title: doc.title.to_s,
          display_title: helpers.finder_document_display_title(doc.title.to_s),
          content_type: doc.content_type.to_s
        }
      else
        render json: { error: "Unsupported draft app or missing Embedded folder." }, status: :unprocessable_entity
      end
    end

    private

    # Tasks treat the embedded draft as a canonical saved document.
    # If the requested linked document is stale/missing, fall back to the draft
    # so refresh never drops the UI into transient Item mode.
    def resolved_task_list_document_id
      linked = openable_linked_document_id("task_list")
      return linked if linked.present?

      EmbeddedDraftDocument.fetch_or_create(user: current_user, app_key: "tasks")&.id
    rescue StandardError
      nil
    end

    def openable_linked_document_id(expected_content_type)
      did = params[:document_id].presence
      return nil if did.blank?

      doc = WorkspaceDocumentAccess.openable_document_for(current_user, did, content_type: expected_content_type)
      doc&.id
    end

    def redirect_top_level_frame_requests
      return if params[:frame_id].blank?
      return if request.headers["Turbo-Frame"].present?

      redirect_to root_path
    end

    def ensure_task_items
      @app_folder = Folder.find_or_create_by!(name: "App") do |folder|
        folder.name = "App"
      end

      # Ensure TaskList item exists
      Item.find_or_create_by!(folder_id: @app_folder.id, item_type: "task_list") do |item|
        item.folder_id = @app_folder.id
        item.name = "Tasks"
        item.item_type = "task_list"
        item.body = nil
        item.tasks = []
      end



      # Sync legacy workspace shells/config files without regenerating linked-app draft files.
      # Rare cache-clear reload spikes can trigger transient file races; retry once.
      begin
        ItemStorageSyncLite.sync_all!(username: current_user&.username)
      rescue Errno::ENOENT
        sleep 0.03
        ItemStorageSyncLite.sync_all!(username: current_user&.username)
      end
    rescue StandardError => e
      Rails.logger.error("[TasksController] ensure_task_items failed: #{e.class}: #{e.message}")
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

          text = hash["text"].to_s.strip
          next if text.empty? && subtasks.empty?

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

    def apply_linked_document_or_blank(item, expected_type)
      return unless item

      if params[:document_id].present?
        hydrate_item_from_finder_document(item, expected_type)
      elsif params[:blank].to_s == "1"
        reset_linked_item_to_blank(item, expected_type)
      end
    end

    def hydrate_item_from_finder_document(item, expected_type)
      did = params[:document_id].presence
      return if did.blank? || !item

      doc = WorkspaceDocumentAccess.openable_document_for(current_user, did, content_type: expected_type)
      return unless doc

      case expected_type
      when "task_list"
        # Linked task-list views now render directly from Document and no longer
        # overwrite the shared linked-app Item cache.
        return
      else
        item.update!(tasks: doc.tasks || [])
      end
    end

    def reset_linked_item_to_blank(item, expected_type)
      case expected_type
      when "task_list"
        item.update!(tasks: [])
      end
    end
  end
end
