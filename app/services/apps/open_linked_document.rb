# frozen_string_literal: true

require_dependency "document_policy"

module Apps
  class OpenLinkedDocument
    class << self
      def call(user:, document_id:, content_type:, section_key: nil, allow_embedded: true)
        return failure(:invalid_id) unless numeric_id?(document_id)

        document = Document.find_by(id: document_id.to_i)
        return failure(:not_found) unless document

        policy = ::DocumentPolicy.new(user: user, document: document)
        permitted = policy.can_open_in_app?(
          content_type: content_type,
          section_key: section_key,
          allow_embedded: allow_embedded
        )
        return failure(:unauthorized) unless permitted

        success(document)
      end

      private

      def numeric_id?(value)
        value.to_s.strip.match?(/\A\d+\z/)
      end

      def success(document)
        Support::OperationResult.new(status: :ok, payload: { document: document })
      end

      def failure(code)
        Support::OperationResult.new(status: code)
      end
    end
  end
end
