# frozen_string_literal: true

class RemoveNoteItemsAfterNotepadRemoval < ActiveRecord::Migration[8.1]
  def up
    execute "DELETE FROM items WHERE item_type = 'note'"
  end

  def down
    raise ActiveRecord::IrreversibleMigration
  end
end
