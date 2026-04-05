# frozen_string_literal: true

# Moves legacy storage/username/Documents/* into storage/username/Finder/Documents/
# and ensures username/Finder/Desktop exists. Embedded stays at username/Embedded.
class MigrateFinderDesktopDocumentsLayout < ActiveRecord::Migration[7.1]
  def up
    User.where.not(username: [nil, ""]).find_each do |user|
      username = user.username.to_s.strip
      next if username.blank?

      root = Document.folders.where(parent_id: nil).where("LOWER(title) = ?", username.downcase).first
      next unless root

      finder = root.children.folders.where("LOWER(title) = ?", "finder").first
      finder ||= Document.create!(is_folder: true, parent: root, title: "Finder")

      finder.children.folders.where("LOWER(title) = ?", "desktop").first ||
        Document.create!(is_folder: true, parent: finder, title: "Desktop")

      new_documents = finder.children.folders.where("LOWER(title) = ?", "documents").first ||
        Document.create!(is_folder: true, parent: finder, title: "Documents")

      old_root_documents = root.children.folders.where("LOWER(title) = ?", "documents").where.not(id: new_documents.id).first
      next unless old_root_documents

      Document.where(parent_id: old_root_documents.id).find_each do |child|
        child.update!(parent: new_documents)
      end

      old_root_documents.reload
      old_root_documents.destroy! if old_root_documents.children.none?
    end
  end

  def down
    raise ActiveRecord::IrreversibleMigration
  end
end
