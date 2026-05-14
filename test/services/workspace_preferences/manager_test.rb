require "test_helper"
require "securerandom"

class WorkspacePreferencesManagerTest < ActiveSupport::TestCase
  setup do
    suffix = SecureRandom.hex(4)
    @user = User.create!(
      email: "prefs_manager_#{suffix}@example.com",
      username: "prefs_user_#{suffix}",
      password: "password123",
      password_confirmation: "password123"
    )
    FinderWorkspaceInitializer.ensure_for_user!(@user)
    @manager = WorkspacePreferences::Manager.new(user: @user)
  end

  teardown do
    Document.delete_all
    User.where(id: @user&.id).delete_all
  end

  test "returns payload with active theme and appearance" do
    result = @manager.payload

    assert result.success?
    assert_equal WorkspacePreferences::Manager::DEFAULT_THEME_ID, result.payload["active_theme_id"]
    assert result.payload["appearance"].is_a?(Hash)
  end

  test "rejects unsupported theme action" do
    result = @manager.apply_theme({ "action" => "bad", "theme_id" => "default" })

    assert_equal :unprocessable_entity, result.status
    assert_match(/only shell apply/i, result.payload[:error])
  end

  test "applies eligible wallpaper image" do
    images_root = Apps::FinderController.workspace_section_root(@user, "images")
    doc = images_root.children.create!(title: "wall.jpg", is_folder: false, content_type: "asset", content: "")
    doc.update_columns(storage_path: "#{@user.username}/Finder/Images/wall.jpg")

    result = @manager.apply_wallpaper_image(doc.id)
    assert result.success?

    @manager.persist!
    fresh_manager = WorkspacePreferences::Manager.new(user: @user)
    payload = fresh_manager.payload.payload
    assert_equal "image", payload["wallpaper_background_kind"]
    assert_equal doc.id, payload["wallpaper_image_document_id"]
  end
end
