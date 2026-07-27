# frozen_string_literal: true

require "fileutils"

class WorkspaceStorageCleanup
  ARTIFACT_DIR_PATTERNS = [
    "Admin",
    "Embedded",
    "Finder *",
    "apps_open_user_*",
    "json_api_user_*",
    "prefs_flow_user_*",
    "prefs_user_*",
    "open_doc_user_*",
    "embedded_draft_user_*",
    "time_card_index_*",
    "create_file_user_*",
    "create_subfolder_user_*",
    "move_document_user_*",
    "panel_search_user_*",
    "policy_user_*",
    "pwd_user_*",
    "rename_user_*",
    "upload_files_user_*",
    "tasks_save_file_user_*",
    "task_payload_strip_*",
    "task_payload_workspace_*",
    "disk_loader_user_*",
    "drafts_user_*"
  ].freeze

  LEGACY_PATH_GLOBS = [
    "Admin/Finder/Notes",
    "Admin/Finder/Time Card",
    "Admin/Embedded/Note Draft.rtf",
    "Admin/Embedded/Time Card Draft.rtf",
    "Admin/Embedded/LayoutThemes*.rtf",
    "Embedded/LayoutThemes*.rtf",
    "Admin/Embedded/WorkspaceState*.rtf",
    "Embedded/WorkspaceState*.rtf"
  ].freeze

  def self.call(roots: default_roots, dry_run: false)
    new(roots: roots, dry_run: dry_run).call
  end

  def self.default_roots
    [
      Rails.root.join("storage", "workspace"),
      Rails.root.join("storage", "workspace_test")
    ]
  end

  def initialize(roots:, dry_run: false)
    @roots = Array(roots).map { |root| Pathname.new(root) }
    @dry_run = !!dry_run
  end

  def call
    per_root = @roots.each_with_object({}) do |root, out|
      out[root.to_s] = cleanup_root(root)
    end

    {
      dry_run: @dry_run,
      per_root: per_root,
      removed_directories: per_root.values.sum { |item| item[:removed_directories] },
      removed_files: per_root.values.sum { |item| item[:removed_files] }
    }
  end

  private

  def cleanup_root(root)
    report = {
      exists: root.directory?,
      removed_directories: 0,
      removed_files: 0,
      removed_paths: []
    }
    return report unless report[:exists]

    ARTIFACT_DIR_PATTERNS.each do |pattern|
      Dir.glob(root.join(pattern).to_s).sort.each do |path|
        next unless File.directory?(path)

        remove_path(path)
        report[:removed_directories] += 1
        report[:removed_paths] << path
      end
    end

    LEGACY_PATH_GLOBS.each do |relative_glob|
      Dir.glob(root.join(relative_glob).to_s).sort.each do |path|
        if File.directory?(path)
          remove_path(path)
          report[:removed_directories] += 1
          report[:removed_paths] << path
        elsif File.file?(path)
          remove_path(path)
          report[:removed_files] += 1
          report[:removed_paths] << path
        end
      end
    end

    report
  end

  def remove_path(path)
    return if @dry_run

    FileUtils.rm_rf(path)
  end
end
