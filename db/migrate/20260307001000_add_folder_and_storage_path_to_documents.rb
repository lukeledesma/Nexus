class AddFolderAndStoragePathToDocuments < ActiveRecord::Migration[8.1]
  def change
    add_column :documents, :is_folder, :boolean, default: false, null: false
    add_column :documents, :storage_path, :string
    add_index :documents, :is_folder
  end
end
