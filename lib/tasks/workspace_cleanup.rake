# frozen_string_literal: true

namespace :nexus do
  desc "Clean legacy and test-generated workspace storage artifacts"
  task cleanup_workspace_storage: :environment do
    dry_run = ActiveModel::Type::Boolean.new.cast(ENV["DRY_RUN"])
    report = WorkspaceStorageCleanup.call(dry_run: dry_run)

    puts "Workspace storage cleanup (dry_run=#{dry_run})"
    report[:per_root].each do |root, root_report|
      unless root_report[:exists]
        puts "- #{root}: skipped (missing)"
        next
      end

      puts "- #{root}: removed #{root_report[:removed_directories]} dirs, #{root_report[:removed_files]} files"
    end

    puts "Totals: removed #{report[:removed_directories]} dirs, #{report[:removed_files]} files"
  end
end
