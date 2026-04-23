# frozen_string_literal: true

module Apps
  class TimeCardController < BaseController
    def show
      time_card_root = Apps::FinderController.workspace_section_root(current_user, "time_card")

      @linked_document_id = nil
      @initial_state = {
        clockInMinutes: nil,
        clockInAtMs: nil,
        clockOutAtMs: nil,
        clockOutMinutes: nil,
        running: false,
        notesText: ""
      }
      @serialized_document_content = ""

      raw = params[:document_id].to_s.strip
      if raw.match?(/^[0-9]+$/)
        doc = WorkspaceDocumentAccess.openable_document_for(current_user, raw, content_type: "note")
        in_time_card_section = doc && time_card_root && Apps::FinderController.document_in_finder_subtree?(time_card_root, doc)
        in_embedded = doc && WorkspaceDocumentAccess.document_in_embedded_subtree?(current_user, doc)
        if in_time_card_section || in_embedded
          @linked_document_id = doc.id
          @initial_state = TimeCardDocumentCodec.load(doc.content.to_s).deep_symbolize_keys
          @serialized_document_content = doc.content.to_s.presence || TimeCardDocumentCodec.dump(@initial_state)
        end
      end

      render layout: false if turbo_frame_request?
    end
  end
end
