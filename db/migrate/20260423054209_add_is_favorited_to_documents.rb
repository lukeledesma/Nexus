class AddIsFavoritedToDocuments < ActiveRecord::Migration[8.1]
  def change
    add_column :documents, :is_favorited, :boolean, default: false, null: false
  end
end
