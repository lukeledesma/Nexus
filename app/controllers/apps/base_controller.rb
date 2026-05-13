# frozen_string_literal: true

module Apps
  class BaseController < ApplicationController
    before_action :sync_from_disk

    protected

    def render_with_turbo_support(*args, **options)
      return render(*args, layout: false, **options) if turbo_frame_request?

      render(*args, **options)
    end

    private

    def sync_from_disk
      return if @disk_synced

      DocumentDiskLoader.sync!(purge_missing: false)
      @disk_synced = true
    rescue StandardError => e
      Rails.logger.error("[Apps::BaseController] sync failed: #{e.class}: #{e.message}")
    end
  end
end
