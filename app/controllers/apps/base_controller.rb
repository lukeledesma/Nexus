# frozen_string_literal: true

module Apps
  class BaseController < ApplicationController
    before_action :sync_from_disk

    private

    def sync_from_disk
      return if @disk_synced

      DocumentDiskLoader.sync!
      @disk_synced = true
    rescue StandardError => e
      Rails.logger.error("[Apps::BaseController] sync failed: #{e.class}: #{e.message}")
    end
  end
end
