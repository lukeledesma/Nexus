require "test_helper"
require "securerandom"

class DocumentDiskLoaderTest < ActiveSupport::TestCase
  test "task list parser understands explicit main and subtask markers" do
    lines = [
      "# NEXUS_TASK_LIST",
      "# title: Tasks",
      "",
      "[ ] Main task",
      "- [x] First subtask",
      "- [ ] Second subtask",
      "",
      "[x] Standalone task"
    ]

    parsed = DocumentDiskLoader.send(:parse_task_list, lines)

    assert_equal 2, parsed[:tasks].length
    assert_equal "Main task", parsed[:tasks][0]["text"]
    assert_equal 2, parsed[:tasks][0]["subtasks"].length
    assert_equal "First subtask", parsed[:tasks][0]["subtasks"][0]["text"]
    assert_equal true, parsed[:tasks][0]["subtasks"][0]["checked"]
    assert_equal false, parsed[:tasks][0]["checked"]
    assert_equal "Standalone task", parsed[:tasks][1]["text"]
    assert_equal true, parsed[:tasks][1]["checked"]
  end

  test "task list parser keeps supporting legacy grouped dash format" do
    lines = [
      "# NEXUS_TASK_LIST",
      "# title: Tasks",
      "",
      "- [ ] Legacy main",
      "- [x] Legacy subtask"
    ]

    parsed = DocumentDiskLoader.send(:parse_task_list, lines)

    assert_equal 1, parsed[:tasks].length
    assert_equal "Legacy main", parsed[:tasks][0]["text"]
    assert_equal 1, parsed[:tasks][0]["subtasks"].length
    assert_equal "Legacy subtask", parsed[:tasks][0]["subtasks"][0]["text"]
  end

  test "wav and related extensions are indexed as asset documents" do
    assert DocumentDiskLoader.send(:supported_file_extension?, "/tmp/x.wav")
    assert DocumentDiskLoader.send(:supported_file_extension?, "/tmp/x.WAV")
    assert DocumentDiskLoader.send(:disk_asset_file?, "/a/b/c.mp3")
    assert_equal "707 Crash", DocumentDiskLoader.send(:basename_without_supported_extension, "/Cymbals/707 Crash.wav")

    attrs = DocumentDiskLoader.send(:asset_file_attributes)
    assert_equal "asset", attrs[:content_type]
    assert_nil attrs[:content]
  end

  test "markdown task files are supported and title strips md extension" do
    assert DocumentDiskLoader.send(:supported_file_extension?, "/tmp/Kanban/Backlog.md")
    assert_equal "Backlog", DocumentDiskLoader.send(:basename_without_supported_extension, "/tmp/Kanban/Backlog.md")
  end

  test "nexus and rtf text files are supported and titles strip extension" do
    assert DocumentDiskLoader.send(:supported_file_extension?, "/tmp/Notes/Legacy.nexus")
    assert DocumentDiskLoader.send(:supported_file_extension?, "/tmp/Notes/Editor.rtf")
    assert_equal "Legacy", DocumentDiskLoader.send(:basename_without_supported_extension, "/tmp/Notes/Legacy.nexus")
    assert_equal "Editor", DocumentDiskLoader.send(:basename_without_supported_extension, "/tmp/Notes/Editor.rtf")
  end

  test "xml files are indexed only for unified alchemy format" do
    Dir.mktmpdir do |dir|
      raw_xml_path = File.join(dir, "raw.xml")
      alchemy_xml_path = File.join(dir, "alchemy.xml")

      File.write(raw_xml_path, "<xml/>")
      File.write(
        alchemy_xml_path,
        [
          "# NEXUS_FILE v1",
          "# kind: alchemy",
          "# title: PLC Tag List",
          "",
          "<XML><TAG /></XML>"
        ].join("\n")
      )

      assert_not DocumentDiskLoader.send(:supported_file_extension?, raw_xml_path)
      assert DocumentDiskLoader.send(:supported_file_extension?, alchemy_xml_path)
    end
  end

  test "unified quartz files preserve full nexus content" do
    lines = [
      "# NEXUS_FILE v1",
      "# kind: quartz",
      "# title: Quartz",
      "",
      "#timecard",
      "10:00-11:00 Client",
      "- Entry"
    ]

    parsed = DocumentDiskLoader.send(:parse_unified_file, lines)

    assert_equal "note", parsed[:content_type]
    assert_equal lines.join("\n"), parsed[:content]
  end

  test "purge removes missing folders and files" do
    stale_folder = Document.create!(is_folder: true, title: "Stale Folder", storage_path: "stale-folder")
    stale_file = Document.create!(
      is_folder: false,
      parent: stale_folder,
      title: "Stale",
      content_type: "note",
      content: "<p>x</p>",
      storage_path: "stale-folder/stale.rtf"
    )
    FileUtils.rm_rf(DocumentStorageSyncLite.storage_root.join("stale-folder"))

    DocumentDiskLoader.send(:purge_missing_from_database!, [])

    assert_not Document.exists?(stale_folder.id), "expected missing folders to be purged"
    assert_not Document.exists?(stale_file.id), "expected missing files to still be purged"
  end

  test "purge keeps embedded drafts even when draft file is missing" do
    suffix = SecureRandom.hex(4)
    user = User.create!(
      email: "disk_loader_draft_#{suffix}@example.com",
      username: "disk_loader_user_#{suffix}",
      password: "password123",
      password_confirmation: "password123"
    )
    FinderWorkspaceInitializer.ensure_for_user!(user)
    draft = EmbeddedDraftDocument.fetch_or_create(user: user, app_key: "tasks")
    assert draft

    draft_path = DocumentStorageSyncLite.storage_root.join(draft.storage_path.to_s)
    FileUtils.rm_f(draft_path)

    DocumentDiskLoader.send(:purge_missing_from_database!, [])

    assert Document.exists?(draft.id), "expected embedded draft row to remain after purge"
  ensure
    UserAppState.delete_all
    Document.delete_all
    User.where(id: user&.id).delete_all
  end

  test "sync attaches top-level disk entries to the shared storage root" do
    suffix = SecureRandom.hex(4)
    user = User.create!(
      email: "disk_loader_root_#{suffix}@example.com",
      username: "disk_loader_root_#{suffix}",
      password: "password123",
      password_confirmation: "password123"
    )
    FinderWorkspaceInitializer.ensure_for_user!(user)
    root = FinderListedFolders.workspace_root_for(user)
    folder_name = "Loose Folder #{suffix}"
    file_name = "Loose Note #{suffix}.txt"

    FileUtils.mkdir_p(DocumentStorageSyncLite.storage_root.join(folder_name))
    File.write(DocumentStorageSyncLite.storage_root.join(file_name), "hello from disk")

    DocumentDiskLoader.sync!(purge_missing: false)

    folder = Document.find_by(storage_path: folder_name)
    file = Document.find_by(storage_path: file_name)

    assert folder, "expected disk folder to be imported"
    assert file, "expected disk file to be imported"
    assert_equal root.id, folder.parent_id
    assert_equal root.id, file.parent_id
  ensure
    FileUtils.rm_rf(DocumentStorageSyncLite.storage_root.join(folder_name.to_s))
    FileUtils.rm_f(DocumentStorageSyncLite.storage_root.join(file_name.to_s))
    UserAppState.delete_all
    Document.delete_all
    User.where(id: user&.id).delete_all
  end
end
