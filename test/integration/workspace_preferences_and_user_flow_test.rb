require "test_helper"
require "securerandom"

class WorkspacePreferencesAndUserFlowTest < ActionDispatch::IntegrationTest
  setup do
    suffix = SecureRandom.hex(4)
    @user = User.create!(
      email: "prefs_user_flow_#{suffix}@example.com",
      username: "prefs_flow_user_#{suffix}",
      password: "password123",
      password_confirmation: "password123"
    )
    post login_path, params: { identifier: @user.email, password: "password123" }
    FinderWorkspaceInitializer.ensure_for_user!(@user)
  end

  teardown do
    Document.delete_all
    User.where(id: @user&.id).delete_all
  end

  test "workspace preferences show returns expected payload shape" do
    get workspace_preferences_path, as: :json

    assert_response :success
    body = response.parsed_body
    assert_equal "default", body.fetch("active_theme_id")
    assert body.key?("appearance")
    assert body.key?("wallpaper_background_kind")
  end

  test "workspace preferences update rejects gradient apply" do
    patch workspace_preferences_path, params: { apply_theme_gradient: { theme_id: "default" } }, as: :json

    assert_response :unprocessable_entity
    assert_match(/gradient wallpaper is no longer supported/i, response.parsed_body.fetch("error"))
  end

  test "update username rejects wrong current password" do
    patch apps_user_username_path,
      params: { username: "renamed_user", current_password: "wrong", frame_id: "user-pane" },
      as: :json

    assert_response :unprocessable_entity
    assert_equal "current_password_incorrect", response.parsed_body.fetch("code")
  end

  test "update password rejects confirmation mismatch" do
    patch apps_user_password_path,
      params: {
        current_password: "password123",
        password: "newpassword123",
        password_confirmation: "different",
        frame_id: "user-pane"
      },
      as: :json

    assert_response :unprocessable_entity
    assert_equal "password_confirmation_mismatch", response.parsed_body.fetch("code")
  end
end