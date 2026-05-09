class CreateUserAppStates < ActiveRecord::Migration[8.1]
  def change
    create_table :user_app_states do |t|
      t.references :user, null: false, foreign_key: true, index: false
      t.string :key, null: false
      t.jsonb :data, null: false, default: {}
      t.timestamps
    end

    add_index :user_app_states, [:user_id, :key], unique: true
    add_index :user_app_states, :key
  end
end
