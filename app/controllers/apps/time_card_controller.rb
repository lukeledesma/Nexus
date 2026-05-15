# frozen_string_literal: true

module Apps
  class TimeCardController < BaseController
    def show
      @linked_document_id = nil
      @initial_state = {
        entryDate: Date.current.iso8601,
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

      render_with_turbo_support layout: false
    end

    def files_by_date
      root = Apps::FinderController.workspace_section_root(current_user, "time_card")
      return render json: { ok: true, files_by_date: {} } unless root

      docs_by_date = Hash.new { |hash, key| hash[key] = [] }
      time_card_documents_for_root(root).each do |doc|
        date_key = extract_entry_date(doc)
        next if date_key.blank?
        docs_by_date[date_key] << doc
      end

      by_date = docs_by_date.transform_values do |documents|
        documents.max_by do |doc|
          [ doc.updated_at&.to_f.to_f, doc.id.to_i ]
        end
      end

      render json: {
        ok: true,
        files_by_date: by_date.transform_values do |entry|
          {
            document_id: entry.id,
            title: entry.title.to_s
          }
        end
      }
    end

    private

    def time_card_documents_for_root(root)
      sql = <<~SQL.squish
        WITH RECURSIVE subtree AS (
          SELECT *
          FROM documents
          WHERE id = ?
          UNION ALL
          SELECT d.*
          FROM documents d
          INNER JOIN subtree t ON d.parent_id = t.id
        )
        SELECT *
        FROM subtree
        WHERE is_folder = FALSE
          AND content_type = 'note'
          AND id != ?
      SQL

      Document.find_by_sql([ sql, root.id, root.id ])
    rescue StandardError
      []
    end

    def extract_entry_date(doc)
      raw = TimeCardDocumentCodec.load(doc.content.to_s)["entryDate"].to_s.strip
      date = parse_iso_date(raw)
      return date if date.present?

      parse_title_date(doc.title.to_s)
    end

    def parse_iso_date(value)
      return nil unless value.match?(/\A\d{4}-\d{2}-\d{2}\z/)

      Date.iso8601(value).iso8601
    rescue ArgumentError
      nil
    end

    def parse_title_date(title)
      normalized = title.to_s.strip
      return nil if normalized.blank?

      if (m = normalized.match(/\A(\d{4})-(\d{2})-(\d{2})\z/))
        return build_iso_date(m[1], m[2], m[3])
      end

      if (m = normalized.match(/\A(\d{1,2})[\.\/-](\d{1,2})[\.\/-](\d{4})\z/))
        return build_iso_date(m[3], m[1], m[2])
      end

      nil
    end

    def build_iso_date(year, month, day)
      Date.new(year.to_i, month.to_i, day.to_i).iso8601
    rescue ArgumentError
      nil
    end

  end
end
