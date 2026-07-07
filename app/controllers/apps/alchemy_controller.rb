# frozen_string_literal: true

module Apps
  class AlchemyController < BaseController
    skip_before_action :sync_from_disk, only: %i[save_file]

    def show
      @rows = []
      @source_filename = nil
      @source_xml_content = ""
      @linked_document_id = nil
      @status_message = "Drop XML files into Finder > Alchemy, then open one here."

      if params[:document_id].present?
        result = Apps::OpenLinkedDocument.call(
          user: current_user,
          document_id: params[:document_id],
          content_type: "alchemy_tag_list",
          section_key: "alchemy",
          allow_embedded: false
        )

        unless result.success?
          @status_message = "Selected file is not available in the Alchemy section."
          return render_with_turbo_support layout: false
        end

        doc = result.payload.fetch(:document)
        @linked_document_id = doc.id
        @source_filename = doc.title.to_s
        @source_xml_content = doc.content.to_s
        @rows = Alchemy::TagXml::Parser.parse_records_from_content(@source_xml_content)
        @status_message = @rows.present? ? nil : "No tags found in this XML file."
      end

      render_with_turbo_support layout: false
    rescue StandardError => e
      Rails.logger.error("[Apps::AlchemyController] show failed: #{e.class}: #{e.message}")
      @status_message = "Could not open XML file: #{e.message}"
      render_with_turbo_support layout: false, status: :unprocessable_entity
    end

    def save_file
      result = Alchemy::SaveFile.call(
        user: current_user,
        folder_id: params[:folder_id].presence,
        frame_id: params[:frame_id],
        filename: params[:filename],
        requested_document_id: params[:document_id].presence,
        xml_text: params[:xml_text]
      )

      case result.status
      when :ok
        payload = result.payload || {}
        display_title = helpers.finder_document_display_title(payload[:title])
        render json: payload.merge(ok: true, display_title: display_title)
      when :not_found
        head :not_found
      when :forbidden
        head :forbidden
      when :unprocessable_entity
        render json: result.payload || { error: "Could not save file." }, status: :unprocessable_entity
      when :bad_request
        render json: result.payload, status: :bad_request
      else
        head :internal_server_error
      end
    end
  end
end
