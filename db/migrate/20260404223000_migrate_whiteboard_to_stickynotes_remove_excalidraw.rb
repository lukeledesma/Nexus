# frozen_string_literal: true

class MigrateWhiteboardToStickynotesRemoveExcalidraw < ActiveRecord::Migration[7.1]
  def up
    Item.where(item_type: "excalidraw").delete_all
    Item.where(item_type: "whiteboard").update_all(
      item_type: "stickynotes",
      name: "Sticky Notes",
      updated_at: Time.current
    )
  end

  def down
    Item.where(item_type: "stickynotes").update_all(
      item_type: "whiteboard",
      name: "Whiteboard",
      updated_at: Time.current
    )
  end
end
