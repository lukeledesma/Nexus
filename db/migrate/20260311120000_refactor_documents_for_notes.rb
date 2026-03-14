# frozen_string_literal: true

class RefactorDocumentsForNotes < ActiveRecord::Migration[8.1]
  def change
    add_column :documents, :title, :string
    add_column :documents, :content, :text

    remove_column :documents, :records, :json
    remove_column :documents, :metadata_filename, :string
    remove_column :documents, :metadata_ip, :string
    remove_column :documents, :metadata_protocol, :string
    remove_column :documents, :new_untitled_placeholder, :boolean
    remove_column :documents, :edited_by, :string
    remove_column :documents, :edit_note, :text
  end
end
