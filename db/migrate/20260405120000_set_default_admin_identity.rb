# frozen_string_literal: true

class SetDefaultAdminIdentity < ActiveRecord::Migration[8.1]
  def up
    legacy = User.find_by("LOWER(email) = ?", "admin@example.com")
    return unless legacy
    if User.where.not(id: legacy.id).where("LOWER(email) = ?", "admin@nxs.tools").exists?
      warn "[SetDefaultAdminIdentity] skipped: admin@nxs.tools already taken"
      return
    end

    legacy.update!(email: "admin@nxs.tools", username: "admin")
  rescue ActiveRecord::RecordInvalid => e
    warn "[SetDefaultAdminIdentity] skipped: #{e.message}"
  end

  def down
    raise ActiveRecord::IrreversibleMigration
  end
end
