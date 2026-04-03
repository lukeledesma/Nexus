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
        respond_to do |format|
          format.json { render json: { ok: false, code: "current_password_incorrect", message: "Password is incorrect." }, status: :unprocessable_entity }
          format.html { redirect_back_to_user_settings(alert: "Password is incorrect.") }
        end
        return
      end

      if current_user.update(username: new_username)
        respond_to do |format|
          format.json { render json: { ok: true }, status: :ok }
          format.html { redirect_back_to_user_settings(notice: "Username updated.") }
        end
      else
        message = current_user.errors.full_messages.to_sentence
        fields = current_user.errors.attribute_names.map(&:to_s).uniq
        respond_to do |format|
          format.json { render json: { ok: false, code: "validation_error", message: message, fields: fields }, status: :unprocessable_entity }
          format.html { redirect_back_to_user_settings(alert: message) }
        end
      end
    end

    def update_password
      current_password = password_params[:current_password].to_s
      new_password = password_params[:password].to_s
      confirmation = password_params[:password_confirmation].to_s

      unless current_user.authenticate(current_password)
        respond_to do |format|
          format.json { render json: { ok: false, code: "current_password_incorrect", message: "Username/Password is incorrect." }, status: :unprocessable_entity }
          format.html { redirect_back_to_user_settings(alert: "Username/Password is incorrect.") }
        end
        return
      end

      if current_user.update(password: new_password, password_confirmation: confirmation)
        reset_session
        session[:user_id] = current_user.id
        respond_to do |format|
          format.json { render json: { ok: true }, status: :ok }
          format.html { redirect_back_to_user_settings(notice: "Credentials updated.") }
        end
      else
        fields = current_user.errors.attribute_names.map(&:to_s).uniq
        code = fields.include?("password_confirmation") ? "password_confirmation_mismatch" : "validation_error"
        message = current_user.errors.full_messages.to_sentence
        respond_to do |format|
          format.json { render json: { ok: false, code: code, message: message, fields: fields }, status: :unprocessable_entity }
          format.html { redirect_back_to_user_settings(alert: message) }
        end
      end
    end

    private

    def username_params
      params.permit(:username, :current_password, :frame_id)
    end

    def password_params
      params.permit(:current_password, :password, :password_confirmation, :frame_id)
    end

    def redirect_back_to_user_settings(flash_payload = {})
      frame_id = params[:frame_id].presence || "settings-pane"
      redirect_to apps_settings_path(section: "user", frame_id: frame_id), flash: flash_payload
    end
  end
end
