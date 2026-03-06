class AddVersioningToDocuments < ActiveRecord::Migration[8.1]
  def change
    add_column :documents, :parent_id, :integer
    add_column :documents, :edited_by, :string
    add_column :documents, :edit_note, :text
  end
end
