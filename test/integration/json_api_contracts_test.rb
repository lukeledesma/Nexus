# frozen_string_literal: true

require "test_helper"
require "securerandom"

# Contract tests for JSON endpoints used by the desktop shell and future user features.
# Add new cases here when you expose additional JSON APIs.
class JsonApiContractsTest < ActionDispatch::IntegrationTest
  setup do
    suffix = SecureRandom.hex(4)
    @user = User.create!(
      email: "json_api_contracts_#{suffix}@example.com",
      username: "json_api_user_#{suffix}",
      password: "password123",
      password_confirmation: "password123"
    )
  end

  teardown do
    Document.delete_all
    UserAppState.delete_all
    User.where(id: @user&.id).delete_all
  end

  test "rails health check does not require authentication" do
    get "/up"

    assert_response :success
  end

  test "workspace preferences JSON requires login" do
    get workspace_preferences_path, as: :json

    assert_response :redirect
    assert_redirected_to login_path
  end

  test "workspace preferences show returns stable JSON keys when authenticated" do
    post login_path, params: { identifier: @user.email, password: "password123" }

    get workspace_preferences_path, as: :json

    assert_response :success
    body = response.parsed_body
    assert_equal "default", body.fetch("active_theme_id")
    assert body.key?("appearance")
    assert body.key?("themes")
    assert body.key?("wallpaper_background_kind")
  end

  test "workspace preferences update accepts theme apply payload" do
    post login_path, params: { identifier: @user.email, password: "password123" }

    patch workspace_preferences_path,
      params: { theme: { action: "apply", theme_id: "default" } },
      as: :json

    assert_response :success
    assert_equal "default", response.parsed_body.fetch("active_theme_id")
  end

  test "apps user username update returns JSON error shape when validation fails" do
    post login_path, params: { identifier: @user.email, password: "password123" }

    patch apps_user_username_path,
      params: { username: "renamed_user", current_password: "wrong", frame_id: "user-pane" },
      as: :json

    assert_response :unprocessable_entity
    body = response.parsed_body
    assert_equal "current_password_incorrect", body.fetch("code")
    assert body.fetch("message").to_s.present?
  end
end
