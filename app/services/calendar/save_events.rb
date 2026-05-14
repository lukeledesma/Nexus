# frozen_string_literal: true

module Calendar
  class SaveEvents
    def self.call(user:, events_json:)
      new(user: user, events_json: events_json).call
    end

    def initialize(user:, events_json:)
      @user = user
      @events_json = events_json
    end

    def call
      begin
        # Parse the events JSON
        events = parse_json(@events_json)
        
        # Encode using the calendar event codec
        content = CalendarEventDocumentCodec.dump(events)
        
        # Get or create Calendar.txt in Embedded folder
        doc = get_or_create_calendar_document
        
        unless doc
          return Support::OperationResult.new(
            status: :unprocessable_entity,
            payload: { error: "Could not access calendar storage. Ensure Embedded folder exists." }
          )
        end
        
        doc.update!(content: content, content_type: "calendar_events")
        
        # Trigger disk sync
        DocumentStorageSyncLite.new(doc).update
        
        Support::OperationResult.new(
          status: :ok,
          payload: {
            ok: true,
            document_id: doc.id,
            title: doc.title,
            updated_at: doc.updated_at.iso8601
          }
        )
          .tap do |result|
            UserSyncChannel.broadcast_document_change(
              user: @user,
              document_id: doc.id,
              content_type: "calendar_events",
              updated_at: result.payload[:updated_at]
            )
          end
      rescue StandardError => e
        Rails.logger.error("Error saving calendar events: #{e.message}")
        Support::OperationResult.new(
          status: :unprocessable_entity,
          payload: { error: "Could not save calendar events: #{e.message}" }
        )
      end
    end

    private

    def parse_json(json_str)
      return {} if json_str.blank?
      JSON.parse(json_str)
    rescue JSON::ParserError
      {}
    end

    def get_or_create_calendar_document
      embedded = FinderListedFolders.workspace_root_for(@user)&.children&.folders&.find { |d| d.title.casecmp?("Embedded") }
      return nil unless embedded

      existing = embedded.children.files.find { |f| f.title.casecmp?("Calendar") }
      return existing if existing

      embedded.children.create!(
        is_folder: false,
        title: "Calendar",
        content: CalendarEventDocumentCodec.dump({}),
        content_type: "calendar_events"
      )
    end
  end
end
