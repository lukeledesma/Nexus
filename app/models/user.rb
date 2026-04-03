class User < ApplicationRecord
  has_secure_password

  before_validation :normalize_login_fields
  after_create_commit :provision_workspace_root_folder

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
    %w[Documents Embedded].each do |child_name|
      next if root_folder.children.folders.where("LOWER(title) = ?", child_name.downcase).exists?

      root_folder.children.create!(is_folder: true, title: child_name)
    end
  end
end