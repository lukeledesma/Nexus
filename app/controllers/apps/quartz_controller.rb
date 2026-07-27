# frozen_string_literal: true

module Apps
  # QuartzController — serves the Quartz unified text-app surface.
  #
  # Launch flows:
  #   1. No document_id → fetch or create the "Quartz Draft" embedded document.
  #   2. document_id present → open that linked document (must be a note in the quartz section).
  #
  class QuartzController < BaseController
    def show
      @linked_document_id = nil
      @initial_body = ""
      @serialized_document_content = ""
      @document_title = "Quartz"

      if params[:document_id].present?
        # ── Linked document mode ─────────────────────────────────────────────
        result = Apps::OpenLinkedDocument.call(
          user: current_user,
          document_id: params[:document_id],
          content_type: "note",
          allow_embedded: true
        )

        if result.success?
          doc = result.payload.fetch(:document)
          @linked_document_id = doc.id
          @document_title = doc.title.presence || "Quartz"
          codec = QuartzDocumentCodec.load(doc.content.to_s)
          @initial_body = codec["body"].to_s
          @serialized_document_content = doc.content.to_s.presence ||
            QuartzDocumentCodec.dump(@initial_body, title: @document_title)
        else
          # Stale or invalid document_id — fall back to the embedded draft
          draft = EmbeddedDraftDocument.fetch_or_create(user: current_user, app_key: "quartz")
          if draft
            @linked_document_id = draft.id
            @document_title = "Quartz"
            codec = QuartzDocumentCodec.load(draft.content.to_s)
            @initial_body = codec["body"].to_s
            @serialized_document_content = draft.content.to_s.presence ||
              QuartzDocumentCodec.dump(@initial_body, title: @document_title)
          end
        end

      else
        # ── Draft mode: fetch or create the persistent scratch document ──────
        draft = EmbeddedDraftDocument.fetch_or_create(user: current_user, app_key: "quartz")

        if draft
          @linked_document_id = draft.id
          @document_title = "Quartz"
          codec = QuartzDocumentCodec.load(draft.content.to_s)
          @initial_body = codec["body"].to_s
          @serialized_document_content = draft.content.to_s.presence ||
            QuartzDocumentCodec.dump(@initial_body, title: @document_title)
        end
      end

      render_with_turbo_support layout: false
    end
  end
end
