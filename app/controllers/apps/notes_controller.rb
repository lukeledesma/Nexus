# frozen_string_literal: true

module Apps
  class NotesController < BaseController
    def show
      notes_root = Apps::FinderController.workspace_section_root(current_user, "notes")

      @linked_document_id = nil
      @linked_document_display_title = nil
      @note_text = ""

      raw = params[:document_id].to_s.strip
      if raw.match?(/^\d+$/)
        doc = WorkspaceDocumentAccess.openable_document_for(current_user, raw, content_type: "note")
        if doc && notes_root && Apps::FinderController.document_in_finder_subtree?(notes_root, doc)
          @linked_document_id = doc.id
          @linked_document_display_title = helpers.finder_document_display_title(doc.title.to_s)
          @note_text = plain_text_from_note_html(doc.content.to_s)
        end
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
