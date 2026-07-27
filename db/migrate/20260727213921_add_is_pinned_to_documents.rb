class AddIsPinnedToDocuments < ActiveRecord::Migration[8.1]
  def change
    add_column :documents, :is_pinned, :boolean, default: false, null: false
    add_index :documents, :is_pinned, where: "(is_pinned = true)", name: "index_documents_on_is_pinned_true"
  end
end
