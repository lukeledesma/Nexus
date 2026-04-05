class User < ApplicationRecord
  has_secure_password

  before_validation :normalize_login_fields
  after_create_commit :provision_workspace_root_folder
  after_update_commit :sync_workspace_after_username_change

  USERNAME_FORMAT = /\A[a-zA-Z0-9](?:[a-zA-Z0-9._-]*[a-zA-Z0-9])?\z/

  validates :email, presence: true, uniqueness: { case_sensitive: false }
  validates :password, length: { minimum: 8 }, allow_nil: true
  validates :username,
            length: { minimum: 3, maximum: 32 },
            format: { with: USERNAME_FORMAT },
            uniqueness: { case_sensitive: false },
            allow_blank: true

  def self.find_for_login(identifier)
    normalized = identifier.to_s.strip.downcase
    return nil if normalized.blank?

    where("LOWER(email) = :value OR LOWER(username) = :value", value: normalized).first
  end

  private

  def normalize_login_fields
    self.email = email.to_s.strip.downcase
    self.username = username.to_s.strip
    self.username = nil if username.blank?
  end

  def provision_workspace_root_folder
    return if username.blank?

    root_name = username.to_s.strip
    return if root_name.blank?
    root_folder = Document.folders.where(parent_id: nil).where("LOWER(title) = ?", root_name.downcase).first
    root_folder ||= Document.create!(is_folder: true, title: root_name)

    ensure_workspace_children!(root_folder)
  rescue StandardError => e
    Rails.logger.error("[User] workspace folder provision failed for #{id}: #{e.class}: #{e.message}")
  end

  def ensure_workspace_children!(root_folder)
    unless root_folder.children.folders.where("LOWER(title) = ?", "embedded").exists?
      root_folder.children.create!(is_folder: true, title: "Embedded")
    end

    finder = root_folder.children.folders.where("LOWER(title) = ?", "finder").first
    finder ||= root_folder.children.create!(is_folder: true, title: "Finder")

    %w[Desktop Documents].each do |child_name|
      next if finder.children.folders.where("LOWER(title) = ?", child_name.downcase).exists?

      finder.children.create!(is_folder: true, title: child_name)
    end
  end

  def sync_workspace_after_username_change
    return unless previous_changes.key?("username")

    from, to = previous_changes["username"]
    from = from.to_s.strip
    to = to.to_s.strip

    if from.present? && to.present?
      WorkspaceUserFolderRename.call(from: from, to: to)
    end

    provision_workspace_root_folder if to.present?
  end
end