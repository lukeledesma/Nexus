# frozen_string_literal: true

module Apps
  class ImagesController < BaseController
    IMAGE_EXTENSIONS = %w[.jpg .jpeg .png .gif .webp .bmp .tif .tiff .svg].freeze

    def show
      @linked_document_id = nil
      @linked_document_display_title = nil
      result = Apps::OpenLinkedDocument.call(
        user: current_user,
        document_id: params[:document_id],
        content_type: "asset"
      )
      if result.success?
        doc = result.payload.fetch(:document)
        if image_asset_document?(doc)
          @linked_document_id = doc.id
          @linked_document_display_title = helpers.finder_document_display_title(doc.title.to_s)
        end
      end
      render layout: false if turbo_frame_request?
    end

    private

    def image_asset_document?(doc)
      ext = if doc.storage_path.present?
        File.extname(doc.storage_path.to_s).downcase
      else
        File.extname(doc.title.to_s).downcase
      end
      IMAGE_EXTENSIONS.include?(ext)
    end
  end
end
