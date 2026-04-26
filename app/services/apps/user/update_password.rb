# frozen_string_literal: true

module Apps
  module User
    class UpdatePassword
      class << self
        def call(user:, current_password:, new_password:, confirmation:)
          unless user.authenticate(current_password.to_s)
            return Support::OperationResult.new(
              status: :unprocessable_entity,
              payload: {
                ok: false,
                code: "current_password_incorrect",
                message: "Username/Password is incorrect."
              }
            )
          end

          if user.update(password: new_password.to_s, password_confirmation: confirmation.to_s)
            Support::OperationResult.new(status: :ok, payload: { ok: true })
          else
            fields = user.errors.attribute_names.map(&:to_s).uniq
            code = fields.include?("password_confirmation") ? "password_confirmation_mismatch" : "validation_error"
            message = user.errors.full_messages.to_sentence
            Support::OperationResult.new(
              status: :unprocessable_entity,
              payload: { ok: false, code: code, message: message, fields: fields }
            )
          end
        end
      end
    end
  end
end