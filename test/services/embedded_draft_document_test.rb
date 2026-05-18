require "test_helper"
require "securerandom"

class EmbeddedDraftDocumentTest < ActiveSupport::TestCase
  setup do
    suffix = SecureRandom.hex(4)
    @user = User.create!(
      email: "embedded_draft_test_#{suffix}@example.com",
      username: "embedded_draft_user_#{suffix}",
      password: "password123",
      password_confirmation: "password123"
    )
    FinderWorkspaceInitializer.ensure_for_user!(@user)
  end

  teardown do
    Document.delete_all
    User.where(id: @user&.id).delete_all
  end

  test "fetch_or_create is idempotent and returns stable draft id" do
    first = EmbeddedDraftDocument.fetch_or_create(user: @user, app_key: "tasks")
    second = EmbeddedDraftDocument.fetch_or_create(user: @user, app_key: "tasks")

    assert first
    assert second
    assert_equal first.id, second.id
    assert_equal "Task Draft", first.title
    assert_equal "task_list", first.content_type
  end

  test "clear_draft resets payload without replacing draft identity" do
    draft = EmbeddedDraftDocument.fetch_or_create(user: @user, app_key: "tasks")
    draft.update!(tasks: [ { "text" => "Keep identity", "checked" => false, "subtasks" => [] } ])

    assert EmbeddedDraftDocument.clear_draft!(user: @user, app_key: "tasks")

    refreshed = EmbeddedDraftDocument.fetch_or_create(user: @user, app_key: "tasks")
    assert_equal draft.id, refreshed.id
    assert_equal [], refreshed.tasks
    assert_nil refreshed.content
  end

  test "draft_document recognizes canonical embedded draft" do
    draft = EmbeddedDraftDocument.fetch_or_create(user: @user, app_key: "quartz")

    assert EmbeddedDraftDocument.draft_document?(draft)
  end

  test "unsupported app key returns nil and clear false" do
    assert_nil EmbeddedDraftDocument.fetch_or_create(user: @user, app_key: "unknown")
    assert_not EmbeddedDraftDocument.clear_draft!(user: @user, app_key: "unknown")
  end
end
