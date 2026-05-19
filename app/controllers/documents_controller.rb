# frozen_string_literal: true

class DocumentsController < ApplicationController
  PANEL_SEARCH_MAX_RESULTS = 40

  before_action :sync_from_disk, only: %i[index organizer_fragment panel_search]
  before_action :set_document, only: %i[show edit update destroy restore_from_trash permanent_delete create_file create_subfolder move_folder move_file upload_images rename toggle_favorite file_list asset_file thumbnail]

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

  def panel_search
    query = params[:q].to_s.strip
    if query.blank?
      render json: { ok: true, query: "", name_matches: [], content_matches: [] }
      return
    end

    results = build_panel_search_results(query)

    render json: {
      ok: true,
      query: query,
      name_matches: results[:name_matches],
      content_matches: results[:content_matches]
    }
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

    if Rails.env.production?
      # Production: Use X-Accel-Redirect for nginx to serve file directly (fast, non-blocking)
      # nginx serves the file without tying up a Puma thread - critical for performance
      internal_path = x_accel_path_for(path)
      response.headers["X-Accel-Redirect"] = internal_path
      response.headers["Content-Type"] = ctype
      response.headers["Content-Disposition"] = "inline; filename=#{File.basename(path.to_s)}"
      response.headers["X-Accel-Buffering"] = "yes"
      head :ok
    else
      # Development: Use send_file (no nginx to do X-Accel-Redirect)
      send_file path.to_s,
                type: ctype,
                disposition: "inline",
                filename: File.basename(path.to_s)
    end
  end

  # Serve the generated WebP thumbnail for an image asset.
  def thumbnail
    unless @document.file? && @document.content_type.to_s == "asset"
      head :not_found
      return
    end

    path = safe_thumbnail_path_for(@document)
    unless path
      head :not_found
      return
    end

    if Rails.env.production?
      internal_path = x_accel_path_for(path)
      response.headers["X-Accel-Redirect"] = internal_path
      response.headers["Content-Type"] = "image/webp"
      response.headers["Content-Disposition"] = "inline; filename=thumb_#{@document.id}.webp"
      response.headers["X-Accel-Buffering"] = "yes"
      head :ok
    else
      send_data path.binread, type: "image/webp", disposition: "inline"
    end
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
      nil
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
      # Broadcast content change to all user sessions for real-time sync.
      # All document types go through the single broadcast_document_change path.
      case @document.content_type
      when "note"
        UserSyncChannel.broadcast_document_change(
          user: current_user,
          document_id: @document.id,
          content_type: @document.content_type,
          content: @document.content.to_s,
          updated_at: @document.updated_at.utc.iso8601
        )
      when "task_list"
        normalized_tasks = normalize_tasks_for_broadcast(@document.tasks)
        UserSyncChannel.broadcast_document_change(
          user: current_user,
          document_id: @document.id,
          content_type: @document.content_type,
          tasks: normalized_tasks,
          updated_at: @document.updated_at.utc.iso8601
        )
      when "calendar_events"
        UserSyncChannel.broadcast_document_change(
          user: current_user,
          document_id: @document.id,
          content_type: @document.content_type,
          updated_at: @document.updated_at.utc.iso8601
        )
      end
      head :no_content
    else
      render json: { error: @document.errors.full_messages.to_sentence }, status: :unprocessable_entity
    end
  end

  def create_subfolder
    result = Documents::CreateSubfolder.call(parent: @document, title: params[:title])
    if result.success?
      UserSyncChannel.broadcast_workspace_change(user: current_user, kind: "finder")
      render json: { ok: true, id: result.payload[:id], title: result.payload[:title] }
    else
      render json: { error: result.error }, status: result.status
    end
  end

  def create_file
    result = Documents::CreateFile.call(parent: @document, content_type: params[:content_type])
    if result.success?
      UserSyncChannel.broadcast_workspace_change(user: current_user, kind: "finder")
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
      UserSyncChannel.broadcast_workspace_change(user: current_user, kind: "finder")
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
      UserSyncChannel.broadcast_workspace_change(user: current_user, kind: "finder")
      render json: { ok: true, id: result.payload[:id], parent_id: result.payload[:parent_id] }
    else
      render json: { error: result.error }, status: result.status
    end
  end

  # Multipart POST: `files` or `files[]` — drops into Finder sections or Wallpaper.
  def upload_images
    result = Documents::UploadFiles.call(user: current_user, folder: @document, files: params[:files])

    if result.success?
      UserSyncChannel.broadcast_workspace_change(user: current_user, kind: "finder")
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

  def restore_from_trash
    result = Documents::RestoreFromTrash.call(user: current_user, document: @document)
    unless result.success?
      render json: { error: result.error.presence || "Could not restore item." }, status: :unprocessable_entity
      return
    end

    UserSyncChannel.broadcast_workspace_change(user: current_user, kind: "finder")
    render json: {
      ok: true,
      id: result.payload[:id],
      parent_id: result.payload[:parent_id]
    }
  end

  def permanent_delete
    unless @document.file?
      render json: { error: "Only files can be permanently deleted." }, status: :unprocessable_entity
      return
    end

    trash_root = Apps::FinderController.workspace_trash_root(current_user)
    unless trash_root && @document.parent_id == trash_root.id
      render json: { error: "Only items in Trash can be permanently deleted." }, status: :forbidden
      return
    end

    result = DocumentPersistence.destroy(@document)
    unless result.success?
      render json: { error: result.error.presence || "Could not permanently delete item." }, status: :unprocessable_entity
      return
    end

    UserSyncChannel.broadcast_workspace_change(user: current_user, kind: "finder")
    head :no_content
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

    result =
      if @document.file?
        Documents::TrashDocument.call(user: current_user, document: @document)
      else
        DocumentPersistence.destroy(@document)
      end
    unless result.success?
      message = result.error.presence || "Could not delete item."
      if request.xhr? || request.format.json?
        render json: { error: message }, status: :unprocessable_entity
      else
        redirect_to root_path, alert: message
      end
      return
    end

    UserSyncChannel.broadcast_workspace_change(user: current_user, kind: "finder")

    if request.xhr? || request.format.json?
      head :no_content
    else
      redirect_to root_path
    end
  end

  def normalize_tasks_for_broadcast(value)
    Array(value).filter_map do |task|
      next unless task.respond_to?(:to_h)

      hash = task.to_h
      text = hash["text"].to_s.strip
      subtasks = Array(hash["subtasks"]).filter_map do |subtask|
        next unless subtask.respond_to?(:to_h)

        sub_hash = subtask.to_h
        sub_text = sub_hash["text"].to_s.strip
        next if sub_text.empty?

        {
          "text" => sub_text,
          "checked" => ActiveModel::Type::Boolean.new.cast(sub_hash["checked"])
        }
      end

      next if text.empty? && subtasks.empty?

      checked = subtasks.present? ? subtasks.all? { |sub| sub["checked"] } : ActiveModel::Type::Boolean.new.cast(hash["checked"])
      {
        "text" => text,
        "checked" => checked,
        "subtasks" => subtasks
      }
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

  def build_panel_search_results(query)
    files = panel_search_files_for_workspace
    downcased_query = query.to_s.downcase
    name_matches = []
    content_matches = []

    files.each do |doc|
      display_title = panel_search_display_title(doc.title)
      payload = panel_search_result_payload(doc, display_title)
      next unless payload

      if display_title.downcase.include?(downcased_query)
        name_matches << payload
        next
      end

      searchable = panel_search_searchable_content(doc)
      content_matches << payload if searchable.downcase.include?(downcased_query)
    end

    name_matches.sort_by! { |item| item[:document_title].downcase }
    content_matches.sort_by! { |item| item[:document_title].downcase }

    {
      name_matches: name_matches.first(PANEL_SEARCH_MAX_RESULTS),
      content_matches: content_matches.first(PANEL_SEARCH_MAX_RESULTS)
    }
  end

  def panel_search_files_for_workspace
    section_roots = Apps::FinderController.workspace_section_roots(current_user).values.compact
    root_ids = section_roots.map(&:id).uniq
    return [] if root_ids.empty?

    placeholders = ([ "?" ] * root_ids.length).join(",")
    sql = <<~SQL.squish
      WITH RECURSIVE subtree AS (
        SELECT *
        FROM documents
        WHERE id IN (#{placeholders})
        UNION ALL
        SELECT d.*
        FROM documents d
        INNER JOIN subtree t ON d.parent_id = t.id
      )
      SELECT *
      FROM subtree
      WHERE is_folder = FALSE
    SQL

    Document.find_by_sql(Document.sanitize_sql_array([ sql, *root_ids ]))
  rescue StandardError
    []
  end

  def panel_search_display_title(title)
    # Search uses the same title users see in Finder; hidden storage suffixes stay hidden.
    helpers.finder_document_display_title(title).sub(/\.dotfield\z/i, "").strip.presence || "Untitled"
  end

  def panel_search_searchable_content(document)
    [ document.content.to_s, document.tasks.to_json ].join("\n")
  end

  def panel_search_result_payload(document, display_title)
    app_key = panel_search_app_key_for(document)
    return nil if app_key.blank?

    {
      document_id: document.id.to_s,
      document_title: display_title,
      app_key: app_key,
      icon: panel_search_icon_for(app_key)
    }
  end

  def panel_search_app_key_for(document)
    content_type = document.content_type.to_s
    section_key = Apps::FinderController.origin_section_key_from_storage_path(document.storage_path)

    case content_type
    when "note"
      "quartz"
    when "task_list"
      "tasks"
    when "asset"
      extension = File.extname(document.storage_path.to_s)
      extension = File.extname(document.title.to_s) if extension.blank?
      case helpers.finder_asset_file_kind_from_extension(extension)
      when "image" then "images"
      when "audio" then "audio"
      end
    end
  end

  def panel_search_icon_for(app_key)
    {
      "quartz" => "sticky_note",
      "tasks" => "task_checklist",
      "images" => "wallpaper",
      "audio" => "graphic_eq"
    }[app_key.to_s] || "file_document"
  end

  def load_organizer_data
    sync_from_disk

    folders = Document.folders.includes(:children).order(Arel.sql("LOWER(title) ASC"))

    @browser_folders = folders.map do |folder|
      # Use the preloaded :children association and filter in Ruby — avoids one query per folder.
      files = folder.children
        .reject(&:folder?)
        .sort_by { |f| f.title.to_s.downcase }
        .map do |file_doc|
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
    # Scope to root-level folders only — no need to scan the entire documents table.
    names = Document.where(is_folder: true, parent_id: nil).pluck(:title).map(&:to_s)
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

    tasks = parsed.filter_map do |task|
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

    strip_trailing_blank_main_tasks(tasks)
  rescue JSON::ParserError
    []
  end

  def strip_trailing_blank_main_tasks(tasks)
    while tasks.any? && blank_main_task_row?(tasks.last)
      tasks.pop
    end
    tasks
  end

  def blank_main_task_row?(task)
    task["text"].to_s.strip.blank? && task["subtasks"].to_a.empty?
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

    if result.success? && finder_structure_changed?(document, operation)
      UserSyncChannel.broadcast_workspace_change(user: current_user, kind: "finder")
    end

    return result if result.success?

    if result.error.present? && document.errors.empty?
      document.errors.add(:base, result.error)
    end
    result
  end

  def finder_structure_changed?(document, operation)
    return true if operation.to_sym == :create

    changed = document.previous_changes.keys.map(&:to_s)
    (changed & %w[title parent_id content_type is_folder]).any?
  end

  def safe_thumbnail_path_for(document)
    return nil unless document&.id.present?

    thumbnails_root = DocumentStorageSyncLite.storage_root.join(".thumbnails")
    candidate = thumbnails_root.join("#{document.id}.webp")

    begin
      root_real = thumbnails_root.realpath
    rescue StandardError
      root_real = thumbnails_root.expand_path
    end

    begin
      candidate_real = candidate.realpath
    rescue StandardError
      candidate_real = candidate.expand_path
    end

    root_real_str = root_real.to_s
    candidate_real_str = candidate_real.to_s
    return nil unless candidate_real_str.start_with?("#{root_real_str}/")
    return nil unless candidate_real.file?

    candidate_real
  end
end

  def x_accel_path_for(file_path)
    # Rails needs to map the disk path to an internal nginx path
    # storage/workspace/{user}/path/to/file -> /assets-internal/workspace/{user}/path/to/file
    # nginx is configured to serve /assets-internal paths from the storage directory
    
    file_str = file_path.to_s
    
    # Handle both absolute and relative paths
    # Extract the part after storage/workspace/
    if file_str.include?("/storage/workspace/")
      # /Users/.../storage/workspace/user123/Embedded/image.png -> workspace/user123/Embedded/image.png
      relative = file_str.split("/storage/workspace/").last
      "/assets-internal/workspace/#{relative}"
    else
      # Fallback - shouldn't happen in normal operation
      raise "Unable to map asset path: #{file_str}"
    end
  end
