require "test_helper"
require "securerandom"

class TimeCardFilesByDateTest < ActionDispatch::IntegrationTest
  setup do
    suffix = SecureRandom.hex(4)
    @user = User.create!(
      email: "time_card_index_#{suffix}@example.com",
      username: "time_card_index_#{suffix}",
      password: "password123",
      password_confirmation: "password123"
    )

    post login_path, params: { identifier: @user.email, password: "password123" }
    FinderWorkspaceInitializer.ensure_for_user!(@user)
    @time_card_root = Apps::FinderController.workspace_section_root(@user, "time_card")
  end

  teardown do
    Document.delete_all
    User.where(id: @user&.id).delete_all
  end

  test "files_by_date returns latest saved file per entry date" do
    older = Document.create!(
      parent: @time_card_root,
      is_folder: false,
      title: "Old Day",
      content_type: "note",
      content: TimeCardDocumentCodec.dump(
        {
          entryDate: "2026-05-12",
          clockInMinutes: nil,
          clockInAtMs: nil,
          clockOutAtMs: nil,
          clockOutMinutes: nil,
          running: false,
          notesText: "old"
        }
      )
    )
    older.update_column(:updated_at, 2.days.ago)

    newer = Document.create!(
      parent: @time_card_root,
      is_folder: false,
      title: "New Day",
      content_type: "note",
      content: TimeCardDocumentCodec.dump(
        {
          entryDate: "2026-05-12",
          clockInMinutes: nil,
          clockInAtMs: nil,
          clockOutAtMs: nil,
          clockOutMinutes: nil,
          running: false,
          notesText: "new"
        }
      )
    )

    get "/apps/time_card/files_by_date", as: :json

    assert_response :success
    payload = response.parsed_body
    assert_equal true, payload["ok"]
    assert payload["files_by_date"].is_a?(Hash)

    day = payload["files_by_date"]["2026-05-12"]
    assert_not_nil day
    assert_equal newer.id, day["document_id"]
    assert_equal "New Day", day["title"]
  end
end
