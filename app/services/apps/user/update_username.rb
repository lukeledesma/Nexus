# frozen_string_literal: true

module Apps
  module User
    class UpdateUsername
      class << self
        def call(user:, new_username:, current_password:)
          return password_error unless user.authenticate(current_password.to_s)

          previous_username = user.username.to_s.strip
          next_username = new_username.to_s.strip

          Current.suppress_workspace_user_sync = true
          if user.update(username: next_username)
            begin
              if previous_username.present? && next_username.present? && previous_username != next_username
                WorkspaceUserFolderRename.call(from: previous_username, to: next_username)
              end
              user.send(:provision_workspace_root_folder) if next_username.present?
              Support::OperationResult.new(status: :ok, payload: { ok: true })
            rescue StandardError
              user.update_column(:username, previous_username)
              Support::OperationResult.new(
                status: :unprocessable_entity,
                payload: {
                  ok: false,
                  code: "workspace_sync_failed",
                  message: "Could not update username right now. Please try again."
                }
              )
            end
          else
            validation_error(user)
          end
        ensure
          Current.suppress_workspace_user_sync = false
        end

        private

        def password_error
          Support::OperationResult.new(
            status: :unprocessable_entity,
            payload: { ok: false, code: "current_password_incorrect", message: "Password is incorrect." }
          )
        end

        def validation_error(user)
          message = user.errors.full_messages.to_sentence
          fields = user.errors.attribute_names.map(&:to_s).uniq
          Support::OperationResult.new(
            status: :unprocessable_entity,
            payload: { ok: false, code: "validation_error", message: message, fields: fields }
          )
        end
      end
    end
  end
end
