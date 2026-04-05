class AddSettingsSectionIconToUsers < ActiveRecord::Migration[8.1]
  def change
    add_column :users, :settings_section_icon, :string
  end
end
