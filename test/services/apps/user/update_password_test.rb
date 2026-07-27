require "test_helper"
require "securerandom"

class AppsUserUpdatePasswordTest < ActiveSupport::TestCase
  setup do
    suffix = SecureRandom.hex(4)
    @user = User.create!(
      email: "user_update_password_#{suffix}@example.com",
      username: "pwd_user_#{suffix}",
      password: "password123",
      password_confirmation: "password123"
    )
  end

  teardown do
    UserAppState.delete_all
    User.where(id: @user&.id).delete_all
  end

  test "returns error when current password is invalid" do
    result = Apps::User::UpdatePassword.call(
      user: @user,
      current_password: "wrong",
      new_password: "newpassword123",
      confirmation: "newpassword123"
    )

    assert_equal :unprocessable_entity, result.status
    assert_equal "current_password_incorrect", result.payload[:code]
  end

  test "returns confirmation mismatch code" do
    result = Apps::User::UpdatePassword.call(
      user: @user,
      current_password: "password123",
      new_password: "newpassword123",
      confirmation: "mismatch"
    )

    assert_equal :unprocessable_entity, result.status
    assert_equal "password_confirmation_mismatch", result.payload[:code]
  end
end
