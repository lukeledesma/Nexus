# frozen_string_literal: true

# Single-tenant deployments: the sole user should be the org admin (admin@nxs.tools / admin).
# Earlier migrations only renamed admin@example.com; personal emails were left unchanged.
class NormalizeSingleTenantUserToAdmin < ActiveRecord::Migration[8.1]
  def up
    return if User.count != 1

    user = User.first
    return if user.email.to_s.downcase == "admin@nxs.tools" && user.username.to_s == "admin"

    if User.where.not(id: user.id).where("LOWER(email) = ?", "admin@nxs.tools").exists?
      warn "[NormalizeSingleTenantUserToAdmin] skipped: admin@nxs.tools already in use"
      return
    end

    if User.where.not(id: user.id).where("LOWER(username) = ?", "admin").exists?
      warn "[NormalizeSingleTenantUserToAdmin] skipped: username admin already in use"
      return
    end

    user.update!(email: "admin@nxs.tools", username: "admin")
  rescue ActiveRecord::RecordInvalid => e
    warn "[NormalizeSingleTenantUserToAdmin] skipped: #{e.message}"
  end

  def down
    raise ActiveRecord::IrreversibleMigration
  end
end
