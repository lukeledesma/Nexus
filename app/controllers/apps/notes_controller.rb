# frozen_string_literal: true

module Apps
  class NotesController < BaseController
    def show
      @linked_document_id = nil
      @linked_document_display_title = nil
      @note_text = ""

      result = Apps::OpenLinkedDocument.call(
        user: current_user,
        document_id: params[:document_id],
        content_type: "note",
        section_key: "notes",
        allow_embedded: true
      )
      if result.success?
        doc = result.payload.fetch(:document)
        @linked_document_id = doc.id
        @linked_document_display_title = helpers.finder_document_display_title(doc.title.to_s)
        @note_text = plain_text_from_note_html(doc.content.to_s)
      end

      render layout: false if turbo_frame_request?
    end

    private

    def plain_text_from_note_html(value)
      html = value.to_s
      with_breaks = html.gsub(/<br\s*\/?>/i, "\n").gsub(%r{</p>}i, "\n\n")
      ActionController::Base.helpers.strip_tags(with_breaks).to_s
    end
  end
end
