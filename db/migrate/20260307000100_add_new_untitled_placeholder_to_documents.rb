class AddNewUntitledPlaceholderToDocuments < ActiveRecord::Migration[8.1]
  def change
    add_column :documents, :new_untitled_placeholder, :boolean, default: false, null: false
  end
end
