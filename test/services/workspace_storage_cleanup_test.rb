require "test_helper"
require "tmpdir"
require "fileutils"

class WorkspaceStorageCleanupTest < ActiveSupport::TestCase
  test "cleanup removes known artifacts but preserves active workspace files" do
    Dir.mktmpdir("workspace_cleanup_test") do |tmp_dir|
      root = Pathname.new(tmp_dir).join("workspace")
      FileUtils.mkdir_p(root)

      # Artifact dirs to remove
      FileUtils.mkdir_p(root.join("apps_open_user_aaaa"))
      FileUtils.mkdir_p(root.join("json_api_user_bbbb"))

      # Legacy files/dirs to remove
      FileUtils.mkdir_p(root.join("Admin", "Finder", "Notes"))
      FileUtils.mkdir_p(root.join("Admin", "Finder", "Time Card"))
      FileUtils.mkdir_p(root.join("Admin", "Finder", "Tasks"))
      FileUtils.mkdir_p(root.join("Admin", "Embedded"))
      FileUtils.mkdir_p(root.join("Embedded"))
      File.write(root.join("Admin", "Embedded", "Note Draft.rtf"), "legacy")
      File.write(root.join("Admin", "Embedded", "Time Card Draft.rtf"), "legacy")
      File.write(root.join("Admin", "Embedded", "LayoutThemes.rtf"), "legacy")
      File.write(root.join("Embedded", "LayoutThemes 2.rtf"), "legacy")
      File.write(root.join("Admin", "Embedded", "WorkspaceState 2.rtf"), "legacy")
      File.write(root.join("Embedded", "WorkspaceState.rtf"), "legacy")

      # Canonical files to preserve
      File.write(root.join("Admin", "Embedded", "LayoutThemes.txt"), "canonical")
      File.write(root.join("Admin", "Embedded", "WorkspaceState.txt"), "canonical")
      File.write(root.join("Embedded", "LayoutThemes.txt"), "canonical")
      File.write(root.join("Embedded", "WorkspaceState.txt"), "canonical")

      report = WorkspaceStorageCleanup.call(roots: [ root ])

      assert report[:removed_directories] >= 4
      assert report[:removed_files] >= 4

      assert_not Dir.exist?(root.join("apps_open_user_aaaa"))
      assert_not Dir.exist?(root.join("json_api_user_bbbb"))
      assert_not Dir.exist?(root.join("Admin", "Finder", "Notes"))
      assert_not Dir.exist?(root.join("Admin", "Finder", "Time Card"))

      assert File.exist?(root.join("Admin", "Finder", "Tasks"))
      assert File.exist?(root.join("Admin", "Embedded", "LayoutThemes.txt"))
      assert File.exist?(root.join("Admin", "Embedded", "WorkspaceState.txt"))
      assert File.exist?(root.join("Embedded", "LayoutThemes.txt"))
      assert File.exist?(root.join("Embedded", "WorkspaceState.txt"))
    end
  end

  test "cleanup supports dry-run mode" do
    Dir.mktmpdir("workspace_cleanup_dry_run") do |tmp_dir|
      root = Pathname.new(tmp_dir).join("workspace")
      FileUtils.mkdir_p(root.join("apps_open_user_zzzz"))

      report = WorkspaceStorageCleanup.call(roots: [ root ], dry_run: true)

      assert_equal true, report[:dry_run]
      assert_equal 1, report[:removed_directories]
      assert Dir.exist?(root.join("apps_open_user_zzzz")), "dry_run must not delete files"
    end
  end
end
