# frozen_string_literal: true

class DocumentsController < ApplicationController
  before_action :sync_from_disk, only: %i[index organizer_fragment]
  before_action :set_document, only: %i[show edit update destroy create_file rename file_list]

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
    prepare_workspace
    render :edit
  end

  def edit
    if @document.folder?
      redirect_to root_path, alert: "Open an item to edit."
      return
    end

    prepare_workspace
  end

  def update
    if @document.folder?
      render json: { error: "Folders cannot be edited as items." }, status: :unprocessable_entity
      return
    end

    @document.title = params.dig(:document, :title).to_s.strip.presence || @document.title

    if @document.content_type == "task_list"
      @document.tasks = parse_tasks_payload
      @document.reset_days = parse_reset_days
      @document.reset_mode = @document.reset_days.any? ? "custom" : "none"
      @document.last_reset_at = parse_last_reset_at
    else
      @document.content = params.dig(:document, :content).to_s
    end

    if @document.save
      head :no_content
    else
      render json: { error: @document.errors.full_messages.to_sentence }, status: :unprocessable_entity
    end
  end

  def create_file
    unless @document.folder?
      redirect_to root_path, alert: "Items can only be created inside folders."
      return
    end

    content_type = normalize_content_type(params[:content_type])
    item = Document.new(
      is_folder: false,
      parent: @document,
      title: next_item_title(@document, content_type),
      content_type: content_type,
      content: (content_type == "note" ? "" : nil),
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

  def rename
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
    @sidebar_notes = Item.notes.ordered
    @sidebar_task_lists = Item.task_lists.ordered
    @folders = Folder.includes(:items).ordered
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
    base = (content_type == "task_list" ? "Untitled Task List" : "Untitled Note")
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

    "note"
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

  def parse_reset_days
    Array(params.dig(:document, :reset_days)).filter_map do |value|
      day = value.to_i
      day if day.between?(0, 6)
    end.uniq.sort
  end

  def parse_last_reset_at
    raw = params.dig(:document, :last_reset_at).to_s
    return nil if raw.blank?

    Time.zone.parse(raw)
  rescue ArgumentError, TypeError
    nil
  end

  def prepare_workspace
    return unless @document.content_type == "task_list"

    apply_due_reset!(@document)
  end

  def apply_due_reset!(document)
    days = Array(document.reset_days).map(&:to_i)
    return if days.empty?

    now = Time.zone.now
    today_index = now.wday
    return unless days.include?(today_index)

    today_reset_time = now.beginning_of_day + 7.hours
    return if now < today_reset_time
    return if document.last_reset_at.present? && document.last_reset_at >= today_reset_time

    reset_tasks = Array(document.tasks).map do |task|
      value = task.respond_to?(:to_h) ? task.to_h : {}
      subtasks = Array(value["subtasks"]).filter_map do |subtask|
        next unless subtask.respond_to?(:to_h)

        subtask_value = subtask.to_h
        { "text" => subtask_value["text"].to_s, "checked" => false }
      end

      {
        "text" => value["text"].to_s,
        "checked" => false,
        "subtasks" => subtasks
      }
    end

    document.update_columns(tasks: reset_tasks, last_reset_at: today_reset_time, updated_at: Time.current)
    document.tasks = reset_tasks
    document.last_reset_at = today_reset_time
    DocumentStorageSyncLite.new(document).update
  end
end
