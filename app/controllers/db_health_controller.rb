# frozen_string_literal: true

class DbHealthController < ApplicationController
  def show
    render json: {
      generated_at: Time.current.utc.iso8601,
      database: database_metrics,
      records: record_metrics,
      workspace: workspace_metrics,
      organizer: organizer_metrics,
      details: detail_metrics
    }
  end

  private

  def record_metrics
    {
      folders_count: Folder.where.not(name: "App").count,
      items_count: Item.count,
      users_count: User.count,
      notes_count: Item.where(item_type: "note").count,
      task_lists_count: Item.where(item_type: "task_list").count,
      max_folder_id: Folder.maximum(:id) || 0,
      item_id_total: Item.count
    }
  end

  def database_metrics
    adapter = ActiveRecord::Base.connection.adapter_name

    return { adapter: adapter } unless adapter.to_s.downcase.include?("postgres")

    connection = ActiveRecord::Base.connection
    db_size = connection.select_value("SELECT pg_database_size(current_database())")
    items_table_size = connection.select_value("SELECT pg_total_relation_size('items')")
    folders_table_size = connection.select_value("SELECT pg_total_relation_size('folders')")

    {
      adapter: adapter,
      database_size_bytes: db_size.to_i,
      items_table_size_bytes: items_table_size.to_i,
      folders_table_size_bytes: folders_table_size.to_i
    }
  rescue StandardError => e
    {
      adapter: adapter,
      error: e.message
    }
  end

  def workspace_metrics
    workspace_root = Rails.root.join("storage", "workspace")
    files = visible_workspace_files(workspace_root)

    {
      root: workspace_root.to_s,
      file_count: files.length,
      total_size_bytes: files.sum { |path| File.size(path) }
    }
  end

  def visible_workspace_file?(workspace_root, file_path)
    relative = Pathname.new(file_path).relative_path_from(workspace_root).to_s
    relative.split("/").none? { |segment| segment.start_with?(".") }
  end

  def visible_workspace_files(workspace_root)
    return [] unless workspace_root.exist?

    Dir.glob(File.join(workspace_root.to_s, "**", "*"), File::FNM_DOTMATCH)
      .select { |path| File.file?(path) }
      .select { |path| visible_workspace_file?(workspace_root, path) }
  end

  def workspace_file_details
    workspace_root = Rails.root.join("storage", "workspace")

    visible_workspace_files(workspace_root)
      .sort
      .map do |path|
        relative = Pathname.new(path).relative_path_from(workspace_root).to_s
        {
          name: relative,
          size_bytes: File.size(path)
        }
      end
  end

  def detail_metrics
    {
      folders: Folder.where.not(name: "App").order(:id).pluck(:id, :name).map { |id, name| { id: id, name: name } },
      items: Item.order(:id).pluck(:id, :item_type, :name).map { |id, item_type, name| { id: id, item_type: item_type, name: name } },
      users: User.order(:id).pluck(:id, :email).map { |id, email| { id: id, email: email } },
      item_ids: Item.order(:id).pluck(:id),
      workspace_files: workspace_file_details,
      db_tables: db_table_details
    }
  end

  def organizer_metrics
    note_updated_at = workspace_item_updated_at("Notes.txt")
    task_updated_at = workspace_item_updated_at("Tasks.txt")
    note_size = workspace_item_size("Notes.txt")
    task_size = workspace_item_size("Tasks.txt")

    latest = [
      { label: "Notes", updated_at: note_updated_at },
      { label: "Tasks", updated_at: task_updated_at }
    ].select { |entry| entry[:updated_at].present? }
      .max_by { |entry| entry[:updated_at] }

    {
      note_updated_at: note_updated_at&.utc&.iso8601,
      task_updated_at: task_updated_at&.utc&.iso8601,
      note_size_bytes: note_size,
      task_size_bytes: task_size,
      last_updated: latest.present? ? { label: latest[:label], updated_at: latest[:updated_at].utc.iso8601 } : nil
    }
  end

  def workspace_item_size(file_name)
    workspace_root = Rails.root.join("storage", "workspace")
    file_path = workspace_root.join(file_name)
    return nil unless file_path.exist?
    File.size(file_path)
  rescue StandardError
    nil
  end

  def workspace_item_updated_at(file_name)
    workspace_root = Rails.root.join("storage", "workspace")
    file_path = workspace_root.join(file_name)
    return nil unless file_path.exist?

    updated_line = File.foreach(file_path).find { |line| line.start_with?("# updated_at:") }
    return nil unless updated_line

    raw_value = updated_line.split(":", 2).last.to_s.strip
    return nil if raw_value.blank? || raw_value == "null"

    Time.zone.parse(raw_value)
  rescue StandardError
    nil
  end

  def db_table_details
    adapter = ActiveRecord::Base.connection.adapter_name
    return [] unless adapter.to_s.downcase.include?("postgres")

    connection = ActiveRecord::Base.connection

    # Fetch all user tables with their total sizes from the current schema
    rows = connection.select_all(<<~SQL)
      SELECT
        relname AS table_name,
        pg_total_relation_size(relid) AS size_bytes
      FROM pg_stat_user_tables
      ORDER BY size_bytes DESC
    SQL

    rows.map { |row| { name: row["table_name"], size_bytes: row["size_bytes"].to_i } }
  rescue StandardError
    []
  end
end
