require "test_helper"
require "securerandom"

class ItemStorageSyncLiteTest < Minitest::Test
  def test_sync_does_not_recreate_legacy_tasks_md
    username = "sync_no_tasks_md_#{SecureRandom.hex(4)}"
    root = ItemStorageSyncLite.storage_root.join(username, "Embedded")
    FileUtils.mkdir_p(root)
    tasks_md = root.join("Tasks.md")
    File.write(tasks_md, "legacy")

    ItemStorageSyncLite.sync_all!(username: username)

    refute File.exist?(tasks_md), "expected legacy Tasks.md to be removed and not regenerated"
  ensure
    FileUtils.rm_rf(ItemStorageSyncLite.storage_root.join(username).to_s) if username
  end

  def test_sync_preserves_canonical_linked_app_draft_files
    username = "sync_preserve_drafts_#{SecureRandom.hex(4)}"
    root = ItemStorageSyncLite.storage_root.join(username, "Embedded")
    FileUtils.mkdir_p(root)

    drafts = {
      "Task Draft.txt" => "task-draft",
      "Note Draft.rtf" => "note-draft",
      "Time Card Draft.rtf" => "time-card-draft"
    }
    drafts.each { |name, body| File.write(root.join(name), body) }

    ItemStorageSyncLite.sync_all!(username: username)

    drafts.each do |name, body|
      path = root.join(name)
      assert File.exist?(path), "expected #{name} to be preserved"
      assert_equal body, File.read(path)
    end
  ensure
    FileUtils.rm_rf(ItemStorageSyncLite.storage_root.join(username).to_s) if username
  end
end