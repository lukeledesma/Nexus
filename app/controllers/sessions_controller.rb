class SessionsController < ApplicationController
  skip_before_action :require_login, only: %i[new create]

  def new
    return unless logged_in?

    redirect_to root_path
  end

  def create
    identifier = params[:identifier]
    user = User.find_for_login(identifier)

    if user&.authenticate(params[:password].to_s)
      session[:user_id] = user.id
      redirect_to root_path
    else
      @login_error = "Invalid email/username or password"
      @identifier = identifier.to_s
      render :new, status: :unprocessable_entity
    end
  end

  def destroy
    reset_session
    redirect_to login_path
  end
end