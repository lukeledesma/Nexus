# frozen_string_literal: true

class DropLegacyItemsAndFolders < ActiveRecord::Migration[8.1]
  def up
    drop_table :items, if_exists: true
    drop_table :folders, if_exists: true
  end

  def down
    create_table :folders do |t|
      t.string :name
      t.timestamps
    end

    create_table :items do |t|
      t.references :folder, null: false, foreign_key: true
      t.string :item_type
      t.string :name
      t.text :body
      t.jsonb :tasks
      t.timestamps
    end
  end
end
