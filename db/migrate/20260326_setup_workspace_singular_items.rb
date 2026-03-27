class SetupWorkspaceSingularItems < ActiveRecord::Migration[8.1]
  def change
    # Create or find the App folder that will hold the singular Note and TaskList
    reversible do |dir|
      dir.up do
        app_folder = Folder.find_or_create_by!(name: "App") do |f|
          f.name = "App"
        end

        # Ensure a singular Note item exists in the App folder
        Item.find_or_create_by!(folder_id: app_folder.id, name: "Notes", item_type: "note") do |item|
          item.folder_id = app_folder.id
          item.name = "Notes"
          item.item_type = "note"
          item.body = ""
          item.tasks = []
        end

        # Ensure a singular TaskList item exists in the App folder
        Item.find_or_create_by!(folder_id: app_folder.id, name: "Tasks", item_type: "task_list") do |item|
          item.folder_id = app_folder.id
          item.name = "Tasks"
          item.item_type = "task_list"
          item.body = nil
          item.tasks = []
        end
      end

      dir.down do
        app_folder = Folder.find_by(name: "App")
        app_folder&.destroy
      end
    end
  end
end
