# frozen_string_literal: true

module Apps
  class CalendarController < BaseController
    skip_before_action :sync_from_disk, only: %i[save_events draft_file last_saved]

    def show
      render layout: false if turbo_frame_request?
    end

    # POST /apps/calendar/save_events
    def save_events
      result = Calendar::SaveEvents.call(
        user: current_user,
        events_json: params[:events_json]
      )

      case result.status
      when :ok
        payload = result.payload || {}
        render json: {
          ok: true,
          document_id: payload[:document_id],
          title: payload[:title],
          updated_at: payload[:updated_at] || Time.current.iso8601
        }
      when :unprocessable_entity
        render json: result.payload || { error: "Could not save calendar events." }, status: :unprocessable_entity
      else
        head :internal_server_error
      end
    end

    # GET /apps/calendar/draft_file
    def draft_file
      embedded = FinderListedFolders.workspace_root_for(current_user)&.children&.folders&.find { |d| d.title.casecmp?("Embedded") }
      
      if embedded
        doc = embedded.children.files.find { |f| f.title.casecmp?("Calendar") }
        if doc
          # Parse the events from the document content
          events = CalendarEventDocumentCodec.load(doc.content.to_s)
          
          render json: {
            ok: true,
            document_id: doc.id,
            title: doc.title.to_s,
            updated_at: doc.updated_at.iso8601,
            events: events
          }
          return
        end
      end
      
      # No calendar file found, return empty
      render json: { ok: false, events: {} }, status: :not_found
    end

    # GET /apps/calendar/last_saved — ultra-cheap: returns only the document's updated_at.
    # Used by the JS poller to detect remote changes without fetching full event data.
    def last_saved
      embedded = FinderListedFolders.workspace_root_for(current_user)&.children&.folders&.find { |d| d.title.casecmp?("Embedded") }
      doc = embedded&.children&.files&.find { |f| f.title.casecmp?("Calendar") }

      if doc
        render json: { ok: true, updated_at: doc.updated_at.iso8601 }
      else
        render json: { ok: false, updated_at: nil }
      end
    end
  end
end
