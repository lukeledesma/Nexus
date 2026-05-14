# frozen_string_literal: true

class AddPerformanceIndexesToDocuments < ActiveRecord::Migration[8.1]
  def change
    # Compound index for the dominant query pattern: children of a folder that are files/folders.
    # Covers Document.where(parent_id: X, is_folder: true/false) used throughout Finder.
    add_index :documents, %i[parent_id is_folder], name: "index_documents_on_parent_id_and_is_folder"

    # Partial index for favorites — only indexes the rows that matter for the Favorites section.
    add_index :documents, :is_favorited,
              where: "is_favorited = TRUE",
              name: "index_documents_on_is_favorited_true"
  end
end
