require "test_helper"
require "securerandom"

class DocumentPersistenceTest < ActiveSupport::TestCase
  test "persists a new document and syncs it to disk" do
    folder = Document.create!(is_folder: true, title: "persist-folder-#{SecureRandom.hex(4)}")

    doc = Document.new(
      is_folder: false,
      parent: folder,
      title: "persist-note-#{SecureRandom.hex(4)}",
      content_type: "note",
      content: "<p>Hello</p>"
    )

    result = DocumentPersistence.persist(doc, operation: :create)

    assert result.success?
    assert doc.persisted?
    assert doc.storage_path.present?
    assert DocumentStorageSyncLite.storage_root.join(doc.storage_path).file?
  ensure
    Document.where(id: [ doc&.id, folder&.id ].compact).delete_all
    FileUtils.rm_rf(DocumentStorageSyncLite.storage_root.join(folder&.storage_path.to_s)) if folder&.storage_path.present?
  end

  test "persists nexus file notes as plain text" do
    folder = Document.create!(is_folder: true, title: "persist-folder-#{SecureRandom.hex(4)}")
    quartz_payload = [
      "# NEXUS_FILE v1",
      "# kind: quartz",
      "# title: Quartz",
      "",
      "#timecard",
      "10:00-11:00 Client",
      "- Entry"
    ].join("\n")

    doc = Document.new(
      is_folder: false,
      parent: folder,
      title: "persist-quartz-#{SecureRandom.hex(4)}",
      content_type: "note",
      content: quartz_payload
    )

    result = DocumentPersistence.persist(doc, operation: :create)

    assert result.success?
    assert doc.storage_path.end_with?(".txt")
    path = DocumentStorageSyncLite.storage_root.join(doc.storage_path)
    assert_equal quartz_payload, File.read(path)
  ensure
    Document.where(id: [ doc&.id, folder&.id ].compact).delete_all
    FileUtils.rm_rf(DocumentStorageSyncLite.storage_root.join(folder&.storage_path.to_s)) if folder&.storage_path.present?
  end

  test "rolls back database save when disk sync fails" do
    folder = Document.create!(is_folder: true, title: "persist-folder-#{SecureRandom.hex(4)}")
    doc_title = "persist-fail-note-#{SecureRandom.hex(4)}"

    doc = Document.new(
      is_folder: false,
      parent: folder,
      title: doc_title,
      content_type: "note",
      content: "<p>Failure path</p>"
    )

    original_create = DocumentStorageSyncLite.instance_method(:create)
    DocumentStorageSyncLite.define_method(:create) do
      raise Errno::EIO, "simulated disk failure"
    end

    result = DocumentPersistence.persist(doc, operation: :create)

    assert_not result.success?
    assert_equal :disk_sync_failed, result.code
    assert_not Document.exists?(title: doc_title)
  ensure
    DocumentStorageSyncLite.define_method(:create, original_create) if original_create
    Document.where(id: [ doc&.id, folder&.id ].compact).delete_all
    FileUtils.rm_rf(DocumentStorageSyncLite.storage_root.join(folder&.storage_path.to_s)) if folder&.storage_path.present?
  end

  test "destroys document and removes on-disk artifact" do
    folder = Document.create!(is_folder: true, title: "persist-folder-#{SecureRandom.hex(4)}")
    doc = Document.create!(
      is_folder: false,
      parent: folder,
      title: "destroy-note-#{SecureRandom.hex(4)}",
      content_type: "note",
      content: "<p>Delete me</p>"
    )
    path = DocumentStorageSyncLite.storage_root.join(doc.storage_path)
    assert path.file?

    result = DocumentPersistence.destroy(doc)

    assert result.success?
    assert_not Document.exists?(doc.id)
    assert_not path.exist?
  ensure
    Document.where(id: [ doc&.id, folder&.id ].compact).delete_all
    FileUtils.rm_rf(DocumentStorageSyncLite.storage_root.join(folder&.storage_path.to_s)) if folder&.storage_path.present?
  end

  test "rolls back database destroy when disk delete fails" do
    folder = Document.create!(is_folder: true, title: "persist-folder-#{SecureRandom.hex(4)}")
    doc = Document.create!(
      is_folder: false,
      parent: folder,
      title: "destroy-fail-note-#{SecureRandom.hex(4)}",
      content_type: "note",
      content: "<p>Delete fail</p>"
    )

    original_destroy = DocumentStorageSyncLite.instance_method(:destroy)
    DocumentStorageSyncLite.define_method(:destroy) do
      raise Errno::EIO, "simulated disk delete failure"
    end

    result = DocumentPersistence.destroy(doc)

    assert_not result.success?
    assert_equal :disk_sync_failed, result.code
    assert Document.exists?(doc.id)
  ensure
    DocumentStorageSyncLite.define_method(:destroy, original_destroy) if original_destroy
    Document.where(id: [ doc&.id, folder&.id ].compact).delete_all
    FileUtils.rm_rf(DocumentStorageSyncLite.storage_root.join(folder&.storage_path.to_s)) if folder&.storage_path.present?
  end

  test "destroys folder subtree and removes on-disk directory" do
    root = Document.create!(is_folder: true, title: "persist-folder-#{SecureRandom.hex(4)}")
    folder = Document.create!(is_folder: true, parent: root, title: "subtree-#{SecureRandom.hex(4)}")
    file = Document.create!(
      is_folder: false,
      parent: folder,
      title: "leaf-#{SecureRandom.hex(4)}",
      content_type: "note",
      content: "<p>Leaf</p>"
    )
    folder_path = DocumentStorageSyncLite.storage_root.join(folder.storage_path)
    file_path = DocumentStorageSyncLite.storage_root.join(file.storage_path)
    assert folder_path.directory?
    assert file_path.file?

    result = DocumentPersistence.destroy(folder)

    assert result.success?
    assert_not Document.exists?(folder.id)
    assert_not Document.exists?(file.id)
    assert_not folder_path.exist?
    assert_not file_path.exist?
  ensure
    Document.where(id: [ file&.id, folder&.id, root&.id ].compact).delete_all
    FileUtils.rm_rf(DocumentStorageSyncLite.storage_root.join(root&.storage_path.to_s)) if root&.storage_path.present?
  end

  test "rolls back folder subtree destroy when disk delete fails" do
    root = Document.create!(is_folder: true, title: "persist-folder-#{SecureRandom.hex(4)}")
    folder = Document.create!(is_folder: true, parent: root, title: "rollback-subtree-#{SecureRandom.hex(4)}")
    file = Document.create!(
      is_folder: false,
      parent: folder,
      title: "rollback-leaf-#{SecureRandom.hex(4)}",
      content_type: "note",
      content: "<p>Leaf</p>"
    )

    original_destroy = DocumentStorageSyncLite.instance_method(:destroy)
    DocumentStorageSyncLite.define_method(:destroy) do
      raise Errno::EIO, "simulated folder disk delete failure"
    end

    result = DocumentPersistence.destroy(folder)

    assert_not result.success?
    assert_equal :disk_sync_failed, result.code
    assert Document.exists?(folder.id)
    assert Document.exists?(file.id)
  ensure
    DocumentStorageSyncLite.define_method(:destroy, original_destroy) if original_destroy
    Document.where(id: [ file&.id, folder&.id, root&.id ].compact).delete_all
    FileUtils.rm_rf(DocumentStorageSyncLite.storage_root.join(root&.storage_path.to_s)) if root&.storage_path.present?
  end
end
