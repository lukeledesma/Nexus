# frozen_string_literal: true

module Apps
  class UserController < BaseController
    def show
      render_with_turbo_support layout: false
    end

    def update_username
      result = Apps::User::UpdateUsername.call(
        user: current_user,
        new_username: username_params[:username],
        current_password: username_params[:current_password]
      )
      render json: result.payload, status: result.success? ? :ok : :unprocessable_entity
    end

    def update_password
      result = Apps::User::UpdatePassword.call(
        user: current_user,
        current_password: password_params[:current_password],
        new_password: password_params[:password],
        confirmation: password_params[:password_confirmation]
      )

      if result.success?
        reset_session
        session[:user_id] = current_user.id
        render json: result.payload, status: :ok
      else
        render json: result.payload, status: :unprocessable_entity
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
