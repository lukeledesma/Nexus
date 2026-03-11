require "test_helper"

class DocumentsRenameTest < ActionDispatch::IntegrationTest
  test "metadata filename delta rename keeps empty file visible" do
    folder = Document.create!(is_folder: true, metadata_filename: "Warren", storage_path: "Warren", records: [])
    file = Document.create!(
      is_folder: false,
      parent: folder,
      metadata_filename: "untitled.xml",
      storage_path: "Warren/untitled.xml",
      records: []
    )

    old_abs = Rails.root.join("storage", "tag_lists", "Warren", "untitled.xml")
    new_abs = Rails.root.join("storage", "tag_lists", "Warren", "renamed.xml")
    FileUtils.mkdir_p(old_abs.dirname)
    File.write(old_abs, DocumentStorageSync::EMPTY_XML)

    patch document_path(file), params: {
      delta: {
        kind: "metadata_field",
        key: "metadata_filename",
        value: "renamed"
      }
    }

    assert_response :no_content
    file.reload
    assert_equal "renamed.xml", file.metadata_filename
    assert_equal "Warren/renamed.xml", file.storage_path
    assert File.exist?(new_abs)
    assert_not File.exist?(old_abs)
  ensure
    FileUtils.rm_f(old_abs) if defined?(old_abs) && old_abs
    FileUtils.rm_f(new_abs) if defined?(new_abs) && new_abs
  end

  test "allows case-only rename for file in same folder" do
    folder = Document.create!(is_folder: true, metadata_filename: "Warren", storage_path: "Warren", records: [])
    file = Document.create!(
      is_folder: false,
      parent: folder,
      metadata_filename: "sample_export.xml",
      storage_path: "Warren/sample_export.xml",
      records: []
    )

    patch rename_document_path(file), params: { name: "Sample_Export" }

    assert_response :success
    file.reload
    assert_equal "Sample_Export.xml", file.metadata_filename
    assert_equal "Warren/Sample_Export.xml", file.storage_path
  end

  test "rejects file rename that collides case-insensitively with sibling" do
    folder = Document.create!(is_folder: true, metadata_filename: "Warren", storage_path: "Warren", records: [])
    file_a = Document.create!(
      is_folder: false,
      parent: folder,
      metadata_filename: "alpha.xml",
      storage_path: "Warren/alpha.xml",
      records: []
    )
    Document.create!(
      is_folder: false,
      parent: folder,
      metadata_filename: "Bravo.xml",
      storage_path: "Warren/Bravo.xml",
      records: []
    )

    patch rename_document_path(file_a), params: { name: "bravo.xml" }

    assert_response :unprocessable_entity
  end

  test "rejects rename when name starts with period" do
    folder = Document.create!(is_folder: true, metadata_filename: "Warren", storage_path: "Warren", records: [])
    file = Document.create!(
      is_folder: false,
      parent: folder,
      metadata_filename: "sample_export.xml",
      storage_path: "Warren/sample_export.xml",
      records: []
    )

    patch rename_document_path(file), params: { name: ".xml" }

    assert_response :unprocessable_entity
    assert_match "Name cannot start with a period", response.parsed_body["error"]
    file.reload
    assert_equal "sample_export.xml", file.metadata_filename
  end
end
