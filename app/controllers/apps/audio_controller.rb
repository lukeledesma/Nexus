# frozen_string_literal: true

module Apps
  class AudioController < BaseController
    AUDIO_EXTENSIONS = %w[.wav .aif .aiff .mp3 .m4a .flac .ogg].freeze

    def show
      @linked_document_id = nil
      @linked_document_display_title = nil
      raw = params[:document_id].to_s.strip
      if raw.match?(/^\d+$/)
        doc = WorkspaceDocumentAccess.openable_document_for(current_user, raw, content_type: "asset")
        if doc && audio_asset_document?(doc)
          @linked_document_id = doc.id
          @linked_document_display_title = helpers.finder_document_display_title(doc.title.to_s)
        end
      end
      render layout: false if turbo_frame_request?
    end

    private

    def audio_asset_document?(doc)
      ext = if doc.storage_path.present?
        File.extname(doc.storage_path.to_s).downcase
      else
        File.extname(doc.title.to_s).downcase
      end
      AUDIO_EXTENSIONS.include?(ext)
    end
  end
end
