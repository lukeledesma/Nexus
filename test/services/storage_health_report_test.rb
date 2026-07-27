require "test_helper"
require "tmpdir"
require "fileutils"

class StorageHealthReportTest < ActiveSupport::TestCase
  test "reports db/disk drift and alchemy usage" do
    Dir.mktmpdir("storage_health_report") do |tmp_dir|
      root = Pathname.new(tmp_dir).join("workspace")
      FileUtils.mkdir_p(root.join("health-folder"))

      previous_root = ENV["NEXUS_STORAGE_ROOT"]
      previous_suppress = Current.suppress_document_disk_sync
      ENV["NEXUS_STORAGE_ROOT"] = root.to_s
      Current.suppress_document_disk_sync = true

      folder = Document.create!(is_folder: true, title: "health-folder", storage_path: "health-folder")
      present = Document.create!(
        is_folder: false,
        parent: folder,
        title: "present",
        content_type: "note",
        content: "present note",
        storage_path: "health-folder/present.txt"
      )
      missing = Document.create!(
        is_folder: false,
        parent: folder,
        title: "missing",
        content_type: "note",
        content: "missing note",
        storage_path: "health-folder/missing.txt"
      )
      alchemy = Document.create!(
        is_folder: false,
        parent: folder,
        title: "plc",
        content_type: "alchemy_tag_list",
        content: "<XML><TAG /></XML>",
        storage_path: "health-folder/plc.xml"
      )

      Document.create!(
        is_folder: false,
        parent: folder,
        title: "dup-a",
        content_type: "note",
        content: "A",
        storage_path: "health-folder/dup.txt"
      )
      Document.create!(
        is_folder: false,
        parent: folder,
        title: "dup-b",
        content_type: "note",
        content: "B",
        storage_path: "health-folder/dup.txt"
      )

      File.write(root.join("health-folder", "present.txt"), "present note")
      File.write(root.join("health-folder", "plc.xml"), "<XML><TAG /></XML>")
      File.write(root.join("health-folder", "orphan.txt"), "orphan")

      report = StorageHealthReport.call(storage_root: root)

      assert_equal root.to_s, report[:storage_root]
      assert report[:summary][:db_file_rows] >= 5
      assert report[:summary][:db_missing_on_disk_count] >= 3
      assert report[:summary][:disk_missing_in_db_count] >= 1

      missing_paths = report[:db_rows_missing_on_disk].map { |row| row[:storage_path] }
      assert_includes missing_paths, missing.storage_path

      disk_only_paths = report[:disk_files_missing_in_db].map { |row| row[:storage_path] }
      assert_includes disk_only_paths, "health-folder/orphan.txt"

      duplicate_paths = report[:duplicate_db_storage_paths].map { |row| row[:storage_path] }
      assert_includes duplicate_paths, "health-folder/dup.txt"

      assert report[:alchemy][:db_rows] >= 1
      assert report[:alchemy][:db_content_bytes] >= alchemy.content.to_s.bytesize
      assert report[:alchemy][:disk_bytes] >= root.join("health-folder", "plc.xml").size

      markdown = StorageHealthReport.to_markdown(report)
      assert_includes markdown, "## Alchemy"
      assert_includes markdown, "health-folder/orphan.txt"
    ensure
      Current.suppress_document_disk_sync = previous_suppress
      ENV["NEXUS_STORAGE_ROOT"] = previous_root
      Document.where(id: [present&.id, missing&.id, alchemy&.id, folder&.id].compact).delete_all
      Document.where(storage_path: "health-folder/dup.txt").delete_all
    end
  end
end
