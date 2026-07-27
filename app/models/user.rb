class User < ApplicationRecord
  has_secure_password

  has_many :user_app_states, dependent: :delete_all

  before_validation :normalize_login_fields
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

end
