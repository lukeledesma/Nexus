class Folder < ApplicationRecord
  has_many :items, dependent: :destroy

  validates :name, presence: true

  after_commit :sync_items_to_disk

  scope :ordered, -> { order(Arel.sql("LOWER(name) ASC")) }

  private

  def sync_items_to_disk
    ItemStorageSyncLite.sync_all!
  rescue StandardError => e
    Rails.logger.error("[ItemStorageSyncLite] folder sync failed: #{e.class}: #{e.message}")
  end
end
