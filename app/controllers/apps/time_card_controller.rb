# frozen_string_literal: true

module Apps
  class TimeCardController < BaseController
    def show
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

      result = Apps::OpenLinkedDocument.call(
        user: current_user,
        document_id: params[:document_id],
        content_type: "note",
        section_key: "time_card",
        allow_embedded: true
      )
      if result.success?
        doc = result.payload.fetch(:document)
        @linked_document_id = doc.id
        @initial_state = TimeCardDocumentCodec.load(doc.content.to_s).deep_symbolize_keys
        @serialized_document_content = doc.content.to_s.presence || TimeCardDocumentCodec.dump(@initial_state)
      end

      render layout: false if turbo_frame_request?
    end
  end
end
