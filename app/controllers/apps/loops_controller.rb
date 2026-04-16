# frozen_string_literal: true

module Apps
  class LoopsController < BaseController
    def show
      @linked_document_id = nil
      @linked_document_display_title = nil
      raw = params[:document_id].to_s.strip
      if raw.match?(/^\d+$/)
        doc = WorkspaceDocumentAccess.openable_document_for(current_user, raw, content_type: "asset")
        if doc
          @linked_document_id = doc.id
          @linked_document_display_title = helpers.finder_document_display_title(doc.title.to_s)
        end
      end
      render layout: false if turbo_frame_request?
    end
  end
end
