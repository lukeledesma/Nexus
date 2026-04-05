class RemoveSettingsSectionIconFromUsers < ActiveRecord::Migration[8.1]
  def change
    remove_column :users, :settings_section_icon, :string
  end
end
