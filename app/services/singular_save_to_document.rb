# frozen_string_literal: true

# Writes the singular App-folder Item (Tasks) into a user-chosen Finder folder as a Document.
class SingularSaveToDocument
  FRAME_MAP = {
    "singular-task-list-pane" => { item_type: "task_list", content_type: "task_list" },
    "notes-pane" => { item_type: nil, content_type: "note" }
  }.freeze

  def initialize(user:, folder_id:, frame_id:, filename:, document_id: nil, note_text: nil)
    @user = user
    @folder_id = folder_id.to_i
    @frame_id = frame_id.to_s
    @filename = filename.to_s
    @document_id = document_id&.to_i
    @note_text = note_text.to_s
  end

  def call
    folder = Document.find_by(id: @folder_id)
    return [:not_found, nil] unless folder&.folder?
    return [:forbidden, nil] unless folder_allowed?(folder)

    config = FRAME_MAP[@frame_id]
    config ||= { item_type: "task_list", content_type: "task_list" } if @frame_id.start_with?("task-spawn-")
    config ||= { item_type: nil, content_type: "note" } if @frame_id.start_with?("note-spawn-")
    return [:bad_request, { error: "Unknown frame" }] unless config

    item = nil
    if config[:item_type].present?
      app_folder = Folder.find_by(name: "App")
      return [:not_found, nil] unless app_folder

      item = app_folder.items.find_by(item_type: config[:item_type])
      return [:not_found, nil] unless item
    end

    title = basename_from_filename(@filename)
    return [:unprocessable_entity, { error: "Invalid filename" }] if title.blank?

    doc = find_or_build_document(folder, config[:content_type], title)
    assign_payload(doc, item, config[:content_type])

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

  def assign_payload(doc, item, content_type)
    case content_type
    when "task_list"
      doc.tasks = item.tasks
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

end
