# frozen_string_literal: true

class RemoveStickynotesFeature < ActiveRecord::Migration[7.1]
  def up
    Item.where(item_type: "stickynotes").delete_all
    Document.where(content_type: "stickynotes").delete_all
  end

  def down
    raise ActiveRecord::IrreversibleMigration
  end
end
