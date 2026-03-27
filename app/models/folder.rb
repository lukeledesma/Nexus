class Folder < ApplicationRecord
  has_many :items, dependent: :destroy

  validates :name, presence: true

  before_destroy :delete_workspace_directory
  after_commit :sync_items_to_disk

  scope :ordered, -> { order(Arel.sql("LOWER(name) ASC")) }

  private

  def sync_items_to_disk
    ItemStorageSyncLite.sync_all!
  rescue StandardError => e
    Rails.logger.error("[ItemStorageSyncLite] folder sync failed: #{e.class}: #{e.message}")
  end

  def delete_workspace_directory
    return if name == "App"  # Never delete the App folder's directory

    workspace_root = ItemStorageSyncLite.storage_root
    folder_dir = workspace_root.join(name)

    return unless folder_dir.exist?

    require "fileutils"
    FileUtils.rm_rf(folder_dir)
  rescue StandardError => e
    Rails.logger.error("[Folder] failed to delete workspace directory: #{e.class}: #{e.message}")
  end
end
