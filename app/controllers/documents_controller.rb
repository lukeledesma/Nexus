# frozen_string_literal: true

require "marcel"

class DocumentsController < ApplicationController
  before_action :sync_from_disk, only: %i[index organizer_fragment]
  before_action :set_document, only: %i[show edit update destroy create_file create_subfolder move_folder move_file upload_images rename file_list asset_file]

  def index
    set_no_cache_headers
    load_organizer_data
  end

  def new
    redirect_to root_path
  end

  def organizer_fragment
    load_organizer_data
    render partial: "organizer"
  end

  def create_root_folder
    folder_name = next_folder_name
    folder = Document.new(is_folder: true, title: folder_name)

    unless folder.save
      render plain: "Could not create folder.", status: :unprocessable_entity
      return
    end

    flash.now[:created_folder_id] = folder.id
    flash.now[:created_folder_name] = folder_name
    load_organizer_data
    render partial: "organizer"
  end

  def file_list
    unless @document.folder?
      render plain: "Folder required", status: :unprocessable_entity
      return
    end

    load_organizer_data
    folder_entry = @browser_folders.find { |entry| entry[:folder]&.id == @document.id }
    files = folder_entry ? folder_entry[:files] : []

    render partial: "folder_file_list", locals: { files: files }
  end

  # Stream on-disk asset bytes (e.g. .wav) for inline preview in FL Mini and similar UIs.
  def asset_file
    unless @document.file? && @document.content_type.to_s == "asset"
      head :not_found
      return
    end

    path = @document.asset_disk_path
    unless path&.file?
      head :not_found
      return
    end

    ext = File.extname(path.to_s).downcase
    ctype =
      case ext
      when ".wav" then "audio/wav"
      else Rack::Mime.mime_type(ext, "application/octet-stream")
      end
    send_file path.to_s,
              type: ctype,
              disposition: "inline",
              filename: File.basename(path.to_s)
  end

  def create
    if params[:new_folder].present?
      folder = Document.new(is_folder: true, title: next_folder_name)
      if folder.save
        flash[:created_folder_id] = folder.id
        flash[:created_folder_name] = folder.title
        redirect_to root_path
      else
        redirect_to root_path, alert: "Could not create folder."
      end
      return
    end

    redirect_to root_path
  end

  def show
    render :edit
  end

  def edit
    if @document.folder?
      redirect_to root_path, alert: "Open an item to edit."
      return
    end
  end

  def update
    if @document.folder?
      render json: { error: "Folders cannot be edited as items." }, status: :unprocessable_entity
      return
    end

    @document.title = params.dig(:document, :title).to_s.strip.presence || @document.title

    if @document.content_type == "task_list"
      @document.tasks = parse_tasks_payload
    else
      @document.content = params.dig(:document, :content).to_s
    end

    if @document.save
      head :no_content
    else
      render json: { error: @document.errors.full_messages.to_sentence }, status: :unprocessable_entity
    end
  end

  def create_subfolder
    unless @document.folder?
      render json: { error: "Parent must be a folder" }, status: :unprocessable_entity
      return
    end

    title = params[:title].to_s.strip
    if title.blank?
      render json: { error: "Folder name is required." }, status: :unprocessable_entity
      return
    end

    if title.start_with?(".")
      render json: { error: "Name cannot start with a period" }, status: :unprocessable_entity
      return
    end

    child = Document.new(is_folder: true, parent: @document, title: title)

    if child.save
      render json: { ok: true, id: child.id, title: child.title }
    else
      render json: { error: child.errors.full_messages.to_sentence }, status: :unprocessable_entity
    end
  end

  def create_file
    unless @document.folder?
      redirect_to root_path, alert: "Items can only be created inside folders."
      return
    end

    content_type = normalize_content_type(params[:content_type])
    initial_content = nil

    item = Document.new(
      is_folder: false,
      parent: @document,
      title: next_item_title(@document, content_type),
      content_type: content_type,
      content: initial_content,
      tasks: [],
      reset_mode: "none",
      reset_days: []
    )

    if item.save
      if request.xhr? || request.format.json?
        render json: { ok: true, folder_id: @document.id, file_id: item.id }
        return
      end

      flash[:created_file_id] = item.id
      redirect_to root_path
    else
      if request.xhr? || request.format.json?
        render json: { error: "Could not create item." }, status: :unprocessable_entity
        return
      end

      redirect_to root_path, alert: "Could not create item."
    end
  end

  def move_folder
    unless @document.folder?
      render json: { error: "Only folders can be moved." }, status: :unprocessable_entity
      return
    end

    if @document.user_workspace_root? || @document.protected_workspace_structure?
      render json: { error: "This folder cannot be moved." }, status: :forbidden
      return
    end

    finder_root = Apps::FinderController.workspace_finder_root_folder(current_user)
    unless finder_root && Apps::FinderController.document_in_finder_subtree?(finder_root, @document)
      render json: { error: "Folder is not in Finder." }, status: :forbidden
      return
    end

    new_parent, err = finder_reparent_target_or_error(finder_root)
    if err
      render json: { error: err.fetch(:message) }, status: err.fetch(:status)
      return
    end

    if new_parent.id == @document.id || node_within_folder_tree?(@document, new_parent)
      render json: { error: "Cannot move a folder into itself or its subfolder." }, status: :unprocessable_entity
      return
    end

    finder_apply_reparent_json!(new_parent)
  end

  def move_file
    unless @document.file?
      render json: { error: "Only files can be moved with this action." }, status: :unprocessable_entity
      return
    end

    finder_root = Apps::FinderController.workspace_finder_root_folder(current_user)
    unless finder_root && Apps::FinderController.document_in_finder_subtree?(finder_root, @document)
      render json: { error: "File is not in Finder." }, status: :forbidden
      return
    end

    new_parent, err = finder_reparent_target_or_error(finder_root)
    if err
      render json: { error: err.fetch(:message) }, status: err.fetch(:status)
      return
    end

    finder_apply_reparent_json!(new_parent)
  end

  # Multipart POST: `files` or `files[]` — JPEG/PNG/MP3, into a Finder folder or Embedded/Image.
  def upload_images
    unless @document.folder?
      render json: { error: "Upload into a folder only." }, status: :unprocessable_entity
      return
    end

    finder_root = Apps::FinderController.workspace_finder_root_folder(current_user)
    in_finder = finder_root && Apps::FinderController.document_in_finder_subtree?(finder_root, @document)
    iimage_folder = EmbeddedIimageFolder.document_for(current_user)
    in_iimage = iimage_folder && @document.id == iimage_folder.id

    unless in_finder || in_iimage
      render json: { error: "Can only upload into allowed folders." }, status: :forbidden
      return
    end

    if @document.protected_workspace_structure?
      render json: { error: "Cannot upload into that folder." }, status: :forbidden
      return
    end

    list = normalize_uploaded_file_list(params[:files])
    if list.empty?
      render json: { error: "No files received." }, status: :unprocessable_entity
      return
    end

    allowed_mime = %w[
      image/jpeg image/png audio/mpeg audio/mp3 audio/wav audio/x-wav audio/wave audio/vnd.wave
    ].freeze
    allowed_ext = %w[.jpg .jpeg .png .mp3 .wav].freeze

    created_ids = []
    errors = []

    list.each do |uploaded|
      ext = File.extname(uploaded.original_filename.to_s).downcase
      unless allowed_ext.include?(ext)
        errors << "#{uploaded.original_filename}: only JPG, PNG, MP3, and WAV are allowed."
        next
      end

      mime = Marcel::MimeType.for(Pathname.new(uploaded.tempfile.path))
      unless allowed_mime.include?(mime)
        errors << "#{uploaded.original_filename}: file is not a valid JPG, PNG, MP3, or WAV."
        next
      end

      stem = File.basename(uploaded.original_filename.to_s, ext)
      stem = stem.gsub(/[^\p{L}\p{N}\s._-]/u, "_").strip
      stem = "Asset" if stem.blank?

      bytes = uploaded.read
      uploaded.rewind if uploaded.respond_to?(:rewind)

      doc = Document.new(
        is_folder: false,
        parent: @document,
        title: stem,
        content_type: "asset",
        pending_disk_extension: ext,
        pending_asset_bytes: bytes
      )

      if doc.save
        created_ids << doc.id
      else
        errors << "#{uploaded.original_filename}: #{doc.errors.full_messages.to_sentence}"
      end
    end

    if created_ids.any?
      files_payload =
        Document.where(id: created_ids).order(:id).map do |d|
          ext = File.extname(d.storage_path.to_s).downcase
          {
            id: d.id,
            name: d.title.to_s,
            ext: ext,
            kind_label: case ext
                        when ".png" then "PNG"
                        when ".mp3" then "MP3"
                        when ".wav" then "WAV"
                        else "JPEG"
                        end
          }
        end
      render json: { ok: true, ids: created_ids, files: files_payload, errors: errors }
    elsif errors.any?
      render json: { error: errors.join(" ") }, status: :unprocessable_entity
    else
      render json: { error: "Could not upload files." }, status: :unprocessable_entity
    end
  end

  def rename
    if @document.user_workspace_root?
      render json: { error: "User root folders cannot be renamed." }, status: :forbidden
      return
    end

    if @document.protected_workspace_structure?
      render json: { error: "This folder cannot be renamed." }, status: :forbidden
      return
    end

    name = params[:name].to_s.strip
    if name.blank?
      render json: { error: "Name cannot be blank" }, status: :unprocessable_entity
      return
    end

    if name.start_with?(".")
      render json: { error: "Name cannot start with a period" }, status: :unprocessable_entity
      return
    end

    @document.title = name

    if @document.save
      render json: { ok: true, name: @document.title }
    else
      render json: { error: @document.errors.full_messages.to_sentence }, status: :unprocessable_entity
    end
  end

  def destroy
    if @document.user_workspace_root?
      message = "User root folders are protected."
      if request.xhr? || request.format.json?
        render json: { error: message }, status: :forbidden
      else
        redirect_to root_path, alert: message
      end
      return
    end

    if @document.protected_workspace_structure?
      message = "This folder is part of the workspace layout and cannot be deleted."
      if request.xhr? || request.format.json?
        render json: { error: message }, status: :forbidden
      else
        redirect_to root_path, alert: message
      end
      return
    end

    @document.destroy

    if request.xhr? || request.format.json?
      head :no_content
    else
      redirect_to root_path
    end
  end

  private

  def set_document
    sync_from_disk
    @document = Document.find(params[:id])
  rescue ActiveRecord::RecordNotFound
    redirect_to root_path, alert: "Item was not found on disk."
  end

  def sync_from_disk
    return if @disk_synced

    DocumentDiskLoader.sync!
    @disk_synced = true
  rescue StandardError => e
    Rails.logger.error("[DocumentDiskLoader] sync failed: #{e.class}: #{e.message}")
  end

  def set_no_cache_headers
    response.headers["Cache-Control"] = "no-store, no-cache, must-revalidate, max-age=0"
    response.headers["Pragma"] = "no-cache"
  end

  def load_organizer_data
    sync_from_disk

    folders = Document.folders.includes(:children).order(Arel.sql("LOWER(title) ASC"))

    @browser_folders = folders.map do |folder|
      files = folder.children.files.order(Arel.sql("LOWER(title) ASC")).map do |file_doc|
        {
          name: file_doc.title,
          document: file_doc,
          content_type: file_doc.content_type
        }
      end

      {
        name: folder.title,
        title: folder.title,
        folder: folder,
        files: files
      }
    end

    @root_files = Document.files.where(parent_id: nil).order(Arel.sql("LOWER(title) ASC"))
    @has_organizer_content = @browser_folders.any? || @root_files.any?
    @sidebar_task_lists = Item.task_lists.ordered
    @folders = Folder.where.not(name: "App").includes(:items).ordered
  end

  def next_folder_name
    base = "Untitled Folder"
    names = Document.folders.pluck(:title).map(&:to_s)
    return base unless names.include?(base)

    nums = names
      .map { |name| name[/^#{Regexp.escape(base)} (\d+)$/, 1]&.to_i }
      .compact
      .select { |num| num >= 2 }
      .uniq
      .sort

    expected = 2
    nums.each do |num|
      return "#{base} #{expected}" if num != expected

      expected += 1
    end

    "#{base} #{expected}"
  end

  def next_item_title(folder, content_type)
    base = case content_type.to_s
           when "task_list" then "Untitled Task List"
           else "Untitled Note"
           end
    names = folder.children.files.where(content_type: content_type).pluck(:title).map(&:to_s)
    return base unless names.include?(base)

    suffixes = names
      .map { |name| name[/^#{Regexp.escape(base)} (\d+)$/, 1]&.to_i }
      .compact
      .select { |num| num >= 2 }
      .uniq
      .sort

    expected = 2
    suffixes.each do |num|
      return "#{base} #{expected}" if num != expected

      expected += 1
    end

    "#{base} #{expected}"
  end

  def normalize_content_type(raw)
    value = raw.to_s
    return value if Document::CONTENT_TYPES.include?(value)

    "task_list"
  end

  # --- Finder tree reparent (move_folder / move_file) ---

  # Returns [new_parent, nil] or [nil, { message:, status: }] for JSON error responses.
  def finder_reparent_target_or_error(finder_root)
    parent_id = params[:parent_id].presence&.to_i
    if parent_id.blank? || parent_id <= 0
      return [nil, { message: "Choose a folder to move into.", status: :unprocessable_entity }]
    end

    new_parent = Document.find_by(id: parent_id)
    unless new_parent&.folder?
      return [nil, { message: "Invalid folder.", status: :unprocessable_entity }]
    end

    unless Apps::FinderController.document_in_finder_subtree?(finder_root, new_parent)
      return [nil, { message: "Can only move into folders in Finder.", status: :forbidden }]
    end

    if new_parent.protected_workspace_structure?
      return [nil, { message: "Cannot move into that folder.", status: :forbidden }]
    end

    [new_parent, nil]
  end

  def finder_apply_reparent_json!(new_parent)
    @document.parent = new_parent
    if @document.save
      render json: { ok: true, id: @document.id, parent_id: new_parent.id }
    else
      render json: { error: @document.errors.full_messages.to_sentence }, status: :unprocessable_entity
    end
  end

  # True if +node+ is +folder+ or any descendant of +folder+ (walk parents from +node+).
  def node_within_folder_tree?(folder, node)
    p = node
    while p
      return true if p.id == folder.id
      p = p.parent
    end
    false
  end

  def normalize_uploaded_file_list(raw)
    return [] if raw.blank?

    arr = raw.is_a?(Array) ? raw.compact : [raw]
    arr.select { |f| f.respond_to?(:tempfile) && f.respond_to?(:read) }
  end

  def parse_tasks_payload
    raw = params.dig(:document, :tasks_payload).to_s
    parsed = JSON.parse(raw)
    return [] unless parsed.is_a?(Array)

    parsed.filter_map do |task|
      next unless task.is_a?(Hash)

      subtasks = Array(task["subtasks"]).filter_map do |subtask|
        next unless subtask.is_a?(Hash)

        {
          "text" => subtask["text"].to_s,
          "checked" => ActiveModel::Type::Boolean.new.cast(subtask["checked"])
        }
      end

      checked = ActiveModel::Type::Boolean.new.cast(task["checked"])
      checked = subtasks.present? ? subtasks.all? { |subtask| subtask["checked"] } : checked

      {
        "text" => task["text"].to_s,
        "checked" => checked,
        "subtasks" => subtasks
      }
    end
  rescue JSON::ParserError
    []
  end

end
