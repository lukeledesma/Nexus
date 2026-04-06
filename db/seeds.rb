# This file should ensure the existence of records required to run the application in every environment (production,
# development, test). The code here should be idempotent so that it can be executed at any point in every environment.
# The data can then be loaded with the bin/rails db:seed command (or created alongside the database with db:setup).

# Default admin: sign in with email admin@nxs.tools or username "admin".
# Password is set only for new users (or when password_digest is blank). Existing passwords are kept.
user =
  case User.count
  when 0
    User.new
  when 1
    User.first
  else
    User.find_by("LOWER(email) = ?", "admin@example.com") ||
      User.find_or_initialize_by(email: "admin@nxs.tools")
  end

user.email = "admin@nxs.tools"
user.username = "admin"

if user.new_record? || user.password_digest.blank?
  pwd = ENV.fetch("NEXUS_SEED_PASSWORD", "password")
  user.password = pwd
  user.password_confirmation = pwd
end

user.save!
