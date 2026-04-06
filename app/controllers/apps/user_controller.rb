# frozen_string_literal: true

module Apps
  class UserController < BaseController
    def show
      render layout: false if turbo_frame_request?
    end

    def update_username
      new_username = username_params[:username].to_s.strip
      current_password = username_params[:current_password].to_s

      unless current_user.authenticate(current_password)
        render json: { ok: false, code: "current_password_incorrect", message: "Password is incorrect." }, status: :unprocessable_entity
        return
      end

      if current_user.update(username: new_username)
        render json: { ok: true }, status: :ok
      else
        message = current_user.errors.full_messages.to_sentence
        fields = current_user.errors.attribute_names.map(&:to_s).uniq
        render json: { ok: false, code: "validation_error", message: message, fields: fields }, status: :unprocessable_entity
      end
    end

    def update_password
      current_password = password_params[:current_password].to_s
      new_password = password_params[:password].to_s
      confirmation = password_params[:password_confirmation].to_s

      unless current_user.authenticate(current_password)
        render json: { ok: false, code: "current_password_incorrect", message: "Username/Password is incorrect." }, status: :unprocessable_entity
        return
      end

      if current_user.update(password: new_password, password_confirmation: confirmation)
        reset_session
        session[:user_id] = current_user.id
        render json: { ok: true }, status: :ok
      else
        fields = current_user.errors.attribute_names.map(&:to_s).uniq
        code = fields.include?("password_confirmation") ? "password_confirmation_mismatch" : "validation_error"
        message = current_user.errors.full_messages.to_sentence
        render json: { ok: false, code: code, message: message, fields: fields }, status: :unprocessable_entity
      end
    end

    private

    def username_params
      params.permit(:username, :current_password, :frame_id)
    end

    def password_params
      params.permit(:current_password, :password, :password_confirmation, :frame_id)
    end
  end
end
