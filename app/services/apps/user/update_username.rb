# frozen_string_literal: true

module Apps
  module User
    class UpdateUsername
      class << self
        def call(user:, new_username:, current_password:)
          return password_error unless user.authenticate(current_password.to_s)

          next_username = new_username.to_s.strip

          if user.update(username: next_username)
            Support::OperationResult.new(status: :ok, payload: { ok: true })
          else
            validation_error(user)
          end
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
