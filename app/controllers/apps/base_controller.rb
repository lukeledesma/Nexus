# frozen_string_literal: true

module Apps
  class BaseController < ApplicationController
    SYNC_DEBOUNCE_SECONDS = 30

    before_action :sync_from_disk

    protected

    def render_with_turbo_support(*args, **options)
      return render(*args, layout: false, **options) if turbo_frame_request?

      render(*args, **options)
    end

    private

    def sync_from_disk
      return if @disk_synced
      return if recently_synced?

      DocumentDiskLoader.sync!(purge_missing: false)
      mark_synced_now
      @disk_synced = true
    rescue StandardError => e
      Rails.logger.error("[Apps::BaseController] sync failed: #{e.class}: #{e.message}")
    end

    def recently_synced?
      last_synced_at = Rails.cache.read(sync_cache_key)
      return false if last_synced_at.blank?

      Time.current.to_f - last_synced_at.to_f < SYNC_DEBOUNCE_SECONDS
    end

    def mark_synced_now
      Rails.cache.write(sync_cache_key, Time.current.to_f, expires_in: SYNC_DEBOUNCE_SECONDS)
    end

    def sync_cache_key
      "document_disk_loader:last_sync"
    end
  end
end
