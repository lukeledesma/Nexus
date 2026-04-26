require "test_helper"
require "securerandom"

class AppsUserUpdateUsernameTest < ActiveSupport::TestCase
  setup do
    suffix = SecureRandom.hex(4)
    @user = User.create!(
      email: "user_update_name_#{suffix}@example.com",
      username: "rename_user_#{suffix}",
      password: "password123",
      password_confirmation: "password123"
    )
  end

  teardown do
    Document.delete_all
    User.where(id: @user&.id).delete_all
  end

  test "returns password error when current password is invalid" do
    result = Apps::User::UpdateUsername.call(
      user: @user,
      new_username: "next_name",
      current_password: "wrong"
    )

    assert_equal :unprocessable_entity, result.status
    assert_equal "current_password_incorrect", result.payload[:code]
  end

  test "rolls username back when workspace rename fails" do
    previous = @user.username

    singleton = WorkspaceUserFolderRename.singleton_class
    singleton.class_eval do
      alias_method :__slice9_original_call, :call
      define_method(:call) { |_args| raise "boom" }
    end

    begin
      result = Apps::User::UpdateUsername.call(
        user: @user,
        new_username: "new_name_ok",
        current_password: "password123"
      )

      assert_equal :unprocessable_entity, result.status
      assert_equal "workspace_sync_failed", result.payload[:code]
    ensure
      singleton.class_eval do
        alias_method :call, :__slice9_original_call
        remove_method :__slice9_original_call
      end
    end

    assert_equal previous, @user.reload.username
  end
end