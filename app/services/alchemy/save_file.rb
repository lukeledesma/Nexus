# frozen_string_literal: true

module Alchemy
  class SaveFile
    def self.call(user:, folder_id:, frame_id:, filename:, requested_document_id:, xml_text:)
      new(
        user: user,
        folder_id: folder_id,
        frame_id: frame_id,
        filename: filename,
        requested_document_id: requested_document_id,
        xml_text: xml_text
      ).call
    end

    def initialize(user:, folder_id:, frame_id:, filename:, requested_document_id:, xml_text:)
      @user = user
      @folder_id = folder_id.to_s
      @frame_id = frame_id.to_s
      @filename = filename.to_s
      @requested_document_id = requested_document_id
      @xml_text = xml_text.to_s
    end

    def call
      if @folder_id.blank? || @frame_id.blank? || @filename.blank?
        return Support::OperationResult.new(status: :bad_request, payload: { error: "folder_id, frame_id, and filename are required" })
      end

      return Support::OperationResult.new(status: :bad_request, payload: { error: "Unknown frame" }) unless @frame_id == "alchemy-pane"

      folder = Document.find_by(id: @folder_id.to_i)
      return Support::OperationResult.new(status: :not_found) unless folder&.folder?

      policy = ::DocumentPolicy.new(user: @user, document: folder)
      return Support::OperationResult.new(status: :forbidden) unless policy.can_save_into_folder?

      title = basename_from_filename(@filename)
      return Support::OperationResult.new(status: :unprocessable_entity, payload: { error: "Invalid filename" }) if title.blank?

      xml_payload = resolve_xml_payload
      return Support::OperationResult.new(status: :unprocessable_entity, payload: { error: "No XML content available to save." }) if xml_payload.blank?

      doc = find_or_build_document(folder, title)
      doc.content_type = "alchemy_tag_list"
      doc.content = xml_payload
      doc.tasks = []
      doc.reset_mode = "none"
      doc.reset_days = []
      doc.last_reset_at = nil

      if doc.save
        UserSyncChannel.broadcast_document_change(
          user: @user,
          document_id: doc.id,
          content_type: doc.content_type,
          content: doc.content.to_s,
          updated_at: doc.updated_at.utc.iso8601
        )
        UserSyncChannel.broadcast_workspace_change(user: @user, kind: "finder")

        Support::OperationResult.new(
          status: :ok,
          payload: {
            document_id: doc.id,
            title: doc.title,
            storage_path: doc.storage_path.to_s,
            cleared_embedded_draft: false
          }
        )
      else
        Support::OperationResult.new(status: :unprocessable_entity, payload: { errors: doc.errors.full_messages })
      end
    rescue StandardError => e
      Rails.logger.error("[Alchemy::SaveFile] failed: #{e.class}: #{e.message}")
      Support::OperationResult.new(status: :unprocessable_entity, payload: { error: "Could not save file." })
    end

    private

    def resolve_xml_payload
      return @xml_text if @xml_text.present?

      doc = requested_document
      return "" unless doc

      doc.content.to_s
    end

    def requested_document
      return nil if @requested_document_id.blank?

      doc = Document.find_by(id: @requested_document_id.to_i)
      return nil unless doc&.file?
      return nil unless doc.content_type.to_s == "alchemy_tag_list"

      open_result = Apps::OpenLinkedDocument.call(
        user: @user,
        document_id: doc.id,
        content_type: "alchemy_tag_list",
        allow_embedded: false
      )
      return nil unless open_result.success?

      open_result.payload.fetch(:document)
    rescue StandardError
      nil
    end

    def find_or_build_document(folder, title)
      if requested_document&.parent_id == folder.id
        requested_document.title = title
        return requested_document
      end

      existing = folder.children.files.where("LOWER(title) = ?", title.downcase).first
      return existing if existing

      Document.new(parent: folder, is_folder: false, title: title, content_type: "alchemy_tag_list")
    end

    def basename_from_filename(name)
      base = File.basename(name.to_s.strip)
      base = base.sub(/\.(xml|txt|md|nexus|rtf)\z/i, "")
      base.strip.presence
    end
  end
end
