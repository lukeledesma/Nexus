# frozen_string_literal: true

class RemoveKanbanAndThoughtWall < ActiveRecord::Migration[8.1]
  def up
    Item.where(item_type: %w[kanban thought_wall]).delete_all

    say_with_time "convert kanban/thought_wall documents to notes" do
      Document.where(content_type: %w[kanban thought_wall]).find_each do |doc|
        doc.update!(
          content_type: "note",
          content: "<p><em>This file was a board type that is no longer available; it was converted to a note.</em></p>",
          tasks: [],
          reset_mode: "none",
          reset_days: [],
          last_reset_at: nil
        )
      end
    end
  end

  def down
    raise ActiveRecord::IrreversibleMigration
  end
end
