# frozen_string_literal: true

# Writes the singular App-folder Item (Notepad, Tasks, Sticky Notes) into a user-chosen Finder folder as a Document.
class SingularSaveToDocument
  FRAME_MAP = {
    "singular-note-pane" => { item_type: "note", content_type: "note" },
    "singular-task-list-pane" => { item_type: "task_list", content_type: "task_list" },
    "singular-sticky-notes-pane" => { item_type: "stickynotes", content_type: "stickynotes" }
  }.freeze

  def initialize(user:, folder_id:, frame_id:, filename:, document_id: nil)
    @user = user
    @folder_id = folder_id.to_i
    @frame_id = frame_id.to_s
    @filename = filename.to_s
    @document_id = document_id&.to_i
  end

  def call
    folder = Document.find_by(id: @folder_id)
    return [:not_found, nil] unless folder&.folder?
    return [:forbidden, nil] unless folder_allowed?(folder)

    config = FRAME_MAP[@frame_id]
    return [:bad_request, { error: "Unknown frame" }] unless config

    app_folder = Folder.find_by(name: "App")
    return [:not_found, nil] unless app_folder

    item = app_folder.items.find_by(item_type: config[:item_type])
    return [:not_found, nil] unless item

    title = basename_from_filename(@filename)
    return [:unprocessable_entity, { error: "Invalid filename" }] if title.blank?

    doc = find_or_build_document(folder, config[:content_type], title)
    assign_from_item(doc, item, config[:content_type])

    if doc.save
      [:ok, { document_id: doc.id, title: doc.title, storage_path: doc.storage_path.to_s }]
    else
      [:unprocessable_entity, { errors: doc.errors.full_messages }]
    end
  end

  private

  def folder_allowed?(folder)
    FinderListedFolders.user_folders(@user).exists?(folder.id)
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

  def assign_from_item(doc, item, content_type)
    case content_type
    when "note"
      doc.content = item.body.to_s
      doc.tasks = []
    when "task_list"
      doc.tasks = item.tasks
      doc.content = nil
      doc.reset_mode = "none"
      doc.reset_days = []
      doc.last_reset_at = nil
    when "stickynotes"
      doc.content = item.body.to_s
      doc.tasks = []
      doc.reset_mode = "none"
      doc.reset_days = []
      doc.last_reset_at = nil
    end
  end

  def basename_from_filename(name)
    base = File.basename(name.to_s.strip)
    base = base.sub(/\.(txt|nexus)\z/i, "")
    base.strip.presence
  end
end
