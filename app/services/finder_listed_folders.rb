# frozen_string_literal: true

# Workspace root folder for the logged-in user (username / email as title under parent_id nil).
# Used by Finder 2 and workspace provisioning.
class FinderListedFolders
  def self.workspace_root_for(user)
    name = user.username.to_s.strip
    name = user.email.to_s.strip if name.blank?
    return nil if name.blank?

    Document.folders.where(parent_id: nil).where("LOWER(title) = ?", name.downcase).first ||
      Document.create!(is_folder: true, title: name)
  end
end
