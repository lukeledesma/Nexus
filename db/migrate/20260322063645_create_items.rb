class CreateItems < ActiveRecord::Migration[8.1]
  def change
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
