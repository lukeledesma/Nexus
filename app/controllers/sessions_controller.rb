class SessionsController < ApplicationController
  skip_before_action :require_login, only: %i[new create]

  def new
    return unless logged_in?

    redirect_to root_path
  end

  def create
    user = User.find_by(email: params[:email].to_s.downcase.strip)

    if user&.authenticate(params[:password].to_s)
      session[:user_id] = user.id
      redirect_to root_path
    else
      @login_error = "Invalid email or password"
      render :new, status: :unprocessable_entity
    end
  end

  def destroy
    reset_session
    redirect_to login_path
  end
end