# Represents an app workspace item inside a Folder.
class Item < ApplicationRecord
  belongs_to :folder

  TYPES = %w[note task_list whiteboard excalidraw].freeze

  validates :name, presence: true
  validates :item_type, inclusion: { in: TYPES }

  before_validation :default_tasks
  after_commit :sync_to_disk

  scope :task_lists, -> { where(item_type: "task_list") }
  scope :ordered, -> { order(Arel.sql("LOWER(name) ASC")) }

  private

  def default_tasks
    self.tasks = [] if tasks.nil?
  end

  def sync_to_disk
    ItemStorageSyncLite.sync_all!
  rescue StandardError => e
    Rails.logger.error("[ItemStorageSyncLite] item sync failed: #{e.class}: #{e.message}")
  end
end
