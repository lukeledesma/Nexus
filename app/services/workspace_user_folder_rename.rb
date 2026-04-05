# frozen_string_literal: true

require "fileutils"

# When a username changes, renames storage/workspace/<old>/ → storage/workspace/<new>/
# and rewrites matching Document#storage_path values (and the root folder title)
# so Embedded data, Finder, and disk stay aligned.
class WorkspaceUserFolderRename
  def self.call(from:, to:)
    new(from: from, to: to).call
  end

  def initialize(from:, to:)
    @from = from.to_s.strip
    @to = to.to_s.strip
  end

  def call
    return if @to.blank?
    return if @from.blank?
    return if @from == @to

    storage_root = DocumentStorageSyncLite.storage_root
    from_path = storage_root.join(@from)
    to_path = storage_root.join(@to)

    moved = false
    begin
      if from_path.exist?
        if same_realpath?(from_path, to_path)
          # Case-only rename on a case-insensitive volume: one directory, update DB paths only.
        elsif to_path.exist?
          FileUtils.rm_rf(to_path)
          FileUtils.mv(from_path, to_path)
          moved = true
        else
          FileUtils.mv(from_path, to_path)
          moved = true
        end
      end

      update_document_storage_paths!
    rescue StandardError => e
      revert_filesystem_move(to_path, from_path, moved)
      Rails.logger.error("[WorkspaceUserFolderRename] failed: #{e.class}: #{e.message}")
      raise
    end
  end

  private

  def same_realpath?(a, b)
    return false unless a.exist? && b.exist?

    File.realpath(a) == File.realpath(b)
  rescue SystemCallError
    false
  end

  def revert_filesystem_move(to_path, from_path, moved)
    return unless moved
    return unless to_path.exist? && !from_path.exist?

    FileUtils.mv(to_path, from_path)
  rescue StandardError => e
    Rails.logger.error("[WorkspaceUserFolderRename] revert mv failed: #{e.class}: #{e.message}")
  end

  def update_document_storage_paths!
    Document
      .where("storage_path = ? OR storage_path LIKE ?", @from, "#{@from}/%")
      .order(Arel.sql("LENGTH(storage_path) DESC"))
      .find_each do |doc|
        new_path = if doc.storage_path == @from
          @to
        else
          doc.storage_path.sub(/\A#{Regexp.escape(@from)}\//, "#{@to}/")
        end

        attrs = { storage_path: new_path, updated_at: Time.current }
        attrs[:title] = @to if doc.folder? && doc.parent_id.nil? && doc.storage_path == @from

        doc.update_columns(attrs)
      end
  end
end
