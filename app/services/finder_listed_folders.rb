# frozen_string_literal: true

# User-visible folders under <workspace>/Finder/ (excludes Desktop & Documents from the sidebar).
class FinderListedFolders
  def self.user_folders(user)
    return Document.none unless user

    ff = finder_folder_for(user)
    return Document.none unless ff

    ff.children.folders
      .where.not("LOWER(title) IN (?)", %w[desktop documents])
      .order(Arel.sql("LOWER(title) ASC"))
  end

  def self.finder_folder_for(user)
    root = workspace_root_for(user)
    return nil unless root

    f = root.children.folders.where("LOWER(title) = ?", "finder").first
    f ||= root.children.create!(is_folder: true, title: "Finder")
    f
  end

  def self.workspace_root_for(user)
    name = user.username.to_s.strip
    name = user.email.to_s.strip if name.blank?
    return nil if name.blank?

    Document.folders.where(parent_id: nil).where("LOWER(title) = ?", name.downcase).first ||
      Document.create!(is_folder: true, title: name)
  end
end
