# frozen_string_literal: true

require "image_processing/mini_magick"

module Documents
  class GenerateThumbnail
    THUMB_SIZE = 28
    THUMBNAIL_SUBDIR = ".thumbnails"

    def self.call(document)
      new(document).call
    end

    def initialize(document)
      @document = document
    end

    def call
      return false unless image_asset?

      source = @document.asset_disk_path
      return false unless source&.file?

      ext = File.extname(source.to_s).downcase
      return false unless Document::IMAGE_EXTENSIONS.include?(ext)
      return false if ext == ".svg" # SVG is vector — skip rasterisation

      thumb_path = @document.thumbnail_disk_path
      return false unless thumb_path

      FileUtils.mkdir_p(thumb_path.dirname)

      ImageProcessing::MiniMagick
        .source(source.to_s)
        .resize_to_fill(THUMB_SIZE, THUMB_SIZE)
        .convert("webp")
        .call(destination: thumb_path.to_s)

      true
    rescue StandardError => e
      Rails.logger.warn("[GenerateThumbnail] Skipped document #{@document.id}: #{e.message}")
      false
    end

    private

    def image_asset?
      @document.file? && @document.content_type.to_s == "asset"
    end
  end
end
