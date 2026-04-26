# frozen_string_literal: true

class DocumentsController < ApplicationController
  before_action :sync_from_disk, only: %i[index organizer_fragment]
  before_action :set_document, only: %i[show edit update destroy create_file create_subfolder move_folder move_file upload_images rename toggle_favorite file_list asset_file]

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

    result = persist_document(folder, operation: :create)
    unless result.success?
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
      result = persist_document(folder, operation: :create)
      if result.success?
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

    result = persist_document(@document, operation: :update)
    if result.success?
      head :no_content
    else
      render json: { error: @document.errors.full_messages.to_sentence }, status: :unprocessable_entity
    end
  end

  def create_subfolder
    result = Documents::CreateSubfolder.call(parent: @document, title: params[:title])
    if result.success?
      render json: { ok: true, id: result.payload[:id], title: result.payload[:title] }
    else
      render json: { error: result.error }, status: result.status
    end
  end

  def create_file
    result = Documents::CreateFile.call(parent: @document, content_type: params[:content_type])
    if result.success?
      if request.xhr? || request.format.json?
        render json: { ok: true, folder_id: result.payload[:folder_id], file_id: result.payload[:file_id] }
        return
      end

      flash[:created_file_id] = result.payload[:file_id]
      redirect_to root_path
    else
      if request.xhr? || request.format.json?
        render json: { error: result.error }, status: result.status
        return
      end

      redirect_to root_path, alert: result.error
    end
  end

  def move_folder
    result = Documents::MoveDocument.call(
      user: current_user,
      document: @document,
      parent_id: params[:parent_id],
      kind: :folder
    )

    if result.success?
      render json: { ok: true, id: result.payload[:id], parent_id: result.payload[:parent_id] }
    else
      render json: { error: result.error }, status: result.status
    end
  end

  def move_file
    result = Documents::MoveDocument.call(
      user: current_user,
      document: @document,
      parent_id: params[:parent_id],
      kind: :file
    )

    if result.success?
      render json: { ok: true, id: result.payload[:id], parent_id: result.payload[:parent_id] }
    else
      render json: { error: result.error }, status: result.status
    end
  end

  # Multipart POST: `files` or `files[]` — drops into Finder sections or Wallpaper.
  def upload_images
    result = Documents::UploadFiles.call(user: current_user, folder: @document, files: params[:files])

    if result.success?
      render json: { ok: true, ids: result.payload[:ids], files: result.payload[:files], errors: result.payload[:errors] }
    else
      render json: { error: result.error }, status: result.status
    end
  end

  def rename
    policy = ::DocumentPolicy.new(user: current_user, document: @document)
    if policy.user_workspace_root?
      render json: { error: "User root folders cannot be renamed." }, status: :forbidden
      return
    end

    unless policy.can_rename?
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

    result = persist_document(@document, operation: :update)
    if result.success?
      render json: { ok: true, name: @document.title }
    else
      render json: { error: @document.errors.full_messages.to_sentence }, status: :unprocessable_entity
    end
  end

  def toggle_favorite
    policy = ::DocumentPolicy.new(user: current_user, document: @document)

    unless favorites_column_available?
      render json: { error: "Favorites are temporarily unavailable." }, status: :service_unavailable
      return
    end

    if policy.user_workspace_root?
      render json: { error: "This item cannot be favorited." }, status: :forbidden
      return
    end

    unless policy.can_toggle_favorite?(favorites_available: true)
      render json: { error: "Only files can be favorited." }, status: :unprocessable_entity
      return
    end

    @document.toggle!(:is_favorited)
    render json: { is_favorited: favorited_flag_for(@document) }, status: :ok
  end

  def destroy
    policy = ::DocumentPolicy.new(user: current_user, document: @document)
    if policy.user_workspace_root?
      message = "User root folders are protected."
      if request.xhr? || request.format.json?
        render json: { error: message }, status: :forbidden
      else
        redirect_to root_path, alert: message
      end
      return
    end

    unless policy.can_delete?
      message = "This folder is part of the workspace layout and cannot be deleted."
      if request.xhr? || request.format.json?
        render json: { error: message }, status: :forbidden
      else
        redirect_to root_path, alert: message
      end
      return
    end

    result = DocumentPersistence.destroy(@document)
    unless result.success?
      message = result.error.presence || "Could not delete item."
      if request.xhr? || request.format.json?
        render json: { error: message }, status: :unprocessable_entity
      else
        redirect_to root_path, alert: message
      end
      return
    end

    if request.xhr? || request.format.json?
      head :no_content
    else
      redirect_to root_path
    end
  end

  private

  def set_document
    @document = Document.find(params[:id])
  rescue ActiveRecord::RecordNotFound
    redirect_to root_path, alert: "Item was not found on disk."
  end

  def sync_from_disk
    return if @disk_synced

    # Request-time sync keeps DB and disk aligned without treating transient
    # filesystem gaps as confirmed deletes.
    DocumentDiskLoader.sync!(purge_missing: false)
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

  def favorites_column_available?
    Document.column_names.include?("is_favorited")
  rescue StandardError
    false
  end

  def favorited_flag_for(document)
    return document.is_favorited? if document.respond_to?(:is_favorited?)

    false
  end

  def persist_document(document, operation:)
    result = DocumentPersistence.persist(document, operation: operation)
    return result if result.success?

    if result.error.present? && document.errors.empty?
      document.errors.add(:base, result.error)
    end
    result
  end

end

