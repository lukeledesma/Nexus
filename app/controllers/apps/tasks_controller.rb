# frozen_string_literal: true

module Apps
  class TasksController < BaseController
    skip_before_action :sync_from_disk, only: %i[draft_file save_file]

    before_action :redirect_top_level_frame_requests, only: %i[show]
    before_action :ensure_task_document, only: %i[show]

    # GET /apps/tasks
    def show
      @linked_document_id = @task_document.id
      @task_list_updated_at = @task_document.updated_at
      @tasks_for_view = normalize_tasks(@task_document.tasks || [])
      @linked_document_display_title = helpers.finder_document_display_title(@task_document.title.to_s)
    end



    # POST /apps/tasks/save_file
    def save_file
      result = Tasks::SaveFile.call(
        user: current_user,
        folder_id: params[:folder_id].presence,
        frame_id: params[:frame_id],
        filename: params[:filename],
        requested_document_id: params[:document_id].presence,
        note_text: params[:note_text],
        task_payload: params[:task_payload]
      )

      case result.status
      when :ok
        payload = result.payload || {}
        display_title = helpers.finder_document_display_title(payload[:title])
        render json: payload.merge(
          ok: true,
          display_title: display_title,
          cleared_embedded_draft: payload[:cleared_embedded_draft]
        )
      when :not_found
        head :not_found
      when :forbidden
        head :forbidden
      when :unprocessable_entity
        render json: result.payload || { error: "Could not save file." }, status: :unprocessable_entity
      when :bad_request
        render json: result.payload, status: :bad_request
      else
        head :internal_server_error
      end
    end

    # GET /apps/tasks/draft_file?app_key=tasks|quartz
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

    def resolved_task_document
      did = params[:document_id].presence
      if did.present?
        result = Apps::OpenLinkedDocument.call(
          user: current_user,
          document_id: did,
          content_type: "task_list",
          section_key: "documents",
          allow_embedded: true
        )
        return result.payload.fetch(:document) if result.success?
      end

      EmbeddedDraftDocument.fetch_or_create(user: current_user, app_key: "tasks")
    rescue StandardError
      nil
    end

    def redirect_top_level_frame_requests
      return if params[:frame_id].blank?
      return if request.headers["Turbo-Frame"].present?

      redirect_to root_path
    end

    def ensure_task_document
      @task_document = resolved_task_document
      return if @task_document

      render plain: "Task document unavailable", status: :unprocessable_entity
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
  end
end
