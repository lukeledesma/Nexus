# frozen_string_literal: true

class AddTaskListFieldsToDocuments < ActiveRecord::Migration[8.1]
  def up
    add_column :documents, :content_type, :string, default: "note", null: false unless column_exists?(:documents, :content_type)
    add_column :documents, :tasks, :jsonb, default: [], null: false unless column_exists?(:documents, :tasks)
    add_column :documents, :reset_mode, :string, default: "none", null: false unless column_exists?(:documents, :reset_mode)
    add_column :documents, :reset_days, :integer, array: true, default: [], null: false unless column_exists?(:documents, :reset_days)
    add_column :documents, :last_reset_at, :datetime unless column_exists?(:documents, :last_reset_at)

    add_index :documents, :content_type unless index_exists?(:documents, :content_type)

    return unless column_exists?(:documents, :reset_days)
    return if columns(:documents).find { |column| column.name == "reset_days" }&.sql_type_metadata&.type == :integer

    execute <<~SQL
      ALTER TABLE documents
      ALTER COLUMN reset_days DROP DEFAULT,
      ALTER COLUMN reset_days TYPE integer[]
      USING COALESCE(reset_days, ARRAY[]::varchar[])::integer[],
      ALTER COLUMN reset_days SET DEFAULT ARRAY[]::integer[];
    SQL
  end

  def down
    remove_index :documents, :content_type if index_exists?(:documents, :content_type)
    remove_column :documents, :last_reset_at if column_exists?(:documents, :last_reset_at)
    remove_column :documents, :reset_days if column_exists?(:documents, :reset_days)
    remove_column :documents, :reset_mode if column_exists?(:documents, :reset_mode)
    remove_column :documents, :tasks if column_exists?(:documents, :tasks)
    remove_column :documents, :content_type if column_exists?(:documents, :content_type)
  end
end
