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
    UserAppState.delete_all
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

  test "workspace preferences update without wallpaper params preserves wallpaper" do
    images_root = Apps::FinderController.workspace_section_root(@user, "images")
    doc = images_root.children.create!(title: "preserve-wall.jpg", is_folder: false, content_type: "asset", content: "")
    doc.update_columns(storage_path: "Finder/Images/preserve-wall.jpg")

    manager = WorkspacePreferences::Manager.new(user: @user)
    result = manager.apply_wallpaper_image(doc.id)
    assert result.success?
    manager.persist!

    patch workspace_preferences_path,
      params: { appearance: { hue: 210, saturation: 10, brightness: 20, transparency: 0.9 } },
      as: :json

    assert_response :success
    body = response.parsed_body
    assert_equal "image", body.fetch("wallpaper_background_kind")
    assert_equal doc.id, body.fetch("wallpaper_image_document_id")

    refreshed = WorkspacePreferences::Manager.new(user: @user).payload.payload
    assert_equal "image", refreshed.fetch("wallpaper_background_kind")
    assert_equal doc.id, refreshed.fetch("wallpaper_image_document_id")
  end

  test "workspace preferences show does not clear wallpaper when referenced doc is missing" do
    UserAppState.put(user: @user, key: WorkspacePreferences::Manager::WORKSPACE_STATE_KEY, value: {
      active_theme_id: "default",
      wallpaper_background_kind: "image",
      wallpaper_image_document_id: 999_999
    })

    get workspace_preferences_path, as: :json

    assert_response :success
    body = response.parsed_body
    assert_equal "image", body.fetch("wallpaper_background_kind")
    assert_equal 999_999, body.fetch("wallpaper_image_document_id")

    stored = UserAppState.find_by(user: @user, key: WorkspacePreferences::Manager::WORKSPACE_STATE_KEY)&.data
    assert_equal "image", stored.fetch("wallpaper_background_kind")
    assert_equal 999_999, stored.fetch("wallpaper_image_document_id")
  end

  test "workspace preferences show does not clear wallpaper when referenced doc is ineligible" do
    workspace_root = Apps::FinderController.workspace_root_folder(@user)
    ineligible = Document.create!(
      parent: workspace_root,
      is_folder: false,
      title: "Ineligible Note",
      content_type: "note",
      content: "x"
    )

    UserAppState.put(user: @user, key: WorkspacePreferences::Manager::WORKSPACE_STATE_KEY, value: {
      active_theme_id: "default",
      wallpaper_background_kind: "image",
      wallpaper_image_document_id: ineligible.id
    })

    get workspace_preferences_path, as: :json

    assert_response :success
    body = response.parsed_body
    assert_equal "image", body.fetch("wallpaper_background_kind")
    assert_equal ineligible.id, body.fetch("wallpaper_image_document_id")

    stored = UserAppState.find_by(user: @user, key: WorkspacePreferences::Manager::WORKSPACE_STATE_KEY)&.data
    assert_equal "image", stored.fetch("wallpaper_background_kind")
    assert_equal ineligible.id, stored.fetch("wallpaper_image_document_id")
  end

  test "workspace preferences show heals stale wallpaper id from storage path" do
    images_root = Apps::FinderController.workspace_section_root(@user, "images")
    doc = images_root.children.create!(title: "heal-wall.jpg", is_folder: false, content_type: "asset", content: "")
    doc.update_columns(storage_path: "Finder/Images/heal-wall.jpg")

    UserAppState.put(user: @user, key: WorkspacePreferences::Manager::WORKSPACE_STATE_KEY, value: {
      active_theme_id: "default",
      wallpaper_background_kind: "image",
      wallpaper_image_document_id: 999_999,
      wallpaper_image_storage_path: doc.storage_path
    })

    get workspace_preferences_path, as: :json

    assert_response :success
    body = response.parsed_body
    assert_equal "image", body.fetch("wallpaper_background_kind")
    assert_equal doc.id, body.fetch("wallpaper_image_document_id")

    stored = UserAppState.find_by(user: @user, key: WorkspacePreferences::Manager::WORKSPACE_STATE_KEY)&.data
    assert_equal "image", stored.fetch("wallpaper_background_kind")
    assert_equal doc.id, stored.fetch("wallpaper_image_document_id")
    assert_equal doc.storage_path, stored.fetch("wallpaper_image_storage_path")
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
