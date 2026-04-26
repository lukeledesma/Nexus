# frozen_string_literal: true

module Tasks
  class SaveFile
    def self.call(user:, folder_id:, frame_id:, filename:, requested_document_id:, note_text:, task_payload:)
      new(
        user: user,
        folder_id: folder_id,
        frame_id: frame_id,
        filename: filename,
        requested_document_id: requested_document_id,
        note_text: note_text,
        task_payload: task_payload
      ).call
    end

    def initialize(user:, folder_id:, frame_id:, filename:, requested_document_id:, note_text:, task_payload:)
      @user = user
      @folder_id = folder_id.to_s
      @frame_id = frame_id.to_s
      @filename = filename.to_s
      @requested_document_id = requested_document_id
      @note_text = note_text
      @task_payload = task_payload
    end

    def call
      if @folder_id.blank? || @frame_id.blank? || @filename.blank?
        return Support::OperationResult.new(status: :bad_request, payload: { error: "folder_id, frame_id, and filename are required" })
      end

      document_id = normalize_save_document_id
      result, payload = LinkedAppSaveToDocument.new(
        user: @user,
        folder_id: @folder_id,
        frame_id: @frame_id,
        filename: @filename,
        document_id: document_id,
        note_text: @note_text,
        task_payload: @task_payload
      ).call

      return Support::OperationResult.new(status: result, payload: payload) unless result == :ok

      is_embedded_draft_save = document_id.blank?
      if is_embedded_draft_save
        app_key = infer_app_key_from_frame_id(@frame_id)
        EmbeddedDraftDocument.clear_draft!(user: @user, app_key: app_key) if app_key.present?
      end

      Support::OperationResult.new(
        status: :ok,
        payload: payload.merge(cleared_embedded_draft: is_embedded_draft_save)
      )
    end

    private

    def infer_app_key_from_frame_id(frame_id)
      case frame_id
      when "tasks-pane", /^task-spawn-/
        "tasks"
      when "notes-pane", /^note-spawn-/
        "notes"
      when "time-card-pane", /^time-card-spawn-/
        "time-card"
      end
    end

    def normalize_save_document_id
      return nil if @requested_document_id.blank?

      doc_id = @requested_document_id.to_i
      return nil if doc_id <= 0

      app_key = infer_app_key_from_frame_id(@frame_id)
      return doc_id if app_key.blank?

      draft = EmbeddedDraftDocument.fetch_or_create(user: @user, app_key: app_key)
      return nil if draft && draft.id == doc_id

      doc_id
    rescue StandardError
      doc_id
    end
  end
end
