# frozen_string_literal: true

# Writes a linked app document into a user-chosen Finder folder.
class LinkedAppSaveToDocument
  FRAME_MAP = {
    "tasks-pane" => { content_type: "task_list", app_key: "tasks" },
    "notes-pane" => { content_type: "note", app_key: "notes" },
    "time-card-pane" => { content_type: "note", app_key: "time-card" }
  }.freeze

  def initialize(user:, folder_id:, frame_id:, filename:, document_id: nil, note_text: nil, task_payload: nil)
    @user = user
    @folder_id = folder_id.to_i
    @frame_id = frame_id.to_s
    @filename = filename.to_s
    @document_id = document_id&.to_i
    @note_text = note_text.to_s
    @task_payload = task_payload.to_s
  end

  def call
    folder = Document.find_by(id: @folder_id)
    return [:not_found, nil] unless folder&.folder?
    return [:forbidden, nil] unless folder_allowed?(folder)

    config = FRAME_MAP[@frame_id]
    config ||= { content_type: "task_list", app_key: "tasks" } if @frame_id.start_with?("task-spawn-")
    config ||= { content_type: "note", app_key: "notes" } if @frame_id.start_with?("note-spawn-")
    config ||= { content_type: "note", app_key: "time-card" } if @frame_id.start_with?("time-card-spawn-")
    return [:bad_request, { error: "Unknown frame" }] unless config

    title = basename_from_filename(@filename)
    return [:unprocessable_entity, { error: "Invalid filename" }] if title.blank?

    doc = find_or_build_document(folder, config[:content_type], title)
    assign_payload(doc, config[:content_type], config[:app_key])

    if doc.save
      [:ok, { document_id: doc.id, title: doc.title, storage_path: doc.storage_path.to_s }]
    else
      [:unprocessable_entity, { errors: doc.errors.full_messages }]
    end
  end

  private

  def folder_allowed?(folder)
    return false unless folder.folder?

    Apps::FinderController.document_in_any_finder_section?(@user, folder)
  end

  def find_or_build_document(folder, content_type, title)
    if @document_id.present? && @document_id.positive?
      existing = Document.find_by(id: @document_id)
      if existing&.file? && existing.parent_id == folder.id
        existing.content_type = content_type
        return existing
      end
    end

    existing = folder.children.files.where("LOWER(title) = ?", title.downcase).first
    if existing
      existing.content_type = content_type
      return existing
    end

    Document.new(parent: folder, is_folder: false, title: title, content_type: content_type)
  end

  def assign_payload(doc, content_type, app_key)
    case content_type
    when "task_list"
      # Use task_payload if provided and valid from the frontend, otherwise fall back to embedded draft tasks.
      tasks_assigned = false
      if @task_payload.present?
        begin
          parsed_tasks = JSON.parse(@task_payload)
          if parsed_tasks.is_a?(Array)
            doc.tasks = parsed_tasks
            tasks_assigned = true
          end
        rescue JSON::ParserError => e
          Rails.logger.warn("[LinkedAppSaveToDocument] Failed to parse task_payload: #{e.message}")
        end
      end

      # Fall back to embedded draft payload if frontend payload is unavailable.
      doc.tasks = source_task_payload(app_key) unless tasks_assigned
      doc.content = nil
      doc.reset_mode = "none"
      doc.reset_days = []
      doc.last_reset_at = nil
    when "note"
      doc.content = @note_text
      doc.tasks = []
      doc.reset_mode = "none"
      doc.reset_days = []
      doc.last_reset_at = nil
    end
  end

  def basename_from_filename(name)
    base = File.basename(name.to_s.strip)
    base = base.sub(/\.(txt|md|nexus|rtf)\z/i, "")
    base.strip.presence
  end

  def source_task_payload(app_key)
    draft = EmbeddedDraftDocument.fetch_or_create(user: @user, app_key: app_key.to_s)
    Array(draft&.tasks)
  rescue StandardError
    []
  end

end
